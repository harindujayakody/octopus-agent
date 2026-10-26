//! The host side of the module ABI, wrapped so a module can be written in
//! ordinary Rust.
//!
//! Nothing here is specific to this example: it is the whole host surface, so
//! the file can be copied into a module of your own and used as it is. Not
//! every wrapper is used by this example's blocks.
//!
//! The shape of the contract: strings cross the boundary as a pointer and a
//! length packed into one i64, `ptr << 32 | len`. One return value is all a
//! wasm export can promise without multi-value, which not every toolchain
//! emits.
//!
//! Who frees what: a string the HOST returns was allocated with this module's
//! own `alloc`, so this module frees it — `take_packed` below does that. A
//! string this module returns is freed by the host through `dealloc`.

#![allow(dead_code)]

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

// ---- what the host provides ----
//
// A module that imports none of these still runs — the host keeps the older
// contract for ever. Importing `do_action` is what lets a module react to what
// its own actions did, and exporting `step` is what tells the host so.
#[link(wasm_import_module = "shardx")]
extern "C" {
    fn log(ptr: i32, len: i32);
    /// Perform one step of the launcher's own vocabulary and answer with the
    /// result. This is the whole palette — goto, click, readText, http.request,
    /// db.query — reachable by name.
    fn do_action(ptr: i32, len: i32) -> i64;
    fn get_var(ptr: i32, len: i32) -> i64;
    fn set_var(kptr: i32, klen: i32, vptr: i32, vlen: i32) -> i32;
    fn now_ms() -> i64;
    fn random(ptr: i32, len: i32) -> i32;
    /// Waiting costs wall-clock, not fuel: a module watching a page is doing
    /// the right thing and is not charged for it.
    fn sleep_ms(ms: i64);
    /// 1 once the operator has stopped the run. A module that works for a
    /// while is expected to ask, and to leave when the answer is yes.
    fn should_stop() -> i32;
    /// What this module remembered, from any earlier step or run.
    fn state_get(ptr: i32, len: i32) -> i64;
    fn state_set(kptr: i32, klen: i32, vptr: i32, vlen: i32) -> i32;
}

// ---- exports the host calls ----

#[no_mangle]
pub extern "C" fn alloc(len: i32) -> *mut u8 {
    let mut buf = Vec::with_capacity(len.max(0) as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: i32) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(0) as usize)) }
}

pub fn pack(s: String) -> i64 {
    let bytes = s.into_bytes();
    let len = bytes.len() as i64;
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr() as i64;
    std::mem::forget(boxed);
    (ptr << 32) | len
}

