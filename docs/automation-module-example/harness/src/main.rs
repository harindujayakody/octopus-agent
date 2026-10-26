// Mirrors the launcher's host (src-tauri/src/wasm.rs) so a module can be
// exercised without a browser: same import names, same signatures, same
// packing. do_action is answered by a script instead of the runner.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use wasmtime::*;

#[derive(Default)]
struct Rec {
    actions: Vec<Value>,
    logs: Vec<String>,
}

struct Host {
    rec: Arc<Mutex<Rec>>,
    state: HashMap<String, String>,
    /// What the module declared it reads, plus what it wrote or named itself.
    /// The launcher narrows the map this way and so must this, or a module can
    /// pass here and read nothing there.
    declared: Vec<String>,
    own: Vec<String>,
    vars: HashMap<String, String>,
    pending: HashMap<String, String>,
    script: Arc<dyn Fn(&Value, usize) -> Value + Send + Sync>,
    clock: i64,
}

fn read_string(caller: &mut Caller<'_, Host>, ptr: i32, len: i32) -> Option<String> {
    let Some(Extern::Memory(mem)) = caller.get_export("memory") else { return None };
    let mut buf = vec![0u8; len.max(0) as usize];
    mem.read(&mut *caller, ptr.max(0) as usize, &mut buf).ok()?;
    String::from_utf8(buf).ok()
}

fn write_string(caller: &mut Caller<'_, Host>, text: &str) -> i64 {
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

impl Host {
    fn sees(&self, name: &str) -> bool {
        self.declared.iter().any(|p| match p.strip_suffix('*') {
            Some(prefix) => name.starts_with(prefix),
            None => p == name,
        }) || self.own.iter().any(|o| name.starts_with(o.as_str()))
    }
    fn visible(&self) -> HashMap<String, String> {
        self.vars.iter().filter(|(k, _)| self.sees(k))
            .map(|(k, v)| (k.clone(), v.clone())).collect()
    }
    fn note_targets(&mut self, v: &Value) {
        for key in ["into", "name"] {
            if let Some(t) = v.get(key).and_then(|x| x.as_str()) {
                let t = t.trim();
                if !t.is_empty() && !self.own.iter().any(|o| o == t) {
                    self.own.push(t.to_string());
                }
            }
        }
    }
}

fn linker(engine: &Engine) -> Result<Linker<Host>> {
    let mut l = Linker::new(engine);
    l.func_wrap("shardx", "log", |mut c: Caller<'_, Host>, p: i32, n: i32| {
        if let Some(s) = read_string(&mut c, p, n) {
            c.data().rec.lock().unwrap().logs.push(s);
        }
    })?;
    l.func_wrap("shardx", "do_action", |mut c: Caller<'_, Host>, p: i32, n: i32| -> i64 {
        let Some(text) = read_string(&mut c, p, n) else { return 0 };
        let Ok(action) = serde_json::from_str::<Value>(&text) else { return 0 };
        let (script, idx) = {
            let st = c.data_mut();
            st.note_targets(&action);
            for (k, v) in std::mem::take(&mut st.pending) {
                st.vars.insert(k, v);
            }
            let mut rec = st.rec.lock().unwrap();
            rec.actions.push(action.clone());
            (st.script.clone(), rec.actions.len() - 1)
        };
        let answer = script(&action, idx);
        {
            let st = c.data_mut();
            if let Some(w) = answer.get("write").and_then(|w| w.as_object()) {
                for (k, v) in w {
                    st.vars.insert(k.clone(), v.as_str().unwrap_or("").to_string());
                }
            }
            st.clock += answer.get("ms").and_then(|v| v.as_i64()).unwrap_or(10);
        }
        let st = c.data();
        let out = json!({
            "ok": answer.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            "flow": answer.get("flow").and_then(|v| v.as_str()).unwrap_or("next"),
            "error": answer.get("error").and_then(|v| v.as_str()).unwrap_or(""),
            "vars": st.visible(),
        });
        write_string(&mut c, &out.to_string())
    })?;
    l.func_wrap("shardx", "get_var", |mut c: Caller<'_, Host>, p: i32, n: i32| -> i64 {
        let Some(name) = read_string(&mut c, p, n) else { return 0 };
        let st = c.data();
        let v = if st.sees(&name) { st.vars.get(&name).cloned().unwrap_or_default() }
                else { String::new() };
        write_string(&mut c, &v)
    })?;
    l.func_wrap(
        "shardx",
        "set_var",
        |mut c: Caller<'_, Host>, kp: i32, kn: i32, vp: i32, vn: i32| -> i32 {
            let (Some(k), Some(v)) = (read_string(&mut c, kp, kn), read_string(&mut c, vp, vn))
            else {
                return 1;
            };
            let st = c.data_mut();
            if !st.own.iter().any(|o| *o == k) {
                st.own.push(k.clone());
            }
            st.vars.insert(k.clone(), v.clone());
            st.pending.insert(k, v);
            0
        },
    )?;
    // A clock that only moves when something happens, so a poll loop with a
    // deadline finishes instantly instead of running for real seconds.
    l.func_wrap("shardx", "now_ms", |c: Caller<'_, Host>| -> i64 { c.data().clock })?;
    l.func_wrap("shardx", "random", |mut c: Caller<'_, Host>, p: i32, n: i32| -> i32 {
        let buf = vec![7u8; n.max(0) as usize];
        let Some(Extern::Memory(mem)) = c.get_export("memory") else { return 1 };
        if mem.write(&mut c, p.max(0) as usize, &buf).is_err() { return 1 }
        0
    })?;
    l.func_wrap("shardx", "sleep_ms", |mut c: Caller<'_, Host>, ms: i64| {
        c.data_mut().clock += ms.clamp(0, 60_000);
    })?;
    l.func_wrap("shardx", "should_stop", |_: Caller<'_, Host>| -> i32 { 0 })?;
    // The state store, in memory: the point is that a module can read back what
    // it wrote, not where the launcher happens to keep it.
    l.func_wrap("shardx", "state_get", |mut c: Caller<'_, Host>, p: i32, n: i32| -> i64 {
        let Some(key) = read_string(&mut c, p, n) else { return 0 };
        let v = c.data().state.get(&key).cloned().unwrap_or_default();
        write_string(&mut c, &v)
    })?;
    l.func_wrap("shardx", "state_set",
        |mut c: Caller<'_, Host>, kp: i32, kn: i32, vp: i32, vn: i32| -> i32 {
            let (Some(k), Some(v)) = (read_string(&mut c, kp, kn), read_string(&mut c, vp, vn))
            else { return 1 };
            if v.is_empty() { c.data_mut().state.remove(&k); } else { c.data_mut().state.insert(k, v); }
            0
        })?;
    Ok(l)
}

