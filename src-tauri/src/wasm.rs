//! Modules an operator writes themselves, in Rust, compiled to WebAssembly.
//!
//! A module contributes BLOCKS to the library. It never touches the page: it
//! is handed the step's parameters and the run's variables, and it answers
//! with a list of primitive actions for the runner to perform. That is what
//! keeps a third-party module inside the same guarantee as the rest — every
//! page action still goes out through the Motion domain, and nothing a module
//! returns can execute script.
//!
//! The contract is four exports and no imports beyond a log hook:
//!
//!   alloc(len: i32) -> i32          give the host somewhere to write
//!   dealloc(ptr: i32, len: i32)
//!   blocks() -> i64                 packed (ptr << 32 | len), JSON: BlockSpec[]
//!   run(ptr: i32, len: i32) -> i64  packed, JSON: { actions: [...], vars: {} }
//!
//! A BlockSpec may carry an optional "group": the name or id of a built-in
//! picker group ("Navigation", "data", "Flow"…) drops the action into it; any
//! other name starts a new group with that title; omitted, it lands in the
//! module's own group. (The launcher's picker reads it; the runner ignores it.)
//!
//! Packing both halves into one i64 keeps the signature to a single return
//! value, which every wasm target supports without multi-value.

#![cfg(feature = "automation")]

use crate::store;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use wasmtime::{Caller, Config, Engine, Extern, Instance, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

/// One module on disk, with the blocks it says it provides.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfo {
    /// File stem; also the prefix every one of its block kinds carries.
    pub id: String,
    pub name: String,
    pub path: String,
    /// The block descriptors, in the same shape as the built-in palette.
    pub blocks: Vec<Value>,
    /// Empty when the module loaded; otherwise why it did not.
    pub error: String,
}

pub fn modules_dir() -> Result<PathBuf> {
    let d = store::config_root()?.join("automation-modules");
    fs::create_dir_all(&d)?;
    Ok(d)
}

/// The one engine every module is compiled against.
///
/// Built from a Config rather than Engine::default() for one reason: fuel.
/// `Store::set_fuel` refuses with "fuel is not configured in this store" unless
/// the engine's tunables have consume_fuel, so the ceiling this file has
/// claimed since it was written was never actually in effect — a module with an
/// endless loop held its worker for ever, and `describe()` runs an untrusted
/// `blocks()` on the synchronous Tauri command thread, so it held the UI too.
fn engine() -> &'static Engine {
    static E: OnceLock<Engine> = OnceLock::new();
    E.get_or_init(|| {
        let mut config = Config::new();
        config.consume_fuel(true);
        // On macOS wasmtime's Mach-port thread aborts the process when any signal
        // lands on it, such as SIGCHLD from a browser exiting; plain signals don't.
        config.macos_use_mach_ports(false);
        Engine::new(&config).unwrap_or_default()
    })
}

/// The host imports, built once. `Linker<T>` is Send + Sync and `instantiate`
/// takes `&self`, so rebuilding eight `func_wrap`s per call was pure waste —
/// and `describe()` instantiates every module in the directory every time the
/// picker opens.
fn shared_linker() -> Result<&'static Linker<HostState>> {
    static L: OnceLock<Result<Linker<HostState>, String>> = OnceLock::new();
    match L.get_or_init(|| linker().map_err(|e| e.to_string())) {
        Ok(l) => Ok(l),
        Err(e) => Err(anyhow!("{e}")),
    }
}

/// What one call owns: its log and its resource ceiling.
///
/// The log used to be a single process-global vector drained by the runner
/// after the call. With one worker that read correctly; with four it did not —
/// whichever worker drained next collected whatever any module had written,
/// so a module's own lines turned up in another profile's log. Carrying it in
/// the store makes it the call's, which it always was.
pub struct HostState {
    log: Vec<String>,
    limits: StoreLimits,
    /// The run's variables as the module currently sees them.
    vars: HashMap<String, String>,
    /// What the module has set since the last action; handed to the runner
    /// with the next one so the two never disagree about a value.
    pending: HashMap<String, String>,
    /// Where an action goes. None for a v1 module, which asks for nothing.
    tx: Option<tokio::sync::mpsc::UnboundedSender<ActionRequest>>,
    /// The operator's Stop for the whole run.
    stop: Arc<AtomicBool>,
    /// This call's own, raised when the module runs past its action budget.
    /// Separate from `stop` so one module's mistake does not end the run.
    abort: Arc<AtomicBool>,
    /// What this module may see of `vars`: what it declared, plus what it wrote
    /// or named itself. Nothing else.
    view: VarView,
    /// Whose call this is. The state store is per module, and until now nothing
    /// in here knew which one it was serving.
    module_id: String,
}

impl HostState {
    /// A v1 call: no channel, so a module that imports do_action gets nothing
    /// and every other import still answers.
    fn plain() -> Self {
        Self {
            log: Vec::new(),
            limits: StoreLimitsBuilder::new().build(),
            vars: HashMap::new(),
            pending: HashMap::new(),
            tx: None,
            stop: Arc::new(AtomicBool::new(false)),
            abort: Arc::new(AtomicBool::new(false)),
            view: VarView::default(),
            module_id: String::new(),
        }
    }
}

/// One thing the module asked the runner to do.
///
/// The module runs on a blocking thread and waits on `reply`; the runner
/// performs the action on its own thread with its own state and answers. That
/// is what lets a module see the RESULT of its action and decide what to do
/// next — the v1 contract could only hand over a finished plan and hope.
///
/// Deliberately a channel and not a re-entrant call: the runner's step
/// function owns the profile binding and the variables by mutable reference,
/// and calling back into it from inside a wasm call would need that ownership
/// in two places at once.
pub struct ActionRequest {
    pub action: Value,
    /// Variables the module set since the previous request.
    pub vars: HashMap<String, String>,
    pub reply: std::sync::mpsc::Sender<ActionReply>,
}

#[derive(Default)]
pub struct ActionReply {
    pub ok: bool,
    /// "next" or "else" — how a conditional step answered.
    pub flow: String,
    pub error: String,
    /// The full variable map after the action, so the module sees whatever the
    /// step wrote into it.
    pub vars: HashMap<String, String>,
}