pub fn unpack(ptr: i32, len: i32) -> String {
    let slice = unsafe { std::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
    String::from_utf8_lossy(slice).into_owned()
}

/// Reads a packed string the host returned and frees it. Zero means the host
/// had nothing to say, which is not an error.
fn take_packed(packed: i64) -> String {
    let ptr = ((packed >> 32) & 0xFFFF_FFFF) as *mut u8;
    let len = (packed & 0xFFFF_FFFF) as usize;
    // Zero is the host saying "nothing", and an empty answer owns no memory.
    if ptr.is_null() || len == 0 {
        return String::new();
    }
    let s = unsafe { String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned() };
    unsafe { drop(Vec::from_raw_parts(ptr, len, len)) };
    s
}

// ---- the friendly side ----

/// What an action answered.
pub struct Done {
    pub ok: bool,
    /// "else" when a conditional step took its other branch.
    pub flow: String,
    pub error: String,
    /// Every variable of the run, after the action. A step that writes into a
    /// variable — readText, count, http.request — shows up here.
    pub vars: serde_json::Map<String, Value>,
}

impl Done {
    pub fn var(&self, name: &str) -> String {
        self.vars.get(name).and_then(|v| v.as_str()).unwrap_or("").to_string()
    }
}

/// Perform one step. `kind` is any the launcher knows; the rest of the object
/// is that step's parameters, exactly as the palette spells them.
pub fn act(kind: &str, params: Value) -> Done {
    let mut obj = match params {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    obj.insert("kind".into(), json!(kind));
    let text = Value::Object(obj).to_string();
    let packed = unsafe { do_action(text.as_ptr() as i32, text.len() as i32) };
    let reply = take_packed(packed);
    let v: Value = serde_json::from_str(&reply).unwrap_or(Value::Null);
    Done {
        ok: v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false),
        flow: v.get("flow").and_then(|x| x.as_str()).unwrap_or("next").to_string(),
        error: v.get("error").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        vars: v.get("vars").and_then(|x| x.as_object()).cloned().unwrap_or_default(),
    }
}

/// Run a block another module provides, and get its result.
///
/// Only what the operator granted this module in Modules is reachable; anything
/// else comes back as a refusal with a message saying so. Four frames deep at
/// most, and a chain that goes round in a circle is refused as the loop it is.
pub fn call_module(module_id: &str, block: &str, params: Value) -> Done {
    act(&format!("module:{module_id}:{block}"), params)
}

/// Run one of the operator's saved projects as a piece of this step.
///
/// `entry` names a flow.entry marker inside it, or is empty for wherever the
/// project starts on its own. `give` and `take` make the call a function: the
/// flow then sees only what was handed to it, and only the names in `take` come
/// back. Leave both empty and it shares every variable of the run.
pub fn call_flow(flow: &str, entry: &str, give: &[(&str, &str)], take: &[&str]) -> Done {
    let given = give
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\n");
    act(
        "flow.call",
        json!({
            // A name, not an id: a module is written before it has met anyone's
            // projects. The launcher resolves it and refuses an ambiguous one.
            "projectName": flow,
            "entry": entry,
            "in": given,
            "out": take.join(","),
        }),
    )
}

pub fn say(line: impl AsRef<str>) {
    let s = line.as_ref();
    unsafe { log(s.as_ptr() as i32, s.len() as i32) }
}

pub fn var(name: &str) -> String {
    take_packed(unsafe { get_var(name.as_ptr() as i32, name.len() as i32) })
}

pub fn set(name: &str, value: &str) {
    unsafe {
        set_var(
            name.as_ptr() as i32,
            name.len() as i32,
            value.as_ptr() as i32,
            value.len() as i32,
        );
    }
}

/// Something this module remembered — from an earlier step, or an earlier run
/// on another day. Empty when it never did.
///
/// Not a variable: a project cannot reach it by spelling a name, and it outlives
/// the run that made it. Use it for a cursor into a list, a counter, when
/// something last happened.
pub fn recall(key: &str) -> String {
    take_packed(unsafe { state_get(key.as_ptr() as i32, key.len() as i32) })
}

/// Remembers something. An empty value forgets it.
///
/// Bounded: 2000 keys and a megabyte in total, per module. Going past either is
/// refused and logged rather than silently dropped.
pub fn remember(key: &str, value: &str) -> bool {
    unsafe {
        state_set(
            key.as_ptr() as i32,
            key.len() as i32,
            value.as_ptr() as i32,
            value.len() as i32,
        ) == 0
    }
}

pub fn now() -> i64 {
    unsafe { now_ms() }
}

pub fn wait(ms: i64) {
    unsafe { sleep_ms(ms) }
}

pub fn stopping() -> bool {
    unsafe { should_stop() == 1 }
}

/// A number below `max`, from the HOST's randomness.
///
/// Not a seeded generator of the module's own: every profile of a fleet would
/// then behave identically, which is a fingerprint in itself.
pub fn roll(max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    let mut buf = [0u8; 4];
    unsafe { random(buf.as_mut_ptr() as i32, 4) };
    u32::from_le_bytes(buf) % max
}

/// The step's own input: which block was placed, its parameters, and the
/// variables as they were on entry.
#[derive(serde::Deserialize)]
pub struct Input {
    #[serde(default)]
    pub block: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub vars: Value,
}

impl Input {
    pub fn param(&self, name: &str) -> String {
        self.params.get(name).and_then(|v| v.as_str()).unwrap_or("").to_string()
    }
    pub fn number(&self, name: &str, fallback: f64) -> f64 {
        self.params
            .get(name)
            .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(fallback)
    }
    pub fn parse<T: DeserializeOwned>(&self) -> Option<T> {
        serde_json::from_value(self.params.clone()).ok()
    }
}

/// What a block answers with. `error` non-empty stops the step.
pub fn finish(error: &str) -> i64 {
    pack(json!({ "error": error }).to_string())
}