struct Mod {
    store: Store<Host>,
    inst: Instance,
    rec: Arc<Mutex<Rec>>,
}

fn load(path: &str, script: Arc<dyn Fn(&Value, usize) -> Value + Send + Sync>) -> Result<Mod> {
    // Fuel has to be switched on at the ENGINE, exactly as the launcher does it;
    // under Engine::default() set_fuel fails and the ceiling does not exist.
    let mut config = Config::new();
    config.consume_fuel(true);
    let engine = Engine::new(&config)?;
    let module = Module::from_file(&engine, path)?;
    let rec = Arc::new(Mutex::new(Rec::default()));
    let mut store = Store::new(
        &engine,
        Host { rec: rec.clone(), state: HashMap::new(), declared: Vec::new(),
               own: Vec::new(), vars: HashMap::new(),
               pending: HashMap::new(), script, clock: 1_000 },
    );
    store.set_fuel(200_000_000)?;
    let inst = linker(&engine)?.instantiate(&mut store, &module)?;
    Ok(Mod { store, inst, rec })
}

fn take(m: &mut Mod, packed: i64) -> Result<String> {
    let ptr = ((packed >> 32) & 0xFFFF_FFFF) as usize;
    let len = (packed & 0xFFFF_FFFF) as usize;
    if len == 0 {
        return Ok(String::new());
    }
    let mem = m.inst.get_memory(&mut m.store, "memory").ok_or_else(|| anyhow!("no memory"))?;
    let mut buf = vec![0u8; len];
    mem.read(&mut m.store, ptr, &mut buf)?;
    if let Ok(d) = m.inst.get_typed_func::<(i32, i32), ()>(&mut m.store, "dealloc") {
        let _ = d.call(&mut m.store, (ptr as i32, len as i32));
    }
    Ok(String::from_utf8(buf)?)
}