fn linker() -> Result<Linker<HostState>> {
    let mut linker = Linker::new(engine());
    // The only import a module gets. Anything else it wants to do it must ask
    // for by returning an action.
    linker
        .func_wrap(
        "shardx",
        "log",
        |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| {
            let Some(Extern::Memory(mem)) = caller.get_export("memory") else { return };
            let mut buf = vec![0u8; len.max(0) as usize];
            if mem.read(&mut caller, ptr.max(0) as usize, &mut buf).is_ok() {
                if let Ok(s) = String::from_utf8(buf) {
                    // Bounded: a module in a loop must not fill memory with its
                    // own diagnostics.
                    let log = &mut caller.data_mut().log;
                    if log.len() < 500 {
                        log.push(s);
                    }
                }
            }
        },
        )
        .map_err(|e| anyhow!("link log(): {e}"))?;

    // ---- ABI v2 ----
    //
    // Everything below is optional for the module: a v1 module imports none of
    // it and keeps working. What changes for a v2 module is the direction of
    // control — instead of returning a finished plan, it ASKS, one action at a
    // time, and each answer tells it what happened.
    //
    // The guarantee is untouched. None of these perform anything themselves:
    // do_action hands the request to the runner, which builds an ordinary block
    // and runs it through the same path a hand-placed step takes, out through
    // the Motion domain. A module still cannot execute anything in the page.

    // Perform one step of the ordinary vocabulary and answer with the result.
    // The `kind` is any the runner knows -- goto, click, readText, http.request,
    // db.query -- so the whole existing palette is the module's API without a
    // single new concept.
    linker
        .func_wrap(
            "shardx",
            "do_action",
            |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| -> i64 {
                let Some(text) = read_string(&mut caller, ptr, len) else { return 0 };
                let Ok(action) = serde_json::from_str::<Value>(&text) else { return 0 };
                let (tx, pending) = {
                    let st = caller.data_mut();
                    // Whatever this action writes into is the module's own, so
                    // it can read back the result of what it just asked for.
                    st.view.note_targets(&action);
                    (st.tx.clone(), std::mem::take(&mut st.pending))
                };
                let Some(tx) = tx else { return 0 };
                let (rtx, rrx) = std::sync::mpsc::channel();
                if tx.send(ActionRequest { action, vars: pending, reply: rtx }).is_err() {
                    return 0;
                }
                // Blocking is correct here: this thread is a blocking one, the
                // module has nothing to do until the action lands, and the
                // runner is on another thread doing it.
                let Ok(reply) = rrx.recv() else { return 0 };
                let visible = {
                    let st = caller.data_mut();
                    st.vars = reply.vars.clone();
                    st.view.filter(&reply.vars)
                };
                let out = serde_json::json!({
                    "ok": reply.ok,
                    "flow": reply.flow,
                    "error": reply.error,
                    "vars": visible,
                });
                write_string(&mut caller, &out.to_string())
            },
        )
        .map_err(|e| anyhow!("link do_action(): {e}"))?;

    // Read one of the run's variables. Empty when there is no such name --
    // a module asking for something unset is not an error.
    linker
        .func_wrap(
            "shardx",
            "get_var",
            |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| -> i64 {
                let Some(name) = read_string(&mut caller, ptr, len) else { return 0 };
                let st = caller.data();
                // A name it may not see reads empty, the same as an unset one:
                // a module asking for something it does not have is not an
                // error, and the difference is not the module's business.
                let value = if st.view.sees(&name) {
                    st.vars.get(&name).cloned().unwrap_or_default()
                } else {
                    String::new()
                };
                write_string(&mut caller, &value)
            },
        )
        .map_err(|e| anyhow!("link get_var(): {e}"))?;

    // Set one. Applied to the run when the next action goes out, or when the
    // step ends -- so a module that sets and then acts sees its own value.
    linker
        .func_wrap(
            "shardx",
            "set_var",
            |mut caller: Caller<'_, HostState>,
             kptr: i32, klen: i32, vptr: i32, vlen: i32| -> i32 {
                let (Some(name), Some(value)) = (
                    read_string(&mut caller, kptr, klen),
                    read_string(&mut caller, vptr, vlen),
                ) else {
                    return 1;
                };
                let st = caller.data_mut();
                st.view.note_written(&name);
                st.vars.insert(name.clone(), value.clone());
                st.pending.insert(name, value);
                0
            },
        )
        .map_err(|e| anyhow!("link set_var(): {e}"))?;

    // What a module remembers between steps, and between runs.
    //
    // Not a variable: a project should not reach it by spelling a name, and it
    // outlives the run that made it. Empty means "not set" on the way out and
    // "forget this" on the way in, so there is no separate delete.
    linker
        .func_wrap(
            "shardx",
            "state_get",
            |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| -> i64 {
                let Some(key) = read_string(&mut caller, ptr, len) else { return 0 };
                let id = caller.data().module_id.clone();
                let value = state_get(&id, &key);
                write_string(&mut caller, &value)
            },
        )
        .map_err(|e| anyhow!("link state_get(): {e}"))?;

    linker
        .func_wrap(
            "shardx",
            "state_set",
            |mut caller: Caller<'_, HostState>,
             kptr: i32, klen: i32, vptr: i32, vlen: i32| -> i32 {
                let (Some(key), Some(value)) = (
                    read_string(&mut caller, kptr, klen),
                    read_string(&mut caller, vptr, vlen),
                ) else {
                    return 1;
                };
                let id = caller.data().module_id.clone();
                // A module with no id is one being described, not run: blocks()
                // and manifest() have nothing to remember.
                if id.is_empty() {
                    return 1;
                }
                match state_set(&id, &key, &value) {
                    Ok(()) => 0,
                    Err(e) => {
                        let log = &mut caller.data_mut().log;
                        if log.len() < 500 {
                            log.push(format!("could not remember \"{key}\": {e}"));
                        }
                        1
                    }
                }
            },
        )
        .map_err(|e| anyhow!("link state_set(): {e}"))?;

    linker
        .func_wrap("shardx", "now_ms", |_: Caller<'_, HostState>| -> i64 {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
        })
        .map_err(|e| anyhow!("link now_ms(): {e}"))?;

    // The host's randomness, not the module's. A module carrying its own seeded
    // generator behaves identically on every profile of a fleet, which is a
    // fingerprint in itself.
    linker
        .func_wrap(
            "shardx",
            "random",
            |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| -> i32 {
                let n = len.max(0) as usize;
                if n == 0 || n > (1 << 20) {
                    return 1;
                }
                let mut buf = vec![0u8; n];
                for chunk in buf.chunks_mut(16) {
                    let bytes = *uuid::Uuid::new_v4().as_bytes();
                    let take = chunk.len().min(16);
                    chunk[..take].copy_from_slice(&bytes[..take]);
                }
                let Some(Extern::Memory(mem)) = caller.get_export("memory") else { return 1 };
                if mem.write(&mut caller, ptr.max(0) as usize, &buf).is_err() {
                    return 1;
                }
                0
            },
        )
        .map_err(|e| anyhow!("link random(): {e}"))?;

    // Sleeping burns wall-clock, not fuel. A module waiting for a page is
    // doing the right thing and must not be charged for it.
    linker
        .func_wrap("shardx", "sleep_ms", |_: Caller<'_, HostState>, ms: i64| {
            let ms = ms.clamp(0, 60_000) as u64;
            std::thread::sleep(std::time::Duration::from_millis(ms));
        })
        .map_err(|e| anyhow!("link sleep_ms(): {e}"))?;

    // 1 when the operator has stopped the run. A long module is expected to
    // check this and leave; one that does not is killed by the fuel ceiling,
    // which is a worse way to end.
    linker
        .func_wrap("shardx", "should_stop", |caller: Caller<'_, HostState>| -> i32 {
            let st = caller.data();
            i32::from(
                st.stop.load(Ordering::Relaxed) || st.abort.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| anyhow!("link should_stop(): {e}"))?;

    Ok(linker)
}