fn call_step(m: &mut Mod, block: &str, params: Value) -> Result<Value> {
    m.store.data_mut().note_targets(&params);
    let input = json!({ "block": block, "params": params,
                        "vars": m.store.data().visible() }).to_string();
    let alloc = m.inst.get_typed_func::<i32, i32>(&mut m.store, "alloc")?;
    let ptr = alloc.call(&mut m.store, input.len() as i32)?;
    let mem = m.inst.get_memory(&mut m.store, "memory").ok_or_else(|| anyhow!("no memory"))?;
    mem.write(&mut m.store, ptr as usize, input.as_bytes())?;
    let f = m.inst.get_typed_func::<(i32, i32), i64>(&mut m.store, "step")?;
    let packed = f.call(&mut m.store, (ptr, input.len() as i32))?;
    let json = take(m, packed)?;
    Ok(serde_json::from_str(&json).unwrap_or(json!({})))
}

fn kinds(m: &Mod) -> Vec<String> {
    m.rec
        .lock()
        .unwrap()
        .actions
        .iter()
        .map(|a| a.get("kind").and_then(|k| k.as_str()).unwrap_or("?").to_string())
        .collect()
}

fn check(name: &str, ok: bool) {
    println!("{} {name}", if ok { "  ok " } else { "FAIL" });
    if !ok {
        std::process::exit(1);
    }
}

fn main() -> Result<()> {
    let path = std::env::args().nth(1).expect("path to .wasm");
    let none: Arc<dyn Fn(&Value, usize) -> Value + Send + Sync> = Arc::new(|_, _| json!({}));

    // ---- blocks() ----
    let mut m = load(&path, none.clone())?;
    let f = m.inst.get_typed_func::<(), i64>(&mut m.store, "blocks")?;
    let packed = f.call(&mut m.store, ())?;
    let text = take(&mut m, packed)?;
    let specs: Vec<Value> = serde_json::from_str(&text)?;
    check("blocks() returns JSON", !specs.is_empty());
    let allowed = ["text", "number", "url", "key", "select", "textarea", "resiloc"];
    let mut bad = Vec::new();
    for b in &specs {
        for field in ["kind", "label", "about"] {
            if b.get(field).and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                bad.push(format!("{:?} has no {field}", b.get("kind")));
            }
        }
        for p in b.get("params").and_then(|p| p.as_array()).cloned().unwrap_or_default() {
            let k = p.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            if !allowed.contains(&k) {
                bad.push(format!("{:?}: param kind {k:?}", b.get("kind")));
            }
            if p.get("name").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                bad.push(format!("{:?}: a param with no name", b.get("kind")));
            }
        }
    }
    check(&format!("{} blocks, every field the picker reads", specs.len()), bad.is_empty());

    // ---- manifest() ----
    let manifest: Value = match m.inst.get_typed_func::<(), i64>(&mut m.store, "manifest") {
        Ok(f) => {
            let packed = f.call(&mut m.store, ())?;
            serde_json::from_str(&take(&mut m, packed)?).unwrap_or(json!({}))
        }
        // No export is a valid answer: the module asks for nothing.
        Err(_) => json!({}),
    };
    println!("  -  asks to call: {}", manifest);
    if !bad.is_empty() {
        println!("{bad:#?}");
    }

    // ---- race: second selector wins ----
    let mut m = load(&path, Arc::new(|a, i| {
        let sel = a.get("selector").and_then(|v| v.as_str()).unwrap_or("");
        // ".late" only turns up on the third round of polling.
        if sel == ".late" && i >= 4 { json!({ "flow": "next" }) } else { json!({ "flow": "else" }) }
    }))?;
    let out = call_step(&mut m, "race", json!({
        "selectors": ".never\n.late", "patience": 30, "into": "winner"
    }))?;
    check("race: no error", out.get("error").and_then(|v| v.as_str()) == Some(""));
    let vars = m.store.data().vars.clone();
    check("race: the winner is the one that appeared", vars.get("winner").map(|s| s.as_str()) == Some(".late"));
    check("race: its position", vars.get("winner_index").map(|s| s.as_str()) == Some("2"));

    // ---- harvest: two pages, then the next link is gone ----
    let mut m = load(&path, Arc::new(|a, _| {
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let sel = a.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string();
        // A crude page: rows are named after the page they are on. The first
        // row changes after the click, which is what the module waits for.
        static PAGE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
        use std::sync::atomic::Ordering;
        match kind {
            "waitFor" => json!({}),
            "count" => json!({ "write": { "_shx_tmp": "2" } }),
            "readText" => {
                let p = PAGE.load(Ordering::Relaxed);
                let n = sel.rsplit_once('(').map(|(_, r)| r.trim_end_matches(')').to_string()).unwrap_or_default();
                json!({ "write": { "_shx_tmp": format!("p{p} row{n}") } })
            }
            "click" => { PAGE.fetch_add(1, Ordering::Relaxed); json!({}) }
            "if.exists" => {
                if PAGE.load(Ordering::Relaxed) >= 2 { json!({ "flow": "else" }) } else { json!({ "flow": "next" }) }
            }
            _ => json!({}),
        }
    }))?;
    let out = call_step(&mut m, "harvest", json!({
        "item": ".row", "next": ".next", "pages": 5, "into": "rows"
    }))?;
    check("harvest: no error", out.get("error").and_then(|v| v.as_str()) == Some(""));
    let vars = m.store.data().vars.clone();
    check("harvest: four rows over two pages", vars.get("rows_count").map(|s| s.as_str()) == Some("4"));
    check(
        "harvest: both pages, not the first one twice",
        vars.get("rows").map(|s| s.as_str()) == Some("p1 row1\np1 row2\np2 row1\np2 row2"),
    );

    // ---- api_pages: 429 then 200, and a short page ends it ----
    let mut m = load(&path, Arc::new(|_, i| {
        // Request #1 is rate-limited; #2 is the same page again and works;
        // #3 no longer holds the needle.
        match i {
            0 => json!({ "write": { "_shx_tmp_status": "429", "_shx_tmp": "" }, "ms": 5 }),
            1 => json!({ "write": { "_shx_tmp_status": "200", "_shx_tmp": "{\"items\":[1]}" } }),
            _ => json!({ "write": { "_shx_tmp_status": "200", "_shx_tmp": "{\"items\":[]}" } }),
        }
    }))?;
    let out = call_step(&mut m, "api_pages", json!({
        "url": "https://example.test/api?page={page}", "pages": 5,
        "while_contains": "\"items\":[1", "into": "body", "pause": 0
    }))?;
    check("api: no error", out.get("error").and_then(|v| v.as_str()) == Some(""));
    let vars = m.store.data().vars.clone();
    check("api: one page kept", vars.get("body_pages").map(|s| s.as_str()) == Some("1"));
    check("api: it retried the 429", kinds(&m).len() == 3);

    // ---- submit: a fatal complaint is not retried ----
    let mut m = load(&path, Arc::new(|a, _| {
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let sel = a.get("selector").and_then(|v| v.as_str()).unwrap_or("");
        match (kind, sel) {
            ("if.exists", ".ok") => json!({ "flow": "else" }),
            ("if.exists", ".err") => json!({ "flow": "next" }),
            ("readText", _) => json!({ "write": { "_shx_tmp": "Incorrect password" } }),
            _ => json!({}),
        }
    }))?;
    let out = call_step(&mut m, "submit", json!({
        "submit": "#go", "success": ".ok", "error": ".err",
        "give_up_on": "incorrect password\ncaptcha", "attempts": 3, "into": "why"
    }))?;
    check(
        "submit: stops on a fatal complaint",
        out.get("error").and_then(|v| v.as_str()) == Some("the form said: Incorrect password"),
    );
    check("submit: it pressed once, not three times", kinds(&m).iter().filter(|k| *k == "click").count() == 1);

    // ---- feed: no touchscreen, so the wheel ----
    let mut m = load(&path, Arc::new(|a, _| {
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(3);
        use std::sync::atomic::Ordering;
        match kind {
            "touch.swipe" => json!({ "ok": false, "error": "\"touch.swipe\" is a finger gesture and this profile has no touchscreen — bind a phone profile" }),
            // The feed grows twice and then stops.
            "scroll" => { if N.load(Ordering::Relaxed) < 9 { N.fetch_add(3, Ordering::Relaxed); } json!({}) }
            "count" => json!({ "write": { "_shx_tmp": N.load(Ordering::Relaxed).to_string() } }),
            "if.exists" => json!({ "flow": "else" }),
            _ => json!({}),
        }
    }))?;
    let out = call_step(&mut m, "feed", json!({ "item": ".card", "swipes": 20, "into": "cards" }))?;
    check("feed: no error", out.get("error").and_then(|v| v.as_str()) == Some(""));
    let ks = kinds(&m);
    check("feed: one refused swipe, then the wheel", ks.iter().filter(|k| *k == "touch.swipe").count() == 1 && ks.contains(&"scroll".to_string()));
    let vars = m.store.data().vars.clone();
    check("feed: it stopped when the feed stopped growing", vars.get("cards").map(|s| s.as_str()) == Some("9"));

    // ---- compose: calls a flow, then another module ----
    let mut m = load(&path, Arc::new(|a, _| {
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "flow.call" => json!({ "write": { "session": "s-77" } }),
            "count" => json!({ "write": { "_shx_n": "2" } }),
            "readText" => json!({ "write": { "_shx_t": "a row" } }),
            k if k.starts_with("module:") => json!({ "write": { "out": "parsed!" } }),
            _ => json!({}),
        }
    }))?;
    let out = call_step(&mut m, "compose", json!({
        "login_flow": "Log in", "user": "kit", "pass": "x",
        "item": ".row", "parser": "csv-tools", "parser_block": "parse", "into": "out"
    }))?;
    check("compose: no error", out.get("error").and_then(|v| v.as_str()) == Some(""));
    let ks = kinds(&m);
    check("compose: signed in through the flow first", ks.first().map(String::as_str) == Some("flow.call"));
    check("compose: then handed the rows to the other module",
          ks.last().map(|k| k.starts_with("module:csv-tools:")).unwrap_or(false));
    let asked: Option<Value> = m.rec.lock().unwrap().actions.iter()
        .find(|a| a.get("kind").and_then(|k| k.as_str()) == Some("flow.call"))
        .cloned();
    check(
        "compose: the flow call names what it gives and takes",
        asked
            .map(|a| {
                a.get("in").and_then(|v| v.as_str()).unwrap_or("").contains("user=kit")
                    && a.get("out").and_then(|v| v.as_str()) == Some("session")
            })
            .unwrap_or(false),
    );

    // ---- a refused call is reported, not swallowed ----
    let mut m = load(&path, Arc::new(|a, _| {
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "flow.call" {
            json!({ "ok": false, "error": "\"demo\" was not given permission to call that flow — grant it in Modules" })
        } else { json!({}) }
    }))?;
    let out = call_step(&mut m, "compose", json!({
        "login_flow": "Log in", "item": ".row", "into": "out"
    }))?;
    check("refusal: the step stops and says why",
          out.get("error").and_then(|v| v.as_str()).unwrap_or("").contains("permission"));

    // ---- the run's variables are the operator's ----
    let mut m = load(&path, none.clone())?;
    {
        let st = m.store.data_mut();
        st.declared = manifest.get("vars").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        st.vars.insert("password".into(), "hunter2".into());
        st.vars.insert("account".into(), "kit".into());
    }
    let seen = m.store.data().visible();
    check("variables: a name it declared is visible", seen.contains_key("account"));
    check("variables: one it did not is not", !seen.contains_key("password"));
    {
        let st = m.store.data_mut();
        st.note_targets(&json!({ "into": "mine" }));
        st.vars.insert("mine".into(), "x".into());
    }
    check("variables: its own always are", m.store.data().visible().contains_key("mine"));

    println!("\nlogs from the last run:");
    for l in &m.rec.lock().unwrap().logs {
        println!("  - {l}");
    }
    println!("\nall checks passed");
    Ok(())
}