/// Reads a string out of the module's memory.
fn read_string(caller: &mut Caller<'_, HostState>, ptr: i32, len: i32) -> Option<String> {
    let Some(Extern::Memory(mem)) = caller.get_export("memory") else { return None };
    let n = len.max(0) as usize;
    if n > (8 << 20) {
        return None;
    }
    let mut buf = vec![0u8; n];
    mem.read(&mut *caller, ptr.max(0) as usize, &mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// Writes a string INTO the module's memory, using its own allocator, and
/// answers with the packed (ptr, len) the module expects everywhere else.
/// Zero means it did not fit; a module must treat that as an empty answer.
fn write_string(caller: &mut Caller<'_, HostState>, text: &str) -> i64 {
    let bytes = text.as_bytes();
    let Some(Extern::Func(alloc)) = caller.get_export("alloc") else { return 0 };
    let Ok(alloc) = alloc.typed::<i32, i32>(&*caller) else { return 0 };
    let Ok(ptr) = alloc.call(&mut *caller, bytes.len() as i32) else { return 0 };
    let Some(Extern::Memory(mem)) = caller.get_export("memory") else { return 0 };
    if mem.write(&mut *caller, ptr as usize, bytes).is_err() {
        return 0;
    }
    ((ptr as i64) << 32) | (bytes.len() as i64)
}

struct Loaded {
    store: Store<HostState>,
    instance: Instance,
}

/// Compiled modules, kept between steps and keyed by path and mtime.
///
/// Every step used to pay a full compile of the .wasm — for a project that
/// calls a module in a loop that is the same work over and over, and for a
/// large module it is the dominant cost of the step. The mtime is part of the
/// key so replacing a module on disk takes effect without restarting the
/// launcher, which is how one is developed.
fn compiled() -> &'static Mutex<HashMap<PathBuf, (std::time::SystemTime, Module)>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, (std::time::SystemTime, Module)>>> =
        OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn compile(path: &PathBuf) -> Result<Module> {
    let stamp = fs::metadata(path).and_then(|m| m.modified()).ok();
    if let (Some(stamp), Ok(cache)) = (stamp, compiled().lock()) {
        if let Some((seen, module)) = cache.get(path) {
            if *seen == stamp {
                return Ok(module.clone());
            }
        }
    }
    // wasmtime carries its own anyhow, so its Result does not take ours;
    // every wasmtime error crosses the boundary as text.
    let module = Module::from_file(engine(), path)
        .map_err(|e| anyhow!("read {}: {e}", path.display()))?;
    if let (Some(stamp), Ok(mut cache)) = (stamp, compiled().lock()) {
        cache.insert(path.clone(), (stamp, module.clone()));
    }
    Ok(module)
}

/// What a module gets, given what it asked for.
fn ceilings(asked: Option<&Manifest>) -> (u64, u32) {
    (
        asked
            .and_then(|m| m.fuel)
            .unwrap_or(DEFAULT_FUEL)
            .clamp(1, MAX_FUEL),
        asked
            .and_then(|m| m.memory_mb)
            .unwrap_or(DEFAULT_MEMORY_MB)
            .clamp(1, MAX_MEMORY_MB),
    )
}

fn instantiate(path: &PathBuf, host: HostState) -> Result<Loaded> {
    let module = compile(path)?;
    // What the module asked for, clamped. Read from the cache, so this costs a
    // lock rather than an instantiation — and read BEFORE the store exists,
    // because neither limit can be changed after Store::new.
    let (fuel, memory_mb) = ceilings(manifest_cached(path).as_ref());
    // A ceiling on memory, which there was none of at all: a module could ask
    // for as much as it liked and take the launcher down with it.
    let limits = StoreLimitsBuilder::new()
        .memory_size((memory_mb as usize) << 20)
        .instances(1)
        .tables(4)
        .build();
    // Not `HostState { limits, ..host }`: struct-update lets the explicit field
    // win, so the caller's own value was silently thrown away.
    let mut host = host;
    host.limits = limits;
    let mut store = Store::new(engine(), host);
    store.limiter(|st| &mut st.limits);
    // A module that loops forever must not take the launcher with it. The
    // Result matters — under an engine without consume_fuel this call fails and
    // the ceiling quietly does not exist.
    store.set_fuel(fuel).map_err(|e| anyhow!("fuel: {e}"))?;
    let instance = shared_linker()?
        .instantiate(&mut store, &module)
        .map_err(|e| anyhow!("instantiate: {e}"))?;
    Ok(Loaded { store, instance })
}

fn read_packed(loaded: &mut Loaded, packed: i64) -> Result<String> {
    let ptr = ((packed >> 32) & 0xFFFF_FFFF) as usize;
    let len = (packed & 0xFFFF_FFFF) as usize;
    if len == 0 {
        return Ok(String::new());
    }
    if len > 8 * 1024 * 1024 {
        return Err(anyhow!("the module returned more than 8MB"));
    }
    let mem = loaded
        .instance
        .get_memory(&mut loaded.store, "memory")
        .context("the module exports no memory")?;
    let mut buf = vec![0u8; len];
    mem.read(&mut loaded.store, ptr, &mut buf)
        .map_err(|e| anyhow!("read module memory: {e}"))?;
    // Hand the memory back so a long run does not grow the module's heap.
    if let Some(dealloc) = loaded
        .instance
        .get_typed_func::<(i32, i32), ()>(&mut loaded.store, "dealloc")
        .ok()
    {
        let _ = dealloc.call(&mut loaded.store, (ptr as i32, len as i32));
    }
    Ok(String::from_utf8(buf)?)
}

fn write_input(loaded: &mut Loaded, text: &str) -> Result<(i32, i32)> {
    let alloc = loaded
        .instance
        .get_typed_func::<i32, i32>(&mut loaded.store, "alloc")
        .map_err(|_| anyhow!("the module exports no alloc"))?;
    let len = text.len() as i32;
    let ptr = alloc.call(&mut loaded.store, len).map_err(|e| anyhow!("alloc: {e}"))?;
    let mem = loaded
        .instance
        .get_memory(&mut loaded.store, "memory")
        .context("the module exports no memory")?;
    mem.write(&mut loaded.store, ptr as usize, text.as_bytes())
        .map_err(|e| anyhow!("write module memory: {e}"))?;
    Ok((ptr, len))
}

/// Everything in the modules directory, loaded or explained.
pub fn list() -> Result<Vec<ModuleInfo>> {
    let dir = modules_dir()?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if crate::store::is_os_litter(&entry.file_name()) || path.extension().and_then(|e| e.to_str()) != Some("wasm") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("module")
            .to_string();
        let mut info = ModuleInfo {
            id: id.clone(),
            name: id.clone(),
            path: path.to_string_lossy().to_string(),
            blocks: Vec::new(),
            error: String::new(),
        };
        match describe(&path) {
            Ok(blocks) => info.blocks = blocks,
            Err(e) => info.error = e.to_string(),
        }
        out.push(info);
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn describe(path: &PathBuf) -> Result<Vec<Value>> {
    let mut loaded = instantiate(path, HostState::plain())?;
    let f = loaded
        .instance
        .get_typed_func::<(), i64>(&mut loaded.store, "blocks")
        .map_err(|_| anyhow!("the module exports no blocks()"))?;
    let packed = f.call(&mut loaded.store, ()).map_err(|e| anyhow!("blocks(): {e}"))?;
    let json = read_packed(&mut loaded, packed)?;
    let blocks: Vec<Value> = serde_json::from_str(&json).context("blocks() did not return JSON")?;
    Ok(blocks)
}

/// What a module asks the runner to do.
#[derive(Debug, Clone, Deserialize)]
pub struct ModuleResult {
    /// Primitive steps, each in the same shape as a built-in block's params
    /// plus a `kind`. The runner performs them in order.
    #[serde(default)]
    pub actions: Vec<Value>,
    /// Variables to set afterwards.
    #[serde(default)]
    pub vars: std::collections::HashMap<String, String>,
    /// Non-empty means the step failed and this is why.
    #[serde(default)]
    pub error: String,
    /// What the module logged during THIS call. Not deserialised from the
    /// module's JSON — filled in by the host afterwards.
    #[serde(skip)]
    pub logs: Vec<String>,
}

/// Runs one of a module's blocks. `input` carries the step's params and the
/// run's variables; nothing else crosses the boundary.
pub fn run_block(module_id: &str, input: &Value) -> Result<ModuleResult> {
    let path = modules_dir()?.join(format!("{module_id}.wasm"));
    if !path.exists() {
        return Err(anyhow!("module \"{module_id}\" is not installed"));
    }
    // Narrowed the same way the driving path narrows it: which contract a module
    // speaks does not change whose variables those are.
    let declared = read_manifest(&path).map(|m| m.vars).unwrap_or_default();
    let mut view = VarView { declared, own: Vec::new() };
    if let Some(params) = input.get("params") {
        view.note_targets(params);
    }
    let mut input = input.clone();
    if let Some(obj) = input.as_object_mut() {
        if let Some(vars) = obj.get("vars").and_then(|v| v.as_object()) {
            let all: HashMap<String, String> = vars
                .iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                .collect();
            obj.insert(
                "vars".into(),
                serde_json::to_value(view.filter(&all)).unwrap_or_default(),
            );
        }
    }

    let mut loaded = instantiate(&path, HostState { view, ..HostState::plain() })?;
    let text = serde_json::to_string(&input)?;
    let (ptr, len) = write_input(&mut loaded, &text)?;
    let f = loaded
        .instance
        .get_typed_func::<(i32, i32), i64>(&mut loaded.store, "run")
        .map_err(|_| anyhow!("the module exports no run()"))?;
    let packed = f
        .call(&mut loaded.store, (ptr, len))
        .map_err(|e| anyhow!("run(): {e}"))?;
    let json = read_packed(&mut loaded, packed)?;
    let logs = std::mem::take(&mut loaded.store.data_mut().log);
    if json.trim().is_empty() {
        return Ok(ModuleResult {
            actions: Vec::new(),
            vars: Default::default(),
            error: String::new(),
            logs,
        });
    }
    let mut out: ModuleResult =
        serde_json::from_str(&json).context("run() did not return JSON")?;
    out.logs = logs;
    Ok(out)
}

/// Runs one block of a v2 module: the module drives, asking for actions as it
/// goes, and this returns when it is done.
///
/// Called on a blocking thread. The channel is how the module reaches the
/// runner: it sends a request and waits, the runner performs the step with its
/// own state and answers. Nothing here touches a profile, a page or a browser.
///
/// A module that exports `step` is v2; one that exports only `run` is v1 and
/// goes through run_block above, unchanged and for ever.
pub fn run_step(
    module_id: &str,
    input: &Value,
    vars: HashMap<String, String>,
    tx: tokio::sync::mpsc::UnboundedSender<ActionRequest>,
    stop: Arc<AtomicBool>,
    abort: Arc<AtomicBool>,
) -> Result<ModuleResult> {
    let path = modules_dir()?.join(format!("{module_id}.wasm"));
    if !path.exists() {
        return Err(anyhow!("module \"{module_id}\" is not installed"));
    }
    // What the module declared, if anything. Read before the call so the input
    // it is handed is already narrowed.
    let declared = read_manifest(&path).map(|m| m.vars).unwrap_or_default();
    let view = VarView { declared, own: Vec::new() };

    // The step's own parameters name where its results go, the same way an
    // action's do — a module must be able to read back what its own block wrote.
    let mut view = view;
    if let Some(params) = input.get("params") {
        view.note_targets(params);
    }

    let host = HostState {
        log: Vec::new(),
        limits: StoreLimitsBuilder::new().build(),
        vars,
        pending: HashMap::new(),
        tx: Some(tx),
        stop,
        abort,
        view,
        module_id: module_id.to_string(),
    };
    let mut loaded = instantiate(&path, host)?;
    // Narrowed here too, or the whole map arrives in the very first message.
    let input = {
        let st = loaded.store.data();
        let mut narrowed = input.clone();
        if let Some(obj) = narrowed.as_object_mut() {
            obj.insert(
                "vars".into(),
                serde_json::to_value(st.view.filter(&st.vars)).unwrap_or_default(),
            );
        }
        narrowed
    };
    let text = serde_json::to_string(&input)?;
    let (ptr, len) = write_input(&mut loaded, &text)?;
    let f = loaded
        .instance
        .get_typed_func::<(i32, i32), i64>(&mut loaded.store, "step")
        .map_err(|_| anyhow!("the module exports no step()"))?;
    let packed = f
        .call(&mut loaded.store, (ptr, len))
        .map_err(|e| anyhow!("step(): {e}"))?;
    let json = read_packed(&mut loaded, packed)?;
    let st = loaded.store.data_mut();
    let logs = std::mem::take(&mut st.log);
    // Whatever the module set and did not flush with an action still counts.
    let mut vars = std::mem::take(&mut st.pending);
    let mut out = if json.trim().is_empty() {
        ModuleResult {
            actions: Vec::new(),
            vars: Default::default(),
            error: String::new(),
            logs: Vec::new(),
        }
    } else {
        serde_json::from_str::<ModuleResult>(&json).context("step() did not return JSON")?
    };
    vars.extend(out.vars.into_iter());
    out.vars = vars;
    out.logs = logs;
    Ok(out)
}

/// Whether a module speaks v2. Cheap: the compiled module is cached, and this
/// only looks at its export list.
pub fn is_v2(module_id: &str) -> bool {
    let Ok(path) = modules_dir().map(|d| d.join(format!("{module_id}.wasm"))) else {
        return false;
    };
    compile(&path)
        .map(|m| m.get_export("step").is_some())
        .unwrap_or(false)
}


/// What a module says it needs, read from an optional `manifest()` export.
///
/// Absence is the compatibility signal — no version field, no probe: a module
/// written before this existed exports no `manifest` and therefore declares
/// nothing, which with the default below means it calls nothing. Nesting is new,
/// so denying it to every module that predates it breaks none of them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Manifest {
    /// Module ids this module wants to call.
    #[serde(default)]
    pub modules: Vec<String>,
    /// Project names it wants to call as a sub-flow. Names rather than ids
    /// because a module is written before it meets anyone's projects.
    #[serde(default)]
    pub flows: Vec<String>,
    /// Variables of the run it wants to read. A trailing `*` is a prefix, so
    /// `["order_*"]` is one line for a family of them.
    ///
    /// Nothing here means nothing but its own: a module always sees what it
    /// wrote or named itself — it must be able to read back the result of the
    /// action it just asked for — and everything else has to be named. The run's
    /// variables are the operator's, and holding an account or a token there is
    /// the ordinary way to use them.
    #[serde(default)]
    pub vars: Vec<String>,
    /// Roughly one unit per WebAssembly instruction. The default suits a module
    /// that reads pages and decides things; a module that parses a large
    /// document may want more. Clamped to the host's own ceiling.
    #[serde(default)]
    pub fuel: Option<u64>,
    /// Megabytes of linear memory. Same story: asked for, then clamped.
    #[serde(default)]
    pub memory_mb: Option<u32>,
    /// One line for the operator, shown beside the request.
    #[serde(default)]
    pub reason: String,
}

/// What the host will hand out however much is asked for.
///
/// A ceiling and not a contract: a module that asks for more gets the ceiling
/// and a line in the log, because refusing to run over a number the author
/// guessed would be a worse failure than running with less.
const MAX_FUEL: u64 = 2_000_000_000;
const DEFAULT_FUEL: u64 = 200_000_000;
const MAX_MEMORY_MB: u32 = 1024;
const DEFAULT_MEMORY_MB: u32 = 256;

/// What a module is allowed to see of the run's variables.
///
/// Closed by default and in every direction: a module sees what it DECLARED and
/// what it wrote or named itself, and nothing else. A run's variables are the
/// operator's — they hold accounts, tokens and whatever a file block put there —
/// and handing the whole map to every module was a channel no permission
/// covered, in a subsystem where everything else is asked for.
#[derive(Debug, Clone, Default)]
pub struct VarView {
    /// Patterns from the manifest. A trailing `*` is a prefix.
    declared: Vec<String>,
    /// Names the module set, or named as the target of an action it asked for.
    /// Kept as prefixes: `readText into: "t"` also produces `t_status` and the
    /// like, and a module that cannot read back its own action is useless.
    own: Vec<String>,
}

impl VarView {
    fn sees(&self, name: &str) -> bool {
        self.declared.iter().any(|pattern| match pattern.strip_suffix('*') {
            Some(prefix) => name.starts_with(prefix),
            None => pattern == name,
        }) || self.own.iter().any(|o| name.starts_with(o.as_str()))
    }

    fn filter(&self, vars: &HashMap<String, String>) -> HashMap<String, String> {
        vars.iter()
            .filter(|(k, _)| self.sees(k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Records the names an action is about to write into.
    ///
    /// Every block in the runner that writes a variable takes its name from
    /// `into` or from `name` — checked by reading them, not assumed.
    fn note_targets(&mut self, action: &Value) {
        for key in ["into", "name"] {
            if let Some(v) = action.get(key).and_then(|v| v.as_str()) {
                let v = v.trim();
                if !v.is_empty() && !self.own.iter().any(|o| o == v) {
                    self.own.push(v.to_string());
                }
            }
        }
    }

    fn note_written(&mut self, name: &str) {
        if !self.own.iter().any(|o| o == name) {
            self.own.push(name.to_string());
        }
    }
}

/// What the operator actually allowed. Stored beside the .wasm.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Grant {
    /// The digest of the file the decision was made about. `install()` copies
    /// over an existing `<id>.wasm` without asking, and the id is just the file
    /// stem, so a grant keyed only by id would be inherited by whatever binary
    /// is dropped in under a trusted name.
    #[serde(default)]
    pub decided_for: String,
    #[serde(default)]
    pub call_modules: Vec<String>,
    #[serde(default)]
    pub call_flows: Vec<String>,
}


// ---- state a module keeps ----
//
// Variables live for a run. A module often needs the other thing: a cursor into
// a list, a counter, when it last did something — facts about the MODULE that
// outlive the project that called it. That is what these are for, and they are
// deliberately not variables: a project should not be able to reach them by
// spelling a name, and they should survive the run that made them.

/// One module's remembered facts, and whether the copy on disk is behind.
struct StateCell {
    map: HashMap<String, String>,
    loaded: bool,
}

fn states() -> &'static Mutex<HashMap<String, StateCell>> {
    static S: OnceLock<Mutex<HashMap<String, StateCell>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn state_path(module_id: &str) -> Result<PathBuf> {
    Ok(data_dir(module_id)?.join("state.json"))
}

/// Everything one module remembers is at most this, serialised. Generous for
/// cursors and counters, and far short of a module using the launcher as a
/// database it never asked permission for.
const MAX_STATE_BYTES: usize = 1 << 20;
const MAX_STATE_KEYS: usize = 2000;

/// Reads the file on first use.
///
/// A file that will not parse is RENAMED, not ignored: `unwrap_or_default()`
/// here would quietly discard everything the module remembered and the next
/// write would make that permanent. (For the grant file the opposite is right —
/// empty there means nothing is allowed, which fails closed.)
fn load_state(module_id: &str, cell: &mut StateCell) {
    if cell.loaded {
        return;
    }
    cell.loaded = true;
    let Ok(path) = state_path(module_id) else { return };
    let Ok(raw) = fs::read_to_string(&path) else { return };
    match serde_json::from_str::<HashMap<String, String>>(&raw) {
        Ok(map) => cell.map = map,
        Err(_) => {
            let _ = fs::rename(&path, path.with_extension("corrupt.json"));
        }
    }
}

fn state_get(module_id: &str, key: &str) -> String {
    let Ok(mut all) = states().lock() else { return String::new() };
    let cell = all
        .entry(module_id.to_string())
        .or_insert_with(|| StateCell { map: HashMap::new(), loaded: false });
    load_state(module_id, cell);
    cell.map.get(key).cloned().unwrap_or_default()
}

/// Writes one key through to disk, under the lock.
///
/// Per key and not the whole map because several workers run the same module at
/// once: a read-modify-write of the file would lose whichever update landed
/// first, silently, which is the worst way for remembered state to be wrong.
/// The lock is what makes the merge a merge.
fn state_set(module_id: &str, key: &str, value: &str) -> Result<()> {
    let mut all = states().lock().map_err(|_| anyhow!("state lock poisoned"))?;
    let cell = all
        .entry(module_id.to_string())
        .or_insert_with(|| StateCell { map: HashMap::new(), loaded: false });
    load_state(module_id, cell);

    if value.is_empty() {
        cell.map.remove(key);
    } else {
        if !cell.map.contains_key(key) && cell.map.len() >= MAX_STATE_KEYS {
            return Err(anyhow!("a module may remember {MAX_STATE_KEYS} things at once"));
        }
        cell.map.insert(key.to_string(), value.to_string());
    }

    let body = serde_json::to_vec_pretty(&cell.map)?;
    if body.len() > MAX_STATE_BYTES {
        cell.map.remove(key);
        return Err(anyhow!("what a module remembers may not pass 1 MB"));
    }
    let path = state_path(module_id)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    // Written whole and renamed into place: a half-written file is the one way
    // this could lose everything at once.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &body)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

/// A module's own folder: the only place on disk it can reach.
///
/// Beside the modules rather than inside a profile, because a module's notes
/// are the module's — a run that binds three profiles is still one module.
/// A path, not a directory that has been made: this is asked for on every block
/// a module runs, and creating it there would be a syscall per action. The
/// blocks that write already make their own parent.
pub fn data_dir(module_id: &str) -> Result<PathBuf> {
    Ok(modules_dir()?.join("data").join(module_id))
}

fn grant_path(module_id: &str) -> Result<PathBuf> {
    Ok(modules_dir()?.join(format!("{module_id}.grant.json")))
}

/// The sha256 of a module file, as hex.
pub fn digest(path: &PathBuf) -> String {
    use sha2::{Digest, Sha256};
    match fs::read(path) {
        Ok(bytes) => {
            let mut h = Sha256::new();
            h.update(&bytes);
            format!("{:x}", h.finalize())
        }
        Err(_) => String::new(),
    }
}

/// What `module_id` is allowed to call.
///
/// Fails closed at every turn: no file, unreadable file, or a digest that no
/// longer matches the binary all yield an empty grant. `unwrap_or_default()` is
/// right here for exactly that reason — for the state store it would be wrong.
pub fn grant_for(module_id: &str) -> Grant {
    let Ok(path) = grant_path(module_id) else { return Grant::default() };
    let Ok(raw) = fs::read_to_string(&path) else { return Grant::default() };
    let grant: Grant = serde_json::from_str(&raw).unwrap_or_default();
    let Ok(wasm_path) = modules_dir().map(|d| d.join(format!("{module_id}.wasm"))) else {
        return Grant::default();
    };
    if grant.decided_for.is_empty() || grant.decided_for != digest(&wasm_path) {
        return Grant::default();
    }
    grant
}

/// Records what the operator allowed, against the file as it stands now.
pub fn set_grant(module_id: &str, call_modules: Vec<String>, call_flows: Vec<String>) -> Result<Grant> {
    let wasm_path = modules_dir()?.join(format!("{module_id}.wasm"));
    if !wasm_path.exists() {
        return Err(anyhow!("module \"{module_id}\" is not installed"));
    }
    let grant = Grant {
        decided_for: digest(&wasm_path),
        call_modules,
        call_flows,
    };
    fs::write(grant_path(module_id)?, serde_json::to_vec_pretty(&grant)?)?;
    Ok(grant)
}

/// What a module asks for, if it asks at all.
pub fn manifest_of(module_id: &str) -> Manifest {
    let Ok(path) = modules_dir().map(|d| d.join(format!("{module_id}.wasm"))) else {
        return Manifest::default();
    };
    read_manifest(&path).unwrap_or_default()
}

/// Manifests, kept between steps and keyed the same way compiled modules are.
///
/// Reading one instantiates the module and calls into it, and this is asked for
/// on every step: without the cache a module that declares variables pays a
/// whole instantiation per block to be told what it already said.
fn manifests() -> &'static Mutex<HashMap<PathBuf, (std::time::SystemTime, Manifest)>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, (std::time::SystemTime, Manifest)>>> =
        OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The manifest if it is already known, without calling into the module.
///
/// `instantiate` needs it to size the store, and reading it the ordinary way
/// instantiates — which would be infinite. The first call therefore uses the
/// defaults; `describe`, `is_v2` and `run_step` all read the manifest properly
/// before a module is run, so by the time limits matter the cache is warm.
fn manifest_cached(path: &PathBuf) -> Option<Manifest> {
    let stamp = fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let cache = manifests().lock().ok()?;
    cache
        .get(path)
        .filter(|(seen, _)| *seen == stamp)
        .map(|(_, m)| m.clone())
}

fn read_manifest(path: &PathBuf) -> Result<Manifest> {
    let stamp = fs::metadata(path).and_then(|m| m.modified()).ok();
    if let (Some(stamp), Ok(cache)) = (stamp, manifests().lock()) {
        if let Some((seen, manifest)) = cache.get(path) {
            if *seen == stamp {
                return Ok(manifest.clone());
            }
        }
    }
    let manifest = read_manifest_uncached(path)?;
    if let (Some(stamp), Ok(mut cache)) = (stamp, manifests().lock()) {
        cache.insert(path.clone(), (stamp, manifest.clone()));
    }
    Ok(manifest)
}

fn read_manifest_uncached(path: &PathBuf) -> Result<Manifest> {
    let mut loaded = instantiate(path, HostState::plain())?;
    // No export means no request. That is the whole compatibility story.
    let Ok(f) = loaded.instance.get_typed_func::<(), i64>(&mut loaded.store, "manifest") else {
        return Ok(Manifest::default());
    };
    let packed = f.call(&mut loaded.store, ()).map_err(|e| anyhow!("manifest(): {e}"))?;
    let json = read_packed(&mut loaded, packed)?;
    if json.trim().is_empty() {
        return Ok(Manifest::default());
    }
    Ok(serde_json::from_str(&json).context("manifest() did not return JSON")?)
}

/// Copies a .wasm into the modules directory, refusing one that does not load.
pub fn install(from: &str) -> Result<ModuleInfo> {
    let src = PathBuf::from(from);
    let id = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow!("that file has no name"))?
        .to_string();
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(anyhow!("a module's file name may only use letters, digits, - and _"));
    }
    // Checked before it is installed, so a broken module never reaches the
    // library and cannot break the picker for everything else.
    let blocks = describe(&src)?;
    let dest = modules_dir()?.join(format!("{id}.wasm"));
    fs::copy(&src, &dest)?;
    Ok(ModuleInfo {
        id: id.clone(),
        name: id,
        path: dest.to_string_lossy().to_string(),
        blocks,
        error: String::new(),
    })
}

pub fn remove(module_id: &str) -> Result<()> {
    let path = modules_dir()?.join(format!("{module_id}.wasm"));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(patterns: &[&str], own: &[&str]) -> VarView {
        VarView {
            declared: patterns.iter().map(|s| s.to_string()).collect(),
            own: own.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn a_module_that_declares_nothing_sees_nothing_of_the_run() {
        let v = VarView::default();
        assert!(!v.sees("password"));
        let mut map = HashMap::new();
        map.insert("password".to_string(), "hunter2".to_string());
        map.insert("account".to_string(), "kit".to_string());
        assert!(v.filter(&map).is_empty(), "the run's variables are the operator's");

        // Its own are still its own, or it could not read back its own action.
        let mut v = v;
        v.note_targets(&serde_json::json!({ "kind": "readText", "into": "mine" }));
        assert!(v.sees("mine"));
        assert!(!v.sees("password"));
    }

    #[test]
    fn a_declaration_narrows_the_view() {
        let v = view(&["account", "order_*"], &[]);
        assert!(v.sees("account"));
        assert!(v.sees("order_id"));
        assert!(v.sees("order_"));
        assert!(!v.sees("password"));
        assert!(!v.sees("orders"), "a prefix is a prefix, not a fuzzy match");
        // account_id was not declared: "account" is exact without a star.
        assert!(!v.sees("account_id"));
    }

    #[test]
    fn a_module_always_reads_back_what_it_wrote_or_named() {
        let mut v = view(&["account"], &[]);
        assert!(!v.sees("_shx_tmp"));
        v.note_targets(&serde_json::json!({ "kind": "readText", "into": "_shx_tmp" }));
        assert!(v.sees("_shx_tmp"));
        // http.request writes three names off one, so a target is a prefix.
        assert!(v.sees("_shx_tmp_status"));
        v.note_written("counter");
        assert!(v.sees("counter"));
    }

    #[test]
    fn filtering_keeps_only_what_is_visible() {
        let v = view(&["keep_*"], &["mine"]);
        let mut map = HashMap::new();
        for k in ["keep_one", "keep_two", "mine", "mine_status", "secret"] {
            map.insert(k.to_string(), "x".to_string());
        }
        let out = v.filter(&map);
        assert_eq!(out.len(), 4);
        assert!(!out.contains_key("secret"));
    }

    /// The state store, against files under the test's own root, in a module id
    /// nothing else uses. Kept together in one test because they share a
    /// process-global cache and running them in parallel would have them fight over it.
    #[test]
    fn what_a_module_remembers_survives_and_is_bounded() {
        let _root = crate::store::test_root("modstate");
        let id = "modstate-selftest";
        let dir = match data_dir(id) {
            Ok(d) => d,
            Err(_) => return,
        };
        let _ = fs::remove_dir_all(&dir);
        states().lock().unwrap().remove(id);

        assert_eq!(state_get(id, "cursor"), "", "nothing remembered yet");
        state_set(id, "cursor", "page-3").unwrap();
        assert_eq!(state_get(id, "cursor"), "page-3");

        // It is on disk, not only in memory: forget the cache and read again.
        states().lock().unwrap().remove(id);
        assert_eq!(state_get(id, "cursor"), "page-3", "it must survive the cache");

        // Empty means forget.
        state_set(id, "cursor", "").unwrap();
        assert_eq!(state_get(id, "cursor"), "");

        // A file that will not parse is kept, not overwritten with emptiness.
        let path = state_path(id).unwrap();
        fs::write(&path, b"{ not json").unwrap();
        states().lock().unwrap().remove(id);
        assert_eq!(state_get(id, "anything"), "");
        assert!(
            path.with_extension("corrupt.json").exists(),
            "the unreadable file must be kept aside, not silently replaced"
        );

        // Too much is refused rather than written.
        states().lock().unwrap().remove(id);
        let _ = fs::remove_file(&path);
        let big = "x".repeat(MAX_STATE_BYTES + 16);
        let err = state_set(id, "huge", &big).unwrap_err().to_string();
        assert!(err.contains("1 MB"), "{err}");
        assert_eq!(state_get(id, "huge"), "", "the refused value must not stick");

        let _ = fs::remove_dir_all(&dir);
        states().lock().unwrap().remove(id);
    }

    #[test]
    fn what_a_module_asks_for_is_clamped_not_refused() {
        // Nothing declared: the defaults.
        assert_eq!(ceilings(None), (DEFAULT_FUEL, DEFAULT_MEMORY_MB));
        let ask = |fuel, mb| Manifest { fuel, memory_mb: mb, ..Manifest::default() };
        // A modest ask is honoured.
        assert_eq!(ceilings(Some(&ask(Some(1_000), Some(64)))), (1_000, 64));
        // A greedy one gets the ceiling rather than an error: refusing to run
        // over a number the author guessed is the worse failure.
        assert_eq!(
            ceilings(Some(&ask(Some(u64::MAX), Some(u32::MAX)))),
            (MAX_FUEL, MAX_MEMORY_MB)
        );
        // And zero is not a way to get an unlimited store by accident.
        assert_eq!(ceilings(Some(&ask(Some(0), Some(0)))), (1, 1));
    }

    #[test]
    fn a_grant_dies_with_the_digest_it_was_made_for() {
        let _root = crate::store::test_root("grant");
        // No file at all: nothing is granted, which is the failing-closed case
        // every path here is built on.
        let g = grant_for("a-module-that-is-not-installed");
        assert!(g.call_modules.is_empty() && g.call_flows.is_empty());
    }

    /// A child exiting signals the launcher; with the engine up that must not end it.
    /// Run in a process of its own, since what fails is an abort.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_signal_on_any_thread_does_not_abort_once_the_engine_is_up() {
        const CHILD: &str = "SHARDX_WASM_SIGNAL_CHILD";
        const NAME: &str = "wasm::tests::a_signal_on_any_thread_does_not_abort_once_the_engine_is_up";
        if std::env::var_os(CHILD).is_some() {
            extern "C" fn nothing(_: libc::c_int) {}
            // SAFETY: a handler that does nothing, then a signal to each thread of this process.
            unsafe {
                libc::signal(libc::SIGUSR2, nothing as *const () as libc::sighandler_t);
                let _ = engine();
                std::thread::sleep(std::time::Duration::from_millis(200));
                let mut list: libc::thread_act_array_t = std::ptr::null_mut();
                let mut n: libc::mach_msg_type_number_t = 0;
                #[allow(deprecated)]
                let task = libc::mach_task_self();
                assert_eq!(libc::task_threads(task, &mut list, &mut n), 0);
                for i in 0..n as usize {
                    let t = libc::pthread_from_mach_thread_np(*list.add(i));
                    if t != 0 {
                        libc::pthread_kill(t, libc::SIGUSR2);
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
            return;
        }
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", NAME, "--test-threads=1", "--nocapture"])
            .env(CHILD, "1")
            .output()
            .unwrap();
        let said = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
        assert!(out.status.success(), "the child ended with {:?}:\n{said}", out.status);
        assert!(said.contains("1 passed"), "the child ran nothing:\n{said}");
    }
}
