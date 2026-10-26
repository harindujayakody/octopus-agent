//! A live end-to-end check of teams and personal sync, by hand: the real
//! team-server binary over plain http by IP, launcher "devices" as separate
//! processes (this test binary started again, each with a data root and a
//! device id of its own, driving the same functions the Tauri commands call),
//! the real browser engine started by the launcher's own launch code, a local
//! test site, a local HTTP proxy, and CDP to look inside the browser.
//!
//! Ignored, and a no-op unless pointed at a server binary and an engine:
//!
//! ```text
//! SHARDX_LIVE_SERVER=team-server/target/debug/shardbrowser-team-server \
//! SHARDX_ENGINE=/path/to/ShardX.app \
//! cargo test --lib live_e2e::run -- --ignored --nocapture
//! ```
//!
//! Optional: `SHARDX_LIVE_OUT` (roots, logs, evidence.json/.md; a temp dir
//! otherwise), `SHARDX_LIVE_FINGERPRINT` (a library fingerprint JSON;
//! otherwise `profiles/examples/mac-m2-air13.json` above the engine) and
//! `SHARDX_LIVE_ONLY` (scenario ids, comma-separated, e.g. `D1,T4`; T1 to T3
//! always run, the rest lean on them). Browsers open headed, started as the
//! local API starts them (with CDP); every scenario's checks and evidence go
//! to `evidence.md`, and a failed check does not stop the run.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const ENV_SERVER: &str = "SHARDX_LIVE_SERVER";
const ENV_ENGINE: &str = "SHARDX_ENGINE";
const ENV_OUT: &str = "SHARDX_LIVE_OUT";
const ENV_FP: &str = "SHARDX_LIVE_FINGERPRINT";
const ENV_ROLE: &str = "SHARDX_LIVE_ROLE";
const ENV_ROOT: &str = "SHARDX_LIVE_ROOT";
const ENV_NAME: &str = "SHARDX_LIVE_NAME";
/// A device's answers on stdout start with this; everything else is its log.
const MARK: &str = "@@LIVE ";
/// The library fingerprint every device creates its profiles from.
const FP_ID: &str = "live-mac";

/// The executable inside an app bundle, or the path as given.
fn engine_binary(p: &Path) -> PathBuf {
    if p.extension().is_some_and(|e| e == "app") {
        p.join("Contents").join("MacOS").join("ShardX")
    } else {
        p.to_path_buf()
    }
}

/// `profiles/examples/mac-m2-air13.json` in a folder above the engine.
fn fingerprint_near(engine: &Path) -> Option<PathBuf> {
    engine.ancestors().map(|a| a.join("profiles/examples/mac-m2-air13.json")).find(|p| p.is_file())
}

/// An invite as the join form splits it: the address, and the token after "#".
fn split_invite(text: &str) -> Option<(String, String)> {
    let s = text.trim();
    let at = ["#stm_", "#eyJ"].iter().filter_map(|m| s.find(m)).min()?;
    (at > 0).then(|| (s[..at].to_string(), s[at + 1..].to_string()))
}

// =====================================================================
// The device: one launcher, driven over stdin/stdout.
// =====================================================================

mod device {
    use super::*;

    static T0: OnceLock<Instant> = OnceLock::new();
    static EVENTS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

    fn ms() -> u64 {
        T0.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    /// What the launcher tells its windows, kept for the harness to read.
    fn record(event: &str, payload: Value) {
        let e = json!({ "t": ms(), "event": event, "payload": payload });
        EVENTS.lock().unwrap_or_else(|e| e.into_inner()).push(e);
    }

    fn say(v: Value) {
        println!("{MARK}{v}");
    }

    fn val<T: serde::Serialize>(v: T) -> Value {
        serde_json::to_value(v).unwrap_or(Value::Null)
    }

    /// The space's edition, as the window sends it with every write.
    fn epoch() -> Option<u64> {
        Some(crate::team::space_epoch())
    }

    fn team() -> Result<String, String> {
        crate::team::active_team().ok_or_else(|| "harness: not in a team space".to_string())
    }

    fn s(a: &Value, k: &str) -> String {
        a.get(k).and_then(Value::as_str).unwrap_or_default().to_string()
    }

    fn from<T: serde::de::DeserializeOwned>(v: &Value) -> Result<T, String> {
        serde_json::from_value(v.clone()).map_err(|e| format!("harness: {e}"))
    }

    /// The app's setup, the parts a launcher without a window runs.
    async fn setup(name: &str, engine: &Path, fp: &Path) -> Result<Value, String> {
        let mut st = crate::settings_get()?;
        st.browser_path = Some(engine.display().to_string());
        crate::settings_save(st)?;
        let text = std::fs::read_to_string(fp).map_err(|e| format!("{}: {e}", fp.display()))?;
        crate::fingerprints::import(&text, Some(FP_ID.into())).map_err(|e| e.to_string())?;
        crate::team::set_device_name(name).map_err(|e| e.to_string())?;
        crate::space::live::set_tell(Arc::new(|event: &str, payload| record(event, payload)));
        crate::space::extensions::at_launch();
        crate::space::open::sweep();
        crate::space::live::follow_joined();
        crate::space::sync::start();
        Ok(json!({ "pid": std::process::id(), "device_id": crate::team::device_id(), "name": name }))
    }

    /// Until the profile's browser is gone and its close has run to the end.
    async fn closed(id: &str, within: Duration) -> Result<u64, String> {
        let t0 = Instant::now();
        loop {
            let open = crate::space::open::listed().iter().any(|l| l.profile_id == id);
            if !open && !crate::process::Tracker::shared().is_running(id) {
                return Ok(t0.elapsed().as_millis() as u64);
            }
            if t0.elapsed() > within {
                return Err(format!("harness: {id} still open after {within:?}"));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn sync_settled(within: Duration) -> Value {
        let t0 = Instant::now();
        loop {
            let st = crate::sync_state().await;
            if st.status.state != "syncing" || t0.elapsed() > within {
                return val(st);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// A profile's settings with `config` and `meta` merged in, saved as the editor saves.
    async fn edit(id: &str, config: &Value, meta: &Value) -> Result<Value, String> {
        let mut p = crate::profile_get(id.to_string()).await?;
        if let Some(c) = config.as_object() {
            for (k, v) in c {
                p[k] = v.clone();
            }
        }
        if let Some(m) = meta.as_object() {
            for (k, v) in m {
                p["_meta"][k] = v.clone();
            }
        }
        let t = crate::ticket(epoch())?;
        crate::save_profile_core(None, p, true, crate::space::Door("profile_save"), &t)
            .await
            .map(val)
            .map_err(|e| e.to_string())
    }

    async fn handle(cmd: &str, a: Value) -> Result<Value, String> {
        match cmd {
            "state" => {
                let space = crate::team::state().map_err(|e| e.to_string())?;
                let teams = crate::team::followed();
                Ok(json!({
                    "space": val(&space),
                    "followed": teams,
                    "device_id": crate::team::device_id(),
                    "sync": val(crate::sync_state().await),
                }))
            }
            // ---- spaces ----
            "join" => {
                let (server, token) = split_invite(&s(&a, "invite")).ok_or("harness: not an invite")?;
                crate::space::join(&server, &token).await.map(val).map_err(|e| e.to_string())
            }
            "switch" => {
                let to = match s(&a, "team").as_str() {
                    "" => crate::team::Space::Personal,
                    t => crate::team::Space::Team { team_id: t.to_string() },
                };
                crate::space::switch(to).await.map(val).map_err(|e| e.to_string())
            }
            // ---- the admin's Team page ----
            "admin_folder_create" => {
                crate::team_admin_folder_create(team()?, s(&a, "name"), None).await.map(val)
            }
            "admin_member_create" => {
                let m = crate::team_admin_member_create(team()?, s(&a, "name")).await?;
                Ok(json!({ "member": val(&m.member), "invite": m.invite }))
            }
            "admin_set_grants" => {
                crate::team_admin_set_grants(team()?, s(&a, "member"), from(&a["grants"])?).await.map(val)
            }
            "admin_member_delete" => crate::team_admin_member_delete(team()?, s(&a, "member")).await.map(val),
            "admin_overview" => crate::team_admin_overview(team()?).await.map(val),
            // ---- the team's trash, as the Team page reads it ----
            "trash_list" => crate::team_trash_list(team()?).await.map(val),
            "trash_restore" => crate::team_trash_restore(team()?, s(&a, "id"), s(&a, "kind")).await.map(val),
            "my_access" => crate::team_my_access(team()?).await.map(val),
            // ---- profiles ----
            "profiles" => crate::profile_list().await.map(val),
            "profile_get" => crate::profile_get(s(&a, "id")).await,
            "create_profile" => {
                let mut m = crate::library_profile(FP_ID, None)?;
                m.insert("name".into(), Value::String(s(&a, "name")));
                if let Some(meta) = m.get_mut("_meta").and_then(Value::as_object_mut) {
                    meta.insert("folder".into(), Value::String(s(&a, "folder")));
                }
                let t = crate::ticket(epoch())?;
                crate::save_profile_core(None, Value::Object(m), true, crate::space::Door("profile_save"), &t)
                    .await
                    .map(val)
                    .map_err(|e| e.to_string())
            }
            "edit_profile" => edit(&s(&a, "id"), &a["config"], &a["meta"]).await,
            // ---- starting and stopping, as the local API starts with CDP ----
            "launch" => {
                let id = s(&a, "id");
                let t0 = Instant::now();
                let o = crate::launch::launch_profile(&id, true, false).await.map_err(|e| e.to_string())?;
                Ok(json!({
                    "pid": o.pid,
                    "ws": o.cdp.map(|c| c.web_socket_debugger_url),
                    "cdp_error": o.cdp_error,
                    "ms": t0.elapsed().as_millis() as u64,
                }))
            }
            // As the automation studio starts: the launcher's bus goes along, and CDP.
            "launch_bus" => {
                let id = s(&a, "id");
                let b = crate::bus().await?;
                let o = crate::launch::launch_profile_synced(&id, true, false, None, b.port, &b.token)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(json!({ "pid": o.pid, "ws": o.cdp.map(|c| c.web_socket_debugger_url), "cdp_error": o.cdp_error }))
            }
            // Whether the profile's browser greeted the bus offering `{"quit":true}`.
            "bus_quits" => Ok(json!(crate::bus_now().is_some_and(|b| b.quits(&s(&a, "id"))))),
            "stop" => {
                let id = s(&a, "id");
                let since = ms();
                let killed = crate::process_kill(id.clone()).await?;
                let took = closed(&id, Duration::from_secs(a["secs"].as_u64().unwrap_or(120))).await?;
                Ok(json!({ "killed": killed, "closed_ms": took, "events": events_since(since) }))
            }
            // ---- failure modes ----
            "launch_twice" => {
                let id = s(&a, "id");
                let gap = a["gap_ms"].as_u64().unwrap_or(0);
                let t0 = Instant::now();
                let show = |r: anyhow::Result<crate::launch::LaunchOutcome>, d: Duration| match r {
                    Ok(o) => json!({ "ok": true, "pid": o.pid, "ws": o.cdp.map(|c| c.web_socket_debugger_url), "ms": d.as_millis() as u64 }),
                    Err(e) => json!({ "ok": false, "error": e.to_string(), "ms": d.as_millis() as u64 }),
                };
                let one = async { (crate::launch::launch_profile(&id, true, false).await, t0.elapsed()) };
                let two = async {
                    tokio::time::sleep(Duration::from_millis(gap)).await;
                    (crate::launch::launch_profile(&id, true, false).await, t0.elapsed())
                };
                let ((r1, d1), (r2, d2)) = tokio::join!(one, two);
                Ok(json!({ "first": show(r1, d1), "second": show(r2, d2) }))
            }
            "profile_delete" => crate::profile_delete(s(&a, "id"), epoch()).await.map(|_| Value::Null),
            "admin_member_reissue" => {
                let m = crate::team_admin_member_reissue(team()?, s(&a, "member")).await?;
                Ok(json!({ "member": val(&m.member), "invite": m.invite }))
            }
            "open_list" => Ok(val(crate::space::open::listed())),
            "wall" => Ok(json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))),
            "wait_closed" => {
                let since = a["since"].as_u64().unwrap_or(0);
                let took = closed(&s(&a, "id"), Duration::from_secs(a["secs"].as_u64().unwrap_or(60))).await?;
                Ok(json!({ "closed_ms": took, "events": events_since(since) }))
            }
            "running" => Ok(val(crate::process_list())),
            "sessions" => Ok(val(crate::team_sessions())),
            "events" => Ok(events_since(a["since"].as_u64().unwrap_or(0))),
            "now" => Ok(json!(ms())),
            // ---- the rest of a space ----
            "bookmark_save" => crate::bookmark_save(from(&a["entry"])?, epoch()).await.map(val),
            "bookmark_list" => crate::bookmark_list().await.map(val),
            "extension_import" => {
                let r = crate::extension_import(vec![s(&a, "path")], epoch(), None).await?;
                // One file: refused, its reason is the answer, as before several files were taken.
                match r.refused.into_iter().next() {
                    Some(no) if r.added.is_empty() => Err(no.error),
                    _ => Ok(val(r.added)),
                }
            }
            "extension_list" => crate::extension_list().await.map(val),
            "proxy_save" => crate::proxy_save(from(&a["entry"])?, epoch()).await.map(val),
            "proxy_list" => crate::proxy_list().await.map(val),
            "bind_proxy" => crate::profile_bind_proxy(s(&a, "id"), Some(s(&a, "proxy")), epoch()).await.map(val),
            "folder_add" => crate::folder_add(s(&a, "name"), epoch()).await.map(val),
            "set_folder" => crate::profile_set_folder(s(&a, "id"), s(&a, "folder"), epoch()).await.map(val),
            "folder_list" => crate::folder_list().await.map(val),
            "tag_save" => crate::tag_save(from(&a["tag"])?, None, epoch()).await.map(val),
            "tag_assign" => crate::tag_assign(from(&a["by_profile"])?, epoch()).await.map(val),
            "tag_list" => crate::tag_list().await.map(val),
            "automation_create" => crate::automation_create(s(&a, "name"), epoch()).await.map(val),
            "automation_save" => crate::automation_save(from(&a["project"])?, epoch()).await.map(val),
            "automation_list" => crate::automation_list().await.map(val),
            // ---- personal sync ----
            "sync_connect" => {
                let (server, token) = match split_invite(&s(&a, "invite")) {
                    Some((s, t)) => (Some(s), Some(t)),
                    None => (None, None),
                };
                let team = Some(s(&a, "team")).filter(|t| !t.is_empty());
                crate::sync_connect(server, token, team).await.map(val)
            }
            "sync_state" => Ok(val(crate::sync_state().await)),
            "sync_now" => {
                crate::sync_now().await?;
                tokio::time::sleep(Duration::from_millis(200)).await;
                Ok(sync_settled(Duration::from_secs(120)).await)
            }
            "sync_settled" => Ok(sync_settled(Duration::from_secs(120)).await),
            "sync_invite" => crate::sync_invite().await.map(|i| json!(i.invite)),
            "sync_disconnect" => crate::sync_disconnect(a["remove"].as_bool().unwrap_or(false)).await.map(val),
            "sync_set" => {
                let ids: Vec<String> = from(&a["ids"])?;
                crate::profile_sync_set(ids, a["on"].as_bool().unwrap_or(true)).await.map(val)
            }
            other => Err(format!("harness: no command {other}")),
        }
    }

    fn events_since(since: u64) -> Value {
        let all = EVENTS.lock().unwrap_or_else(|e| e.into_inner());
        Value::Array(all.iter().filter(|e| e["t"].as_u64().unwrap_or(0) >= since).cloned().collect())
    }

    pub(super) fn main(name: String, root: PathBuf, engine: PathBuf, fp: PathBuf) {
        let config = root.join("config");
        std::fs::create_dir_all(&config).expect("the device's config dir");
        // Every thread of this launcher, the runtime's and its blocking pool's,
        // reads this device's settings, and starts reapers as the app does.
        let on_start = {
            let config = config.clone();
            move || {
                crate::store::set_test_config(Some(config.clone()));
                crate::space::reap::tests::spawn_reapers(true);
            }
        };
        on_start();
        crate::store::set_data_root(Some(root.join("data")));
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(4)
            .on_thread_start(on_start)
            .build()
            .expect("a runtime");
        rt.block_on(async move {
            T0.get_or_init(Instant::now);
            match setup(&name, &engine, &fp).await {
                Ok(v) => say(json!({ "ready": v })),
                Err(e) => {
                    say(json!({ "ready": null, "error": e }));
                    std::process::exit(3);
                }
            }
            // Commands come one line each; each answers on its own, by id.
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::stdin().lock().lines() {
                    let Ok(line) = line else { break };
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
            while let Some(line) = rx.recv().await {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                let id = msg["id"].clone();
                let cmd = msg["cmd"].as_str().unwrap_or_default().to_string();
                if cmd == "exit" {
                    // As the app quits: what is open here is closed and sent back first.
                    crate::space::open::close_all(crate::space::open::QUIT_WAIT).await;
                    say(json!({ "id": id, "ok": true, "value": null }));
                    std::process::exit(0);
                }
                let args = msg["args"].clone();
                tokio::spawn(async move {
                    let r = handle(&cmd, args).await;
                    say(match r {
                        Ok(v) => json!({ "id": id, "ok": true, "value": v }),
                        Err(e) => json!({ "id": id, "ok": false, "error": e }),
                    });
                });
            }
            // The harness went away: quit as the app would.
            crate::space::open::close_all(crate::space::open::QUIT_WAIT).await;
            std::process::exit(0);
        });
    }
}

/// One launcher of the live run; does nothing unless started by [`run`].
#[test]
#[ignore = "started by live_e2e::run"]
fn device() {
    let Ok(name) = std::env::var(ENV_NAME) else { return };
    let root = PathBuf::from(std::env::var(ENV_ROOT).expect("SHARDX_LIVE_ROOT"));
    let engine = PathBuf::from(std::env::var(ENV_ENGINE).expect("SHARDX_ENGINE"));
    let fp = PathBuf::from(std::env::var(ENV_FP).expect("SHARDX_LIVE_FINGERPRINT"));
    device::main(name, root, engine, fp);
}

// =====================================================================
// The harness: server, devices, site, proxy, CDP, the scenarios, the report.
// =====================================================================

mod harness {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::process::{Child, ChildStdin, Command};

    pub type R<T = ()> = Result<T, String>;

    fn e2s<E: std::fmt::Display>(e: E) -> String {
        format!("harness: {e}")
    }

    pub fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn append(path: &Path) -> std::fs::File {
        std::fs::OpenOptions::new().create(true).append(true).open(path).expect("a log file")
    }

    // ---- the team server, its own binary ----

    pub struct Server {
        pub bin: PathBuf,
        pub data: PathBuf,
        pub port: u16,
        pub log: PathBuf,
        pub child: Option<Child>,
        /// Extra environment, e.g. the wall-clock shim.
        pub env: Vec<(String, String)>,
    }

    impl Server {
        pub fn url(&self) -> String {
            format!("http://127.0.0.1:{}", self.port)
        }

        /// Started on its data dir; the admin invite on a first run.
        pub async fn start(&mut self) -> R<Option<String>> {
            let first = !self.data.join("team.sqlite").exists();
            let log = append(&self.log);
            let mut cmd = Command::new(&self.bin);
            cmd.env("SHARDBROWSER_TEAM_DATA_DIR", &self.data)
                .env("SHARDBROWSER_TEAM_BIND", format!("127.0.0.1:{}", self.port))
                .env("SHARDBROWSER_TEAM_NAME", "Live E2E")
                .env("RUST_LOG", "info")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::from(log))
                .kill_on_drop(true);
            for (k, v) in &self.env {
                cmd.env(k, v);
            }
            let mut child = cmd.spawn().map_err(e2s)?;
            let out = child.stdout.take().unwrap();
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            let mut log = append(&self.log);
            tokio::spawn(async move {
                use std::io::Write;
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let _ = writeln!(log, "{l}");
                    let _ = tx.send(l);
                }
            });
            self.child = Some(child);
            let mut invite = None;
            let health = reqwest::Client::builder().no_proxy().build().map_err(e2s)?;
            let until = Instant::now() + Duration::from_secs(60);
            loop {
                while let Ok(l) = rx.try_recv() {
                    if let Some(i) = l.trim().strip_prefix("invite:") {
                        invite = Some(i.trim().to_string());
                    }
                }
                let healthy = health.get(format!("{}/health", self.url())).send().await.is_ok_and(|r| r.status().is_success());
                if healthy && (!first || invite.is_some()) {
                    // Lines that come after the health check are still logged.
                    tokio::spawn(async move { while rx.recv().await.is_some() {} });
                    return Ok(invite);
                }
                if Instant::now() > until {
                    return Err("harness: the team server did not come up".into());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }

        /// SIGTERM, as `docker stop` asks; killed if it does not go.
        pub async fn stop(&mut self) {
            if let Some(mut c) = self.child.take() {
                if let Some(pid) = c.id() {
                    unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
                }
                if tokio::time::timeout(Duration::from_secs(15), c.wait()).await.is_err() {
                    let _ = c.kill().await;
                }
            }
        }
    }

    // ---- a device ----

    pub struct Dev {
        pub name: &'static str,
        pub role: &'static str,
        pub root: PathBuf,
        pub pid: u32,
        pub device_id: String,
        child: Child,
        stdin: ChildStdin,
        rx: tokio::sync::mpsc::UnboundedReceiver<Value>,
        next: u64,
    }

    pub struct Spawn<'a> {
        pub engine: &'a Path,
        pub fp: &'a Path,
        pub logs: &'a Path,
    }

    impl Dev {
        pub async fn spawn(name: &'static str, role: &'static str, root: PathBuf, how: &Spawn<'_>) -> R<Dev> {
            Self::spawn_env(name, role, root, how, &[]).await
        }

        pub async fn spawn_env(
            name: &'static str,
            role: &'static str,
            root: PathBuf,
            how: &Spawn<'_>,
            extra: &[(String, String)],
        ) -> R<Dev> {
            std::fs::create_dir_all(&root).map_err(e2s)?;
            let log_path = how.logs.join(format!("{role}.log"));
            let mut cmd = Command::new(std::env::current_exe().map_err(e2s)?);
            cmd.args(["--exact", "live_e2e::device", "--ignored", "--nocapture", "--test-threads=1", "-q"])
                .env(ENV_NAME, name)
                .env(ENV_ROLE, role)
                .env(ENV_ROOT, &root)
                .env(ENV_ENGINE, how.engine)
                .env(ENV_FP, how.fp)
                .env("RUST_BACKTRACE", "1")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::from(append(&log_path)))
                .kill_on_drop(true);
            for (k, v) in extra {
                cmd.env(k, v);
            }
            let mut child = cmd.spawn().map_err(e2s)?;
            let pid = child.id().unwrap_or(0);
            let out = child.stdout.take().unwrap();
            let stdin = child.stdin.take().unwrap();
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
            let mut log = append(&log_path);
            tokio::spawn(async move {
                use std::io::Write;
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    if let Some(j) = l.strip_prefix(MARK) {
                        if let Ok(v) = serde_json::from_str::<Value>(j) {
                            let _ = tx.send(v);
                            continue;
                        }
                    }
                    let _ = writeln!(log, "{l}");
                }
            });
            let ready = match tokio::time::timeout(Duration::from_secs(300), rx.recv()).await {
                Ok(Some(v)) => v,
                _ => return Err(format!("harness: {name} did not start (see logs/{role}.log)")),
            };
            if ready["ready"].is_null() {
                return Err(format!("harness: {name} did not start: {}", ready["error"]));
            }
            let device_id = ready["ready"]["device_id"].as_str().unwrap_or_default().to_string();
            Ok(Dev { name, role, root, pid, device_id, child, stdin, rx, next: 0 })
        }

        pub async fn call(&mut self, cmd: &str, args: Value) -> R<Value> {
            self.next += 1;
            let id = self.next;
            let line = format!("{}\n", json!({ "id": id, "cmd": cmd, "args": args }));
            self.stdin.write_all(line.as_bytes()).await.map_err(e2s)?;
            loop {
                match tokio::time::timeout(Duration::from_secs(900), self.rx.recv()).await {
                    Err(_) => return Err(format!("harness: {} {cmd}: no answer in 900 s", self.name)),
                    Ok(None) => return Err(format!("harness: {} is gone", self.name)),
                    Ok(Some(v)) if v["id"] == json!(id) => {
                        return if v["ok"] == json!(true) {
                            Ok(v["value"].clone())
                        } else {
                            Err(v["error"].as_str().unwrap_or("?").to_string())
                        };
                    }
                    Ok(Some(_)) => continue,
                }
            }
        }

        /// Quit as the app quits: what is open is closed and sent back first.
        pub async fn exit(mut self) {
            let _ = tokio::time::timeout(Duration::from_secs(150), self.call("exit", json!({}))).await;
            let _ = tokio::time::timeout(Duration::from_secs(10), self.child.wait()).await;
            let _ = self.child.kill().await;
        }

        /// kill -9: the launcher dies with whatever it has open.
        pub async fn kill9(mut self) {
            unsafe { libc::kill(self.pid as libc::pid_t, libc::SIGKILL) };
            let _ = self.child.wait().await;
        }

        pub fn data(&self) -> PathBuf {
            self.root.join("data")
        }

        pub fn log(&self, logs: &Path) -> String {
            std::fs::read_to_string(logs.join(format!("{}.log", self.role))).unwrap_or_default()
        }
    }

    // ---- the test site ----

    pub struct Site {
        pub port: u16,
        pub hits: Arc<Mutex<Vec<String>>>,
    }

    const PAGE: &str = "<!doctype html><html><head><title>live</title></head><body><h1>live site</h1></body></html>";

    pub async fn site() -> Site {
        use axum::extract::{Query, State};
        use axum::http::{header, HeaderMap};
        use axum::response::{Html, IntoResponse};
        use axum::routing::get;
        type Hits = Arc<Mutex<Vec<String>>>;
        fn hit(hits: &Hits, h: &HeaderMap, what: String) {
            let host = h.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("?");
            hits.lock().unwrap().push(format!("{host} {what}"));
        }
        async fn page(State(hits): State<Hits>, h: HeaderMap) -> Html<&'static str> {
            hit(&hits, &h, "GET /".into());
            Html(PAGE)
        }
        // A cookie from the server (HttpOnly), one from the page, and a localStorage key.
        async fn set(State(hits): State<Hits>, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
            let k = q.get("k").cloned().unwrap_or_default();
            let v = q.get("v").cloned().unwrap_or_default();
            hit(&hits, &h, format!("GET /set k={k} v={v}"));
            let body = format!(
                "<!doctype html><html><head><title>set</title></head><body><script>\
                 localStorage.setItem('ls_{k}','{v}');\
                 document.cookie='js_{k}={v}; max-age=31536000; path=/';\
                 document.title='set-done';</script></body></html>"
            );
            let cookie = format!("srv_{k}={v}; Max-Age=31536000; Path=/; HttpOnly");
            ([(header::SET_COOKIE, cookie)], Html(body))
        }
        let hits: Hits = Arc::new(Mutex::new(Vec::new()));
        let app = axum::Router::new().route("/", get(page)).route("/set", get(set)).with_state(hits.clone());
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(l, app).await;
        });
        Site { port, hits }
    }

    // ---- an HTTP proxy, for a profile's bound proxy: `*.test` is the test site ----

    pub struct Proxy {
        pub port: u16,
        pub log: Arc<Mutex<Vec<String>>>,
    }

    pub async fn proxy(site_port: u16) -> Proxy {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let log = Arc::new(Mutex::new(Vec::new()));
        let seen = log.clone();
        tokio::spawn(async move {
            while let Ok((conn, _)) = l.accept().await {
                let seen = seen.clone();
                tokio::spawn(async move {
                    let _ = relay(conn, site_port, seen).await;
                });
            }
        });
        Proxy { port, log }
    }

    /// One request per connection: CONNECT is tunnelled, plain HTTP rewritten to origin form.
    async fn relay(mut conn: tokio::net::TcpStream, site_port: u16, seen: Arc<Mutex<Vec<String>>>) -> std::io::Result<()> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        let head_end = loop {
            let n = conn.read(&mut chunk).await?;
            if n == 0 {
                return Ok(());
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break p + 4;
            }
            if buf.len() > 65536 {
                return Ok(());
            }
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let rest = buf[head_end..].to_vec();
        let mut lines = head.split("\r\n");
        let first = lines.next().unwrap_or_default();
        let mut parts = first.split_whitespace();
        let (method, target, version) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or("HTTP/1.1"));
        seen.lock().unwrap().push(format!("{method} {target}"));
        let map = |host: &str, port: u16| -> (String, u16) {
            if host.ends_with(".test") {
                ("127.0.0.1".into(), site_port)
            } else {
                (host.to_string(), port)
            }
        };
        if method.eq_ignore_ascii_case("CONNECT") {
            let (h, p) = target.rsplit_once(':').unwrap_or((target, "443"));
            let (h, p) = map(h, p.parse().unwrap_or(443));
            let mut up = tokio::net::TcpStream::connect((h.as_str(), p)).await?;
            conn.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await?;
            up.write_all(&rest).await?;
            tokio::io::copy_bidirectional(&mut conn, &mut up).await?;
            return Ok(());
        }
        let Ok(url) = url::Url::parse(target) else { return Ok(()) };
        let (h, p) = map(url.host_str().unwrap_or(""), url.port_or_known_default().unwrap_or(80));
        let mut path = url.path().to_string();
        if let Some(q) = url.query() {
            path.push('?');
            path.push_str(q);
        }
        let mut out = format!("{method} {path} {version}\r\n");
        for l in lines.filter(|l| !l.is_empty()) {
            let name = l.split(':').next().unwrap_or("").trim().to_ascii_lowercase();
            if !matches!(name.as_str(), "proxy-connection" | "connection" | "keep-alive" | "proxy-authorization") {
                out.push_str(l);
                out.push_str("\r\n");
            }
        }
        out.push_str("Connection: close\r\n\r\n");
        let mut up = tokio::net::TcpStream::connect((h.as_str(), p)).await?;
        up.write_all(out.as_bytes()).await?;
        up.write_all(&rest).await?;
        tokio::io::copy_bidirectional(&mut conn, &mut up).await?;
        Ok(())
    }

    // ---- a link that can be cut: a TCP relay in front of the team server ----

    #[derive(Default)]
    pub struct RelaySt {
        down: std::sync::atomic::AtomicBool,
        /// One connection carrying this many bytes up trips the link; 0 never.
        cut_at: std::sync::atomic::AtomicU64,
        down_for_ms: std::sync::atomic::AtomicU64,
        /// Bytes per second upstream (device to server); 0 unlimited.
        rate: std::sync::atomic::AtomicU64,
        conns: Mutex<Vec<tokio::task::AbortHandle>>,
        pub log: Mutex<Vec<String>>,
        up_total: std::sync::atomic::AtomicU64,
    }

    pub struct Relay {
        pub port: u16,
        pub st: Arc<RelaySt>,
    }

    impl RelaySt {
        fn say(&self, s: String) {
            eprintln!("[relay] {s}");
            self.log.lock().unwrap().push(s);
        }

        /// The link goes down: every connection dropped, new ones refused.
        pub fn go_down(self: &Arc<Self>, for_: Option<Duration>) {
            use std::sync::atomic::Ordering::SeqCst;
            self.down.store(true, SeqCst);
            for h in self.conns.lock().unwrap().drain(..) {
                h.abort();
            }
            self.say(format!("down (for {for_:?})"));
            if let Some(d) = for_ {
                let me = self.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(d).await;
                    me.down.store(false, SeqCst);
                    me.say("up again".into());
                });
            }
        }
    }

    impl Relay {
        pub async fn start(target: u16) -> Relay {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = l.local_addr().unwrap().port();
            let st: Arc<RelaySt> = Arc::new(RelaySt::default());
            let st2 = st.clone();
            tokio::spawn(async move {
                use std::sync::atomic::Ordering::SeqCst;
                while let Ok((c, _)) = l.accept().await {
                    if st2.down.load(SeqCst) {
                        drop(c);
                        continue;
                    }
                    let st3 = st2.clone();
                    let h = tokio::spawn(async move {
                        let _ = Relay::pipe(c, target, st3).await;
                    });
                    st2.conns.lock().unwrap().push(h.abort_handle());
                }
            });
            Relay { port, st }
        }

        async fn pipe(c: tokio::net::TcpStream, target: u16, st: Arc<RelaySt>) -> std::io::Result<()> {
            use std::sync::atomic::Ordering::SeqCst;
            let u = tokio::net::TcpStream::connect(("127.0.0.1", target)).await?;
            let (mut cr, mut cw) = c.into_split();
            let (mut ur, mut uw) = u.into_split();
            let up_st = st.clone();
            let up = async move {
                let mut buf = vec![0u8; 64 * 1024];
                let mut sent = 0u64;
                let mut free_at = tokio::time::Instant::now();
                loop {
                    let n = cr.read(&mut buf).await?;
                    if n == 0 {
                        let _ = uw.shutdown().await;
                        return Ok::<(), std::io::Error>(());
                    }
                    let rate = up_st.rate.load(SeqCst);
                    if rate > 0 {
                        let now = tokio::time::Instant::now();
                        free_at = free_at.max(now) + Duration::from_secs_f64(n as f64 / rate as f64);
                        tokio::time::sleep_until(free_at).await;
                    }
                    uw.write_all(&buf[..n]).await?;
                    sent += n as u64;
                    up_st.up_total.fetch_add(n as u64, SeqCst);
                    let cut = up_st.cut_at.load(SeqCst);
                    if cut > 0 && sent >= cut {
                        up_st.cut_at.store(0, SeqCst);
                        up_st.say(format!("cut a connection after {sent} bytes up"));
                        let d = Duration::from_millis(up_st.down_for_ms.load(SeqCst));
                        up_st.go_down(Some(d));
                        return Ok(());
                    }
                }
            };
            let down = async move { tokio::io::copy(&mut ur, &mut cw).await.map(|_| ()) };
            let _ = tokio::join!(up, down);
            Ok(())
        }

        pub fn url(&self) -> String {
            format!("http://127.0.0.1:{}", self.port)
        }

        /// The first connection to carry `bytes` up takes the link down for `for_`.
        pub fn cut_after(&self, bytes: u64, for_: Duration) {
            use std::sync::atomic::Ordering::SeqCst;
            self.st.down_for_ms.store(for_.as_millis() as u64, SeqCst);
            self.st.cut_at.store(bytes, SeqCst);
        }

        pub fn throttle(&self, bytes_per_sec: u64) {
            self.st.rate.store(bytes_per_sec, std::sync::atomic::Ordering::SeqCst);
            self.st.say(format!("upstream throttled to {bytes_per_sec} B/s"));
        }
    }

    // ---- CDP ----

    type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

    pub struct Cdp {
        ws: Ws,
        id: u64,
        pub wait: Duration,
    }

    impl Cdp {
        pub async fn connect(url: &str) -> R<Cdp> {
            let (ws, _) = tokio_tungstenite::connect_async(url).await.map_err(e2s)?;
            Ok(Cdp { ws, id: 0, wait: Duration::from_secs(30) })
        }

        pub async fn call(&mut self, method: &str, params: Value, session: Option<&str>) -> R<Value> {
            use tokio_tungstenite::tungstenite::Message;
            self.id += 1;
            let id = self.id;
            let mut msg = json!({ "id": id, "method": method, "params": params });
            if let Some(s) = session {
                msg["sessionId"] = json!(s);
            }
            self.ws.send(Message::Text(msg.to_string())).await.map_err(e2s)?;
            let until = Instant::now() + self.wait;
            loop {
                let left = until.saturating_duration_since(Instant::now());
                let m = tokio::time::timeout(left, self.ws.next())
                    .await
                    .map_err(|_| format!("harness: CDP {method}: no answer"))?;
                let Some(m) = m else { return Err("harness: CDP closed".into()) };
                if let Message::Text(t) = m.map_err(e2s)? {
                    let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
                    if v["id"] == json!(id) {
                        if let Some(e) = v.get("error") {
                            return Err(format!("CDP {method}: {e}"));
                        }
                        return Ok(v["result"].clone());
                    }
                }
            }
        }

        /// A new tab on `url`, attached, once it has loaded.
        pub async fn open(&mut self, url: &str) -> R<String> {
            let t = self.call("Target.createTarget", json!({ "url": url }), None).await?;
            let tid = t["targetId"].as_str().unwrap_or_default().to_string();
            let a = self.call("Target.attachToTarget", json!({ "targetId": tid, "flatten": true }), None).await?;
            let sid = a["sessionId"].as_str().unwrap_or_default().to_string();
            let until = Instant::now() + Duration::from_secs(30);
            loop {
                let r = self.eval(&sid, "document.readyState + '|' + location.href", false).await.unwrap_or_default();
                let r = r.as_str().unwrap_or_default();
                if r.starts_with("complete|") && r["complete|".len()..].starts_with(url.split('?').next().unwrap_or(url)) {
                    return Ok(sid);
                }
                if Instant::now() > until {
                    return Err(format!("harness: {url} did not load (last: {r})"));
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        }

        pub async fn eval(&mut self, sid: &str, expr: &str, promise: bool) -> R<Value> {
            let r = self
                .call("Runtime.evaluate", json!({ "expression": expr, "returnByValue": true, "awaitPromise": promise }), Some(sid))
                .await?;
            if let Some(ex) = r.get("exceptionDetails") {
                return Err(format!("CDP evaluate: {ex}"));
            }
            Ok(r["result"]["value"].clone())
        }

        pub async fn cookies(&mut self) -> R<Vec<Value>> {
            let r = self.call("Storage.getCookies", json!({}), None).await?;
            Ok(r["cookies"].as_array().cloned().unwrap_or_default())
        }

        pub async fn targets(&mut self) -> R<Vec<Value>> {
            let r = self.call("Target.getTargets", json!({}), None).await?;
            Ok(r["targetInfos"].as_array().cloned().unwrap_or_default())
        }
    }

    /// name=value of the cookies on `host`, sorted.
    pub fn cookie_pairs(all: &[Value], host: &str) -> Vec<String> {
        let mut v: Vec<String> = all
            .iter()
            .filter(|c| c["domain"].as_str().is_some_and(|d| d.trim_start_matches('.') == host))
            .map(|c| format!("{}={}", c["name"].as_str().unwrap_or(""), c["value"].as_str().unwrap_or("")))
            .collect();
        v.sort();
        v
    }

    // ---- the report ----

    #[derive(Default, serde::Serialize)]
    pub struct Row {
        pub id: String,
        pub scenario: String,
        pub pass: bool,
        pub checks: Vec<String>,
        pub evidence: Vec<String>,
    }

    #[derive(Default)]
    pub struct Report {
        pub rows: Vec<Row>,
        pub out: PathBuf,
    }

    impl Report {
        pub fn begin(&mut self, id: &str, scenario: &str) {
            eprintln!("\n[live] ==== {id}: {scenario}");
            self.rows.push(Row { id: id.into(), scenario: scenario.into(), pass: true, ..Default::default() });
        }

        fn row(&mut self) -> &mut Row {
            self.rows.last_mut().expect("a scenario begun")
        }

        pub fn note(&mut self, s: impl Into<String>) {
            let s = s.into();
            eprintln!("[live]   . {s}");
            self.row().evidence.push(s);
        }

        pub fn check(&mut self, ok: bool, what: impl Into<String>) -> bool {
            let what = what.into();
            eprintln!("[live]   {} {what}", if ok { "PASS" } else { "FAIL" });
            let r = self.row();
            r.checks.push(format!("{} {what}", if ok { "PASS" } else { "FAIL" }));
            if !ok {
                r.pass = false;
            }
            ok
        }

        pub fn save(&self) {
            let _ = std::fs::write(self.out.join("evidence.json"), serde_json::to_vec_pretty(&self.rows).unwrap());
            let mut md = String::from("| # | scenario | result | checks | evidence |\n|---|---|---|---|---|\n");
            let cell = |s: &str| s.replace('|', "\\|").replace('\n', " ");
            for r in &self.rows {
                md.push_str(&format!(
                    "| {} | {} | {} | {} | {} |\n",
                    r.id,
                    cell(&r.scenario),
                    if r.pass { "PASS" } else { "FAIL" },
                    cell(&r.checks.join("<br>")),
                    cell(&r.evidence.join("<br>")),
                ));
            }
            let _ = std::fs::write(self.out.join("evidence.md"), md);
        }
    }
}

// =====================================================================
// The scenarios.
// =====================================================================

use harness::{cookie_pairs, Cdp, Dev, Report, Server, R};

struct World {
    out: PathBuf,
    logs: PathBuf,
    engine: PathBuf,
    fp: PathBuf,
    server: Server,
    site: harness::Site,
    proxy: harness::Proxy,
    admin: Dev,
    a: Option<Dev>,
    b: Dev,
    report: Report,
    /// The team's key, as the admin's vouch learned it: raw requests are held to it.
    key: String,
    admin_token: String,
    team: String,
    member_a: String,
    member_b: String,
    token_a: String,
    /// The team profile in Shop, and the one in Other.
    p: String,
    q: String,
    a_browser: u32,
    /// The personal synced profile.
    sp: String,
    // ---- the failure-mode run ----
    relay: Option<harness::Relay>,
    c: Option<Dev>,
    d: Option<Dev>,
    e: Option<Dev>,
    member_c: String,
    member_d: String,
    token_c: String,
    invite_c: String,
    /// The big profile.
    p2: String,
    /// The wall-clock shim, and the files that set each skewed clock.
    skew_lib: Option<PathBuf>,
    server_skew: PathBuf,
    d_skew: PathBuf,
}

fn grant(scope: Value, actions: &[&str]) -> Vec<Value> {
    actions.iter().map(|a| json!({ "scope": scope.clone(), "action": a, "allow": true })).collect()
}

fn team_scope() -> Value {
    json!({ "kind": "team" })
}

fn folder_scope(name: &str) -> Value {
    json!({ "kind": "folder", "name": name })
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() > 600 {
        format!("{}…", s.chars().take(600).collect::<String>())
    } else {
        s
    }
}

impl World {
    fn a(&mut self) -> &mut Dev {
        self.a.as_mut().expect("device A is up")
    }

    fn site_url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.site.port)
    }

    /// The site by a name only the bound proxy resolves.
    fn proxied_url(&self, path: &str) -> String {
        format!("http://live.test:{}{path}", self.site.port)
    }

    /// A client for any token, held to the team's key: the harness speaks as the server's other callers.
    fn raw_client(&self, token: &str, device: &str) -> crate::space::client::TeamClient {
        crate::space::client::TeamClient::held_to(&self.server.url(), token, device, &self.key)
    }

    async fn server_get(&self, token: &str, path: &str) -> R<Value> {
        let c = self.raw_client(token, "live-harness");
        let (status, body) = c.raw(crate::space::client::Method::GET, path, None).await.map_err(|e| format!("harness: {e}"))?;
        let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if !(200..300).contains(&status) {
            return Err(format!("{path}: {status} {v}"));
        }
        Ok(v)
    }

    /// The team profile's row as the server keeps it.
    async fn row(&self, id: &str) -> R<Value> {
        self.server_get(&self.admin_token, &format!("/profiles/{id}")).await
    }

    fn copy_dir(&self, dev: &Dev, id: &str) -> PathBuf {
        dev.data().join("team-open").join(&self.team).join(id)
    }

    async fn rights_of(dev: &mut Dev, id: &str) -> R<Value> {
        let rows = dev.call("profiles", json!({})).await?;
        Ok(rows.as_array().and_then(|r| r.iter().find(|p| p["id"] == json!(id)).cloned()).map(|p| p["rights"].clone()).unwrap_or(Value::Null))
    }

    fn ids(rows: &Value) -> Vec<String> {
        rows.as_array().map(|r| r.iter().filter_map(|p| p["id"].as_str().map(String::from)).collect()).unwrap_or_default()
    }

    /// Set a cookie and localStorage key through the browser at `ws`, then read them back.
    async fn set_in_browser(&mut self, ws: &str, base: &str, k: &str, v: &str) -> R<Value> {
        let mut cdp = Cdp::connect(ws).await?;
        let sid = cdp.open(&format!("{base}/set?k={k}&v={v}")).await?;
        let mut title = Value::Null;
        for _ in 0..50 {
            title = cdp.eval(&sid, "document.title", false).await?;
            if title == json!("set-done") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let ls = cdp.eval(&sid, &format!("localStorage.getItem('ls_{k}')"), false).await?;
        Ok(json!({ "title": title, "ls": ls }))
    }

    /// What the browser at `ws` holds for the site at `base`: cookies, localStorage, the test extensions' marks.
    async fn read_browser(&mut self, ws: &str, base: &str) -> R<Value> {
        let host = url::Url::parse(base).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
        let mut cdp = Cdp::connect(ws).await?;
        let sid = cdp.open(&format!("{base}/")).await?;
        let page = cdp
            .eval(
                &sid,
                "JSON.stringify({cookie: document.cookie, ls: Object.assign({}, localStorage), \
                 team_ext: document.documentElement.dataset.liveTeam || null, \
                 lib_ext: document.documentElement.dataset.liveLib || null})",
                false,
            )
            .await?;
        let page: Value = serde_json::from_str(page.as_str().unwrap_or("{}")).unwrap_or(Value::Null);
        let cookies = cdp.cookies().await?;
        let targets = cdp.targets().await?;
        let ext: Vec<String> = targets
            .iter()
            .filter_map(|t| t["url"].as_str())
            .filter(|u| u.starts_with("chrome-extension://"))
            .map(String::from)
            .collect();
        Ok(json!({ "cookies": cookie_pairs(&cookies, &host), "page": page, "extension_targets": ext }))
    }

    /// The browser's bookmark tree, as chrome://bookmarks reads it.
    async fn bookmarks_in_browser(&mut self, ws: &str) -> R<Value> {
        let mut cdp = Cdp::connect(ws).await?;
        let sid = cdp.open("chrome://bookmarks/").await?;
        let tree = cdp
            .eval(&sid, "chrome.bookmarks.getTree().then(t => JSON.stringify(t))", true)
            .await?;
        Ok(serde_json::from_str(tree.as_str().unwrap_or("null")).unwrap_or(Value::Null))
    }

    /// The titles of every bookmark in a tree.
    fn titles(tree: &Value, out: &mut Vec<String>) {
        match tree {
            Value::Array(a) => a.iter().for_each(|t| Self::titles(t, out)),
            Value::Object(o) => {
                if o.contains_key("url") {
                    out.push(format!("{} <{}>", o["title"].as_str().unwrap_or(""), o["url"].as_str().unwrap_or("")));
                }
                if let Some(c) = o.get("children") {
                    Self::titles(c, out);
                }
            }
            _ => {}
        }
    }

    fn pids_alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    fn save(&self) {
        self.report.save();
    }
}

/// Run one scenario; a harness failure ends it as failed, and the run goes on.
macro_rules! scenario {
    ($w:expr, $id:expr, $title:expr, $f:expr) => {{
        $w.report.begin($id, $title);
        let r: R = $f(&mut $w).await;
        if let Err(e) = r {
            $w.report.check(false, format!("aborted: {e}"));
        }
        $w.save();
    }};
}

// ---- TEAM ----

async fn t1(w: &mut World) -> R {
    let invite = w.server.start().await?.ok_or("harness: no admin invite printed")?;
    w.report.note(format!("server: {} (data {})", w.server.url(), w.server.data.display()));
    w.report.check(invite.starts_with(&format!("{}#eyJ", w.server.url())), format!("first run printed an admin invite for {}", w.server.url()));
    w.admin_token = split_invite(&invite).map(|(_, t)| t).unwrap_or_default();
    let learn = crate::space::client::TeamClient::new(&w.server.url(), &w.admin_token, "live-harness").map_err(|e| e.to_string())?;
    learn.call(crate::space::client::Method::GET, "/health", None).await.map_err(|e| e.to_string())?;
    w.key = learn.server_key().ok_or("harness: the server proved no key")?;
    let st = w.admin.call("join", json!({ "invite": invite })).await?;
    w.team = st["space"]["team_id"].as_str().unwrap_or_default().to_string();
    let admin_link = st["teams"].as_array().and_then(|t| t.first()).cloned().unwrap_or_default();
    w.report.check(!w.team.is_empty() && admin_link["admin"] == json!(true), format!("admin joined team {} as admin", w.team));
    for f in ["Shop", "Other"] {
        let r = w.admin.call("admin_folder_create", json!({ "name": f })).await?;
        w.report.note(format!("folder made: {}", short(&r)));
    }
    let ma = w.admin.call("admin_member_create", json!({ "name": "Member A" })).await?;
    let mb = w.admin.call("admin_member_create", json!({ "name": "Member B" })).await?;
    w.member_a = ma["member"]["id"].as_str().unwrap_or_default().into();
    w.member_b = mb["member"]["id"].as_str().unwrap_or_default().into();
    let (ia, ib) = (ma["invite"].as_str().unwrap_or_default().to_string(), mb["invite"].as_str().unwrap_or_default().to_string());
    w.token_a = split_invite(&ia).map(|(_, t)| t).unwrap_or_default();
    let by_ip = |i: &str| i.starts_with(&format!("http://127.0.0.1:{}#stm_", w.server.port));
    w.report.check(by_ip(&ia) && by_ip(&ib), "member invites are http://127.0.0.1:<port>#stm_… (plain http by IP)");
    let sa = w.a().call("join", json!({ "invite": ia })).await?;
    let sb = w.b.call("join", json!({ "invite": ib })).await?;
    let team = json!(w.team);
    w.report.check(sa["space"]["team_id"] == team && sb["space"]["team_id"] == team, "A and B joined by invite and are in the team space");
    let members = w.server_get(&w.admin_token, "/admin/members").await?;
    for m in members.as_array().cloned().unwrap_or_default() {
        w.report.note(format!("server member {} {} last_seen_at={}", m["id"], m["name"], m["last_seen_at"]));
    }
    let a_id = w.a.as_ref().map(|a| a.device_id.clone()).unwrap_or_default();
    w.report.note(format!("device ids: A={a_id} B={}", w.b.device_id));
    Ok(())
}

async fn t2(w: &mut World) -> R {
    let ga: Vec<Value> = grant(team_scope(), &["see", "create", "edit", "start", "cookies"]);
    let gb: Vec<Value> = grant(folder_scope("Shop"), &["see", "start", "cookies"]);
    let ra = w.admin.call("admin_set_grants", json!({ "member": w.member_a, "grants": ga })).await?;
    let rb = w.admin.call("admin_set_grants", json!({ "member": w.member_b, "grants": gb })).await?;
    w.report.note(format!("A grants: {}", short(&ra)));
    w.report.note(format!("B grants: {}", short(&rb)));
    let a_access = w.a().call("my_access", json!({})).await?;
    let b_access = w.b.call("my_access", json!({})).await?;
    w.report.check(a_access.as_array().map_or(0, |g| g.len()) == 5, format!("A's signed permission carries 5 team-wide grants: {}", short(&a_access)));
    w.report.check(
        b_access.as_array().is_some_and(|g| g.len() == 3 && g.iter().all(|x| x["scope"] == folder_scope("Shop"))),
        format!("B's signed permission carries See/Start/Cookies on folder Shop only: {}", short(&b_access)),
    );
    Ok(())
}

async fn t3(w: &mut World) -> R {
    let p = w.a().call("create_profile", json!({ "name": "Team shop", "folder": "Shop" })).await?;
    let q = w.a().call("create_profile", json!({ "name": "Team other", "folder": "Other" })).await?;
    w.p = p["id"].as_str().unwrap_or_default().into();
    w.q = q["id"].as_str().unwrap_or_default().into();
    w.report.note(format!("A created P={} in Shop, Q={} in Other", w.p, w.q));
    let row0 = w.row(&w.p.clone()).await?;
    w.report.note(format!("server row P before any start: session_rev={} session_size={}", row0["session_rev"], row0["session_size"]));
    let id = w.p.clone();
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("harness: no CDP address")?.to_string();
    w.report.note(format!("A started P: pid {} in {} ms, CDP {}", l["pid"], l["ms"], ws));
    let copy = w.copy_dir(w.a.as_ref().unwrap(), &w.p);
    w.report.check(copy.join("udd").is_dir(), format!("A's copy is under team-open: {}", copy.display()));
    let base = w.site_url("");
    let set = w.set_in_browser(&ws, &base, "a1", "fromA").await?;
    let read = w.read_browser(&ws, &base).await?;
    w.report.note(format!("A's browser after /set: {} / {}", short(&set), short(&read)));
    let hits = w.site.hits.lock().unwrap().clone();
    w.report.note(format!("test site saw: {hits:?}"));
    let stop = w.a().call("stop", json!({ "id": id })).await?;
    w.report.note(format!("A closed P in {} ms; events {}", stop["closed_ms"], short(&stop["events"])));
    let row = w.row(&w.p.clone()).await?;
    let (rev, size) = (row["session_rev"].as_u64().unwrap_or(0), row["session_size"].as_u64().unwrap_or(0));
    w.report.check(rev == 1, format!("server session_rev of P is 1 after A's close (got {rev})"));
    w.report.check(size > 10_000 && size < 100 * 1024 * 1024, format!("session size is sane: {size} bytes"));
    let packed: Vec<String> = w.a.as_ref().unwrap().log(&w.logs).lines().filter(|l| l.contains("session packed")).map(String::from).collect();
    w.report.note(format!("A's log: {}", packed.join(" ; ")));
    w.report.check(!copy.exists(), format!("A's copy wiped after close ({})", copy.display()));
    w.report.check(row["open_on"].is_null(), format!("lease given back: open_on={}", row["open_on"]));
    Ok(())
}

async fn t4(w: &mut World) -> R {
    let rows = w.b.call("profiles", json!({})).await?;
    let ids = World::ids(&rows);
    w.report.check(ids == vec![w.p.clone()], format!("B lists only P from Shop, not Q from Other: {ids:?}"));
    let id = w.p.clone();
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("harness: no CDP address")?.to_string();
    w.report.note(format!("B started P: pid {} in {} ms", l["pid"], l["ms"]));
    let base = w.site_url("");
    let read = w.read_browser(&ws, &base).await?;
    w.report.note(format!("B's browser: {}", short(&read)));
    let cookies: Vec<String> = serde_json::from_value(read["cookies"].clone()).unwrap_or_default();
    w.report.check(cookies.contains(&"srv_a1=fromA".to_string()), "B sees A's HttpOnly server cookie srv_a1=fromA");
    w.report.check(cookies.contains(&"js_a1=fromA".to_string()), "B sees A's page cookie js_a1=fromA");
    w.report.check(read["page"]["ls"]["ls_a1"] == json!("fromA"), "B sees A's localStorage ls_a1=fromA");
    let row = w.row(&w.p.clone()).await?;
    w.report.note(format!("server row while B has it: open_on={}", row["open_on"]));
    // Left open for T5.
    std::fs::write(w.out.join("b_ws.txt"), &ws).ok();
    Ok(())
}

async fn t5(w: &mut World) -> R {
    let id = w.p.clone();
    let r = w.a().call("launch", json!({ "id": id })).await;
    let want = "this profile is open on Device B: close it there first";
    match &r {
        Err(e) => w.report.check(e == want, format!("A's start refused with exact text: \"{e}\"")),
        Ok(v) => w.report.check(false, format!("A's start was not refused: {}", short(v))),
    };
    let rows = w.a().call("profiles", json!({})).await?;
    let mine = rows.as_array().and_then(|r| r.iter().find(|p| p["id"] == json!(id)).cloned()).unwrap_or_default();
    w.report.note(format!("A's list row for P: open_on={}", mine["open_on"]));
    w.report.check(mine["open_on"]["device_name"] == json!("Device B"), "A's list shows P open on Device B");
    let copy = w.copy_dir(w.a.as_ref().unwrap(), &w.p);
    tokio::time::sleep(Duration::from_millis(500)).await;
    w.report.check(!copy.exists(), "the refused start left no copy on A");
    Ok(())
}

async fn t6(w: &mut World) -> R {
    let ws = std::fs::read_to_string(w.out.join("b_ws.txt")).map_err(|e| e.to_string())?;
    let base = w.site_url("");
    let set = w.set_in_browser(&ws, &base, "b1", "fromB").await?;
    w.report.note(format!("B set b1: {}; B keeps the browser open 35 s (past the cookie store's 30 s commit) before closing", short(&set)));
    tokio::time::sleep(Duration::from_secs(35)).await;
    let id = w.p.clone();
    let stop = w.b.call("stop", json!({ "id": id })).await?;
    w.report.note(format!("B closed P in {} ms", stop["closed_ms"]));
    let row = w.row(&id).await?;
    w.report.check(row["session_rev"] == json!(2), format!("session_rev 2 after B's close (got {})", row["session_rev"]));
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    let read = w.read_browser(&ws, &base).await?;
    w.report.note(format!("A's browser: {}", short(&read)));
    let cookies: Vec<String> = serde_json::from_value(read["cookies"].clone()).unwrap_or_default();
    w.report.check(cookies.contains(&"srv_b1=fromB".to_string()) && read["page"]["ls"]["ls_b1"] == json!("fromB"), "A sees B's cookie srv_b1 and localStorage ls_b1");
    w.a().call("stop", json!({ "id": id })).await?;
    let row = w.row(&id).await?;
    w.report.check(row["session_rev"] == json!(3), format!("session_rev 3 after A's close (got {})", row["session_rev"]));
    Ok(())
}

async fn t7(w: &mut World) -> R {
    let id = w.p.clone();
    let before = World::rights_of(&mut w.b, &id).await?;
    w.report.note(format!("B's rights on P before: {before}"));
    let gb: Vec<Value> = grant(folder_scope("Shop"), &["see", "cookies"]);
    let t0 = Instant::now();
    w.admin.call("admin_set_grants", json!({ "member": w.member_b, "grants": gb })).await?;
    let mut after = Value::Null;
    let mut took = None;
    while t0.elapsed() < Duration::from_secs(30) {
        after = World::rights_of(&mut w.b, &id).await?;
        if after["start"] == json!(false) {
            took = Some(t0.elapsed());
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    w.report.check(took.is_some_and(|t| t < Duration::from_secs(10)), format!("B's list shows start=false {took:?} after the admin's change (live channel): {after}"));
    let r = w.b.call("launch", json!({ "id": id })).await;
    match &r {
        Err(e) => w.report.check(e == "not allowed in this team: needs start on the profile", format!("B's start refused: \"{e}\"")),
        Ok(v) => w.report.check(false, format!("B's start was not refused: {}", short(v))),
    };
    let ev = w.b.call("events", json!({})).await?;
    let perm_events: Vec<&Value> = ev.as_array().map(|a| a.iter().filter(|e| e["event"] == json!("store-changed")).collect()).unwrap_or_default();
    w.report.note(format!("B's window was told store-changed {} times so far", perm_events.len()));
    Ok(())
}

/// Start back for B, a team bookmark by A, and B's next start with folder-only rights.
async fn t8(w: &mut World) -> R {
    let id = w.p.clone();
    let gb: Vec<Value> = grant(folder_scope("Shop"), &["see", "start", "cookies"]);
    w.admin.call("admin_set_grants", json!({ "member": w.member_b, "grants": gb })).await?;
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(20) && World::rights_of(&mut w.b, &id).await?["start"] != json!(true) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let url = w.site_url("/?bookmark=team");
    let bm = w.a().call("bookmark_save", json!({ "entry": { "title": "Live team bookmark", "url": url, "folder": "" } })).await?;
    w.report.note(format!("A saved team bookmark: {}", short(&bm)));
    let srv = w.server_get(&w.admin_token, "/items/bookmark").await?;
    w.report.note(format!("server /items/bookmark (admin): {} item(s)", srv.as_array().map_or(0, |a| a.len())));
    tokio::time::sleep(Duration::from_secs(2)).await;
    let b_list = w.b.call("bookmark_list", json!({})).await.unwrap_or(json!("refused"));
    w.report.note(format!("B's bookmark_list (See on folder Shop only): {}", short(&b_list)));
    let look = b_session_look(w, &id).await?;
    w.report.check(look["bookmark_in_browser"] == json!(true), "with See+Start+Cookies on folder Shop only, A's team bookmark is in B's browser at B's next start");
    Ok(())
}

/// A team extension by A on P; B's next start with folder-only rights.
async fn t9(w: &mut World) -> R {
    let id = w.p.clone();
    let zip = w.out.join("ext/live-team-ext.zip");
    let ext = w.a().call("extension_import", json!({ "path": zip })).await?;
    let ext_id = ext[0]["id"].as_str().ok_or("harness: no extension id")?.to_string();
    w.report.note(format!("A imported team extension {ext_id}: {}", short(&ext)));
    let srv = w.server_get(&w.admin_token, "/items/extension").await?;
    w.report.note(format!(
        "server /items/extension: {}",
        srv.as_array().map(|a| a.iter().map(|i| format!("{} package={}", i["id"], i["package"])).collect::<Vec<_>>().join(", ")).unwrap_or_default()
    ));
    let saved = w.a().call("edit_profile", json!({ "id": id, "meta": { "extensions": [ext_id] } })).await?;
    w.report.note(format!("A assigned it to P: extensions={}", saved["extensions"]));
    tokio::time::sleep(Duration::from_secs(2)).await;
    let look = b_session_look(w, &id).await?;
    w.report.check(look["extension_loaded"] == json!(true), "with folder-only rights, the team extension assigned to P loads in B's browser");
    let left_out: Vec<String> = w.b.log(&w.logs).lines().filter(|l| l.contains("left out")).map(String::from).collect();
    w.report.note(format!("B's log: {left_out:?}"));
    Ok(())
}

/// The same two with See on the whole team for B, as items are seen all together or not at all.
async fn t9b(w: &mut World) -> R {
    let id = w.p.clone();
    let mut gb: Vec<Value> = grant(folder_scope("Shop"), &["see", "start", "cookies"]);
    gb.extend(grant(team_scope(), &["see"]));
    w.admin.call("admin_set_grants", json!({ "member": w.member_b, "grants": gb })).await?;
    let t0 = Instant::now();
    let (mut b_bm, mut b_ext) = (Value::Null, Value::Null);
    while t0.elapsed() < Duration::from_secs(20) {
        b_bm = w.b.call("bookmark_list", json!({})).await.unwrap_or(Value::Null);
        b_ext = w.b.call("extension_list", json!({})).await.unwrap_or(Value::Null);
        if b_bm.as_array().is_some_and(|a| !a.is_empty()) && b_ext.as_array().is_some_and(|a| !a.is_empty()) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    w.report.note(format!("{:?} after See@team: B's bookmark_list {} ; extension_list {}", t0.elapsed(), short(&b_bm), short(&b_ext)));
    let look = b_session_look(w, &id).await?;
    w.report.check(look["bookmark_in_browser"] == json!(true), "A's team bookmark is in B's browser (chrome.bookmarks) at B's next start");
    // An extension loaded before in the same browser data starts its worker only on an event.
    w.report.check(
        look["extension_loaded"] == json!(true) || look["extension_targets"].as_array().is_some_and(|a| !a.is_empty()),
        format!("the team extension runs in B's browser: content script ran={}, extension targets {}", look["extension_loaded"], look["extension_targets"]),
    );
    w.report.check(look["ext_dir_while_open"].as_array().is_some_and(|a| !a.is_empty()), format!("while open, B's copy holds the unpacked extension: {}", look["ext_dir_while_open"]));
    w.report.check(look["ext_dir_after_close"] == json!(false), format!("after close the extension folder is gone ({})", look["ext_dir"]));
    Ok(())
}

/// B starts P, and what its browser and its copy hold is read; then B closes it.
async fn b_session_look(w: &mut World, id: &str) -> R<Value> {
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    let copy = w.copy_dir(&w.b, id);
    let ext_dir = copy.join("ext");
    let unpacked: Vec<String> = std::fs::read_dir(&ext_dir).map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
    let tree = w.bookmarks_in_browser(&ws).await;
    let file = std::fs::read_to_string(copy.join("udd/Default/Bookmarks")).unwrap_or_default();
    let mut read = Value::Null;
    for _ in 0..10 {
        read = w.read_browser(&ws, &w.site_url("")).await?;
        // Nothing unpacked: no extension to wait for.
        if read["extension_targets"].as_array().is_some_and(|a| !a.is_empty()) || unpacked.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let argv = std::process::Command::new("ps").args(["-o", "command=", "-p", &l["pid"].as_u64().unwrap_or(0).to_string()]).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let load = argv.split_whitespace().filter(|a| a.starts_with("--load-extension") || a.starts_with("--disable-extensions-except")).collect::<Vec<_>>().join(" ");
    w.b.call("stop", json!({ "id": id })).await?;
    let mut titles = Vec::new();
    match &tree {
        Ok(t) => World::titles(t, &mut titles),
        Err(e) => w.report.note(format!("chrome://bookmarks not read: {e}")),
    }
    w.report.note(format!("B's browser bookmarks (chrome.bookmarks.getTree): {titles:?}; the Bookmarks file names it: {}", file.contains("Live team bookmark")));
    w.report.note(format!("B's browser: {}", short(&read)));
    w.report.note(format!("B's copy ext/: {unpacked:?}; engine switches: {}", if load.is_empty() { "(no extension switches)".to_string() } else { load }));
    Ok(json!({
        "bookmark_in_browser": titles.iter().any(|t| t.starts_with("Live team bookmark")),
        "extension_targets": read["extension_targets"],
        "extension_loaded": read["page"]["team_ext"] == json!("team"),
        "ext_dir": ext_dir.display().to_string(),
        "ext_dir_while_open": unpacked,
        "ext_dir_after_close": ext_dir.exists(),
    }))
}

async fn t10(w: &mut World) -> R {
    let id = w.p.clone();
    let rev0 = w.row(&id).await?["session_rev"].as_u64().unwrap_or(0);
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    let browser = l["pid"].as_u64().unwrap_or(0) as u32;
    let base = w.site_url("");
    w.set_in_browser(&ws, &base, "gone", "dropped").await?;
    let since = w.b.call("now", json!({})).await?.as_u64().unwrap_or(0);
    let t0 = Instant::now();
    w.admin.call("admin_member_delete", json!({ "member": w.member_b })).await?;
    let closed = w.b.call("wait_closed", json!({ "id": id, "since": since, "secs": 60 })).await;
    let took = t0.elapsed();
    match &closed {
        Ok(c) => {
            let outcome: Vec<String> = c["events"]
                .as_array()
                .map(|a| a.iter().filter(|e| e["event"] == json!("team-session")).map(|e| e["payload"]["outcome"].as_str().unwrap_or("").to_string()).collect())
                .unwrap_or_default();
            w.report.check(outcome == vec!["discarded".to_string()], format!("B's open session closed {took:?} after the removal, outcome {outcome:?}"));
        }
        Err(e) => {
            w.report.check(false, format!("B's open session did not close: {e}"));
        }
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    w.report.check(!World::pids_alive(browser), format!("B's browser pid {browser} is gone"));
    let row = w.row(&id).await?;
    w.report.check(row["session_rev"].as_u64() == Some(rev0), format!("server session_rev unchanged ({rev0} -> {}): nothing of B's was uploaded", row["session_rev"]));
    w.report.check(row["open_on"].is_null(), format!("B's lease freed with the member: open_on={}", row["open_on"]));
    w.report.check(!w.copy_dir(&w.b, &id).exists(), "B's copy wiped");
    let st = w.b.call("state", json!({})).await?;
    let link = st["space"]["teams"].as_array().and_then(|t| t.first()).cloned().unwrap_or_default();
    w.report.check(st["space"]["space"]["kind"] == json!("personal") && link["revoked"] == json!(true), format!("B is back in personal, team marked revoked: space={} revoked={}", st["space"]["space"], link["revoked"]));
    let sw = w.b.call("switch", json!({ "team": w.team })).await;
    w.report.note(format!("B's switch to the team: {sw:?}"));
    w.report.check(sw.as_ref().is_err_and(|e| e.contains("withdrew this launcher's access")), "B cannot switch back to the team");
    let r = w.b.call("launch", json!({ "id": id })).await;
    w.report.note(format!("B's start of P now: {}", match &r { Ok(v) => short(v), Err(e) => e.clone() }));
    w.report.check(r.is_err(), "B cannot start P any more");
    let warn: Vec<String> = w.b.log(&w.logs).lines().filter(|l| l.contains("WARNING")).map(String::from).collect();
    w.report.note(format!("B's warnings: {}", warn.join(" ; ")));
    Ok(())
}

async fn t11(w: &mut World) -> R {
    let id = w.p.clone();
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    w.a_browser = l["pid"].as_u64().unwrap_or(0) as u32;
    let base = w.site_url("");
    let read = w.read_browser(&ws, &base).await?;
    let cookies: Vec<String> = serde_json::from_value(read["cookies"].clone()).unwrap_or_default();
    w.report.check(!cookies.iter().any(|c| c.starts_with("srv_gone")), format!("B's discarded cookie is not in the team's session: {cookies:?}"));
    w.set_in_browser(&ws, &base, "k9", "kill9").await?;
    let rev0 = w.row(&id).await?["session_rev"].as_u64().unwrap_or(0);
    let copy = w.copy_dir(w.a.as_ref().unwrap(), &id);
    let reapers = String::from_utf8_lossy(&std::process::Command::new("pgrep").args(["-fl", "--", "--reap"]).output().map(|o| o.stdout).unwrap_or_default()).to_string();
    let mine: Vec<&str> = reapers.lines().filter(|l| l.contains(&copy.display().to_string())).collect();
    w.report.note(format!("A's reaper before the kill: {mine:?}"));
    let a_pid = w.a().pid;
    let t0 = Instant::now();
    w.a.take().unwrap().kill9().await;
    w.report.note(format!("kill -9 {a_pid} (A's launcher) with P open"));
    let mut saved = None;
    let mut gone = None;
    let mut wiped = None;
    while t0.elapsed() < Duration::from_secs(60) && (saved.is_none() || gone.is_none() || wiped.is_none()) {
        if saved.is_none() && w.row(&id).await?["session_rev"].as_u64().unwrap_or(0) > rev0 {
            saved = Some(t0.elapsed());
        }
        if gone.is_none() && !World::pids_alive(w.a_browser) {
            gone = Some(t0.elapsed());
        }
        if wiped.is_none() && !copy.exists() {
            wiped = Some(t0.elapsed());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let row = w.row(&id).await?;
    w.report.check(gone.is_some(), format!("the reaper closed A's browser: {gone:?}"));
    w.report.check(saved.is_some_and(|t| t <= Duration::from_secs(25)), format!("session uploaded within 25 s: {saved:?} (session_rev {rev0} -> {})", row["session_rev"]));
    w.report.check(wiped.is_some(), format!("copy wiped on disk: {wiped:?} ({})", copy.display()));
    w.report.check(row["open_on"].is_null(), format!("lease given back: open_on={}", row["open_on"]));
    // A's launcher again, on the same data.
    let how = harness::Spawn { engine: &w.engine, fp: &w.fp, logs: &w.logs };
    let a = Dev::spawn("Device A", "a", w.out.join("devices/a"), &how).await?;
    w.a = Some(a);
    let t0 = Instant::now();
    let at_once = w.a().call("launch", json!({ "id": id })).await;
    w.report.check(at_once.is_ok(), format!("a start right after the launcher came back: {}", match &at_once { Ok(_) => "started".to_string(), Err(e) => format!("refused: \"{e}\"") }));
    if at_once.is_ok() {
        w.a().call("stop", json!({ "id": id })).await?;
    }
    let mut rights = Value::Null;
    while t0.elapsed() < Duration::from_secs(30) {
        rights = World::rights_of(w.a(), &id).await?;
        if rights["start"] == json!(true) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    w.report.note(format!("A's rights on P {:?} after the restart: {rights}", t0.elapsed()));
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    let read = w.read_browser(&ws, &base).await?;
    let cookies: Vec<String> = serde_json::from_value(read["cookies"].clone()).unwrap_or_default();
    w.report.check(cookies.contains(&"srv_k9=kill9".to_string()), format!("after a restart A opens P with the cookie set before the kill: {cookies:?}"));
    w.a().call("stop", json!({ "id": id })).await?;
    Ok(())
}

// ---- DIAGNOSTIC ----

/// The cookies the profile's own store on disk holds for `host`.
fn cookies_on_disk(udd: &Path, host: &str) -> Vec<String> {
    let mut out = Vec::new();
    for f in ["Default/Cookies", "Default/Network/Cookies"] {
        let p = udd.join(f);
        if !p.exists() {
            continue;
        }
        let Ok(db) = rusqlite::Connection::open_with_flags(&p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { continue };
        let Ok(mut q) = db.prepare("SELECT name FROM cookies WHERE host_key = ?1 ORDER BY name") else { continue };
        let rows = q.query_map([host], |r| r.get::<_, String>(0)).map(|r| r.flatten().collect::<Vec<_>>()).unwrap_or_default();
        out.extend(rows);
    }
    out
}

/// A personal profile on A: a cookie set, then closed five ways (the fifth a start with the bus, stopped by the bus quit); what its own store keeps each time.
async fn d1(w: &mut World) -> R {
    let p = w.a().call("create_profile", json!({ "name": "Flush probe", "folder": "" })).await?;
    let id = p["id"].as_str().unwrap_or_default().to_string();
    let udd = w.a.as_ref().unwrap().data().join("user-data").join(&id);
    let base = w.site_url("");
    // m4 starts with the bus, as the UI does: an engine that offers the quit is stopped by it.
    let mut bus_quit = (false, false);
    for (k, how, wait) in [("m0", "Stop (the launcher's)", 0u64), ("m1", "SIGINT", 0), ("m2", "CDP Browser.close", 0), ("m3", "Stop (the launcher's) after 35 s", 35), ("m4", "Stop of a bus start", 0)] {
        let l = w.a().call(if k == "m4" { "launch_bus" } else { "launch" }, json!({ "id": id })).await?;
        let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
        let pid = l["pid"].as_u64().unwrap_or(0) as i32;
        w.set_in_browser(&ws, &base, k, "1").await?;
        tokio::time::sleep(Duration::from_secs(wait)).await;
        if k == "m4" {
            let t = Instant::now();
            while !bus_quit.0 && t.elapsed() < Duration::from_secs(15) {
                bus_quit.0 = w.a().call("bus_quits", json!({ "id": id })).await?.as_bool().unwrap_or(false);
                if !bus_quit.0 {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
            w.report.note(format!("bus start: the engine offered the quit: {} (after {:?})", bus_quit.0, t.elapsed()));
        }
        let log_before = w.a.as_ref().unwrap().log(&w.logs).len();
        let since = w.a().call("now", json!({})).await?.as_u64().unwrap_or(0);
        let t0 = Instant::now();
        match k {
            "m1" => {
                unsafe { libc::kill(pid, libc::SIGINT) };
                w.a().call("wait_closed", json!({ "id": id, "since": since, "secs": 60 })).await?;
            }
            "m2" => {
                let mut cdp = Cdp::connect(&ws).await?;
                let _ = cdp.call("Browser.close", json!({}), None).await;
                w.a().call("wait_closed", json!({ "id": id, "since": since, "secs": 60 })).await?;
            }
            _ => {
                w.a().call("stop", json!({ "id": id })).await?;
            }
        }
        let took = t0.elapsed();
        let on_disk = cookies_on_disk(&udd, "127.0.0.1");
        let kept = on_disk.iter().any(|c| c == &format!("srv_{k}"));
        w.report.note(format!("{how}: closed in {took:?}; srv_{k} on disk: {kept}; store holds {on_disk:?}"));
        if k == "m4" {
            let log = w.a.as_ref().unwrap().log(&w.logs);
            let asked: Vec<&str> = log.get(log_before..).unwrap_or("").lines().filter(|l| l.contains("[tracker]") && l.contains("asked")).collect();
            bus_quit.1 = asked.iter().any(|l| l.contains("asked to close by the bus quit"));
            w.report.note(format!("Stop of the bus start, the launcher's log: {asked:?}"));
        }
    }
    let row = |s: &str| w.report.rows.last().map(|r| r.evidence.iter().any(|e| e.starts_with(s) && e.contains("on disk: true"))).unwrap_or(false);
    let (stop, int, close, late, bus) = (row("Stop (the launcher's): "), row("SIGINT"), row("CDP Browser.close"), row("Stop (the launcher's) after"), row("Stop of a bus start"));
    w.report.check(stop, "a cookie set just before the launcher's Stop is on disk after it");
    w.report.check(int && close && late, format!("SIGINT kept it: {int}; Browser.close kept it: {close}; Stop after 35 s kept it: {late}"));
    w.report.check(
        bus_quit.0 && bus_quit.1 && bus,
        format!("a bus start: the engine offered the quit: {}; Stop took it: {}; the cookie on disk: {bus}", bus_quit.0, bus_quit.1),
    );
    Ok(())
}

// ---- SYNC ----

async fn s1(w: &mut World) -> R {
    let st = w.a().call("switch", json!({ "team": "" })).await?;
    w.report.check(st["space"]["kind"] == json!("personal"), "A switched to its personal space");
    let team = w.team.clone();
    let c = w.a().call("sync_connect", json!({ "team": team })).await?;
    w.report.note(format!("A connected sync: {}", short(&c["connection"])));
    let p = w.a().call("create_profile", json!({ "name": "Synced shop", "folder": "" })).await?;
    w.sp = p["id"].as_str().unwrap_or_default().into();
    let sp = w.sp.clone();
    let proxy_port = w.proxy.port;
    let x = w.a().call("proxy_save", json!({ "entry": { "name": "Live proxy", "kind": "http", "host": "127.0.0.1", "port": proxy_port } })).await?;
    let xid = x["id"].as_str().unwrap_or_default().to_string();
    w.a().call("bind_proxy", json!({ "id": sp, "proxy": xid })).await?;
    w.a().call("folder_add", json!({ "name": "Personal F" })).await?;
    w.a().call("set_folder", json!({ "id": sp, "folder": "Personal F" })).await?;
    let tag = w.a().call("tag_save", json!({ "tag": { "name": "warm-up", "color": "blue" } })).await?;
    let tid = tag["id"].as_str().unwrap_or_default().to_string();
    let mut by_profile = serde_json::Map::new();
    by_profile.insert(sp.clone(), json!([tid]));
    w.a().call("tag_assign", json!({ "by_profile": by_profile })).await?;
    let bm_url = w.proxied_url("/?bookmark=personal");
    w.a().call("bookmark_save", json!({ "entry": { "title": "Live personal bookmark", "url": bm_url, "folder": "" } })).await?;
    let zip = w.out.join("ext/live-lib-ext.zip");
    let ext = w.a().call("extension_import", json!({ "path": zip })).await?;
    let ext_id = ext[0]["id"].as_str().unwrap_or_default().to_string();
    w.a().call("edit_profile", json!({ "id": sp, "meta": { "extensions": [ext_id] } })).await?;
    let mut project = w.a().call("automation_create", json!({ "name": "Live project" })).await?;
    project["blocks"] = json!([{
        "id": "b1", "kind": "type", "label": "Type the password",
        "params": { "selector": "#pw", "text": "hunter2" }, "secrets": ["text"]
    }]);
    let project = w.a().call("automation_save", json!({ "project": project })).await?;
    w.report.note(format!("A made: profile {sp}, proxy {xid} (bound), folder Personal F, tag {tid}, bookmark, library extension {ext_id} (on the profile), project {} with a secret step param", project["id"]));
    w.a().call("sync_set", json!({ "ids": [sp], "on": true })).await?;
    let st = w.a().call("sync_now", json!({})).await?;
    w.report.check(st["status"]["state"] == json!("idle") && st["status"]["pending"] == json!(0), format!("A's sync settled: {}", short(&st["status"])));
    let tok = w.token_a.clone();
    let mut counts = Vec::new();
    for path in ["/me/profiles", "/me/proxies", "/me/folders", "/me/items/tag", "/me/items/bookmark", "/me/items/extension", "/me/items/automation"] {
        let v = w.server_get(&tok, path).await.unwrap_or(Value::Null);
        counts.push(format!("{path}={}", v.as_array().map_or(0, |a| a.len())));
    }
    w.report.note(format!("server, A's own space: {}", counts.join(" ")));
    w.report.check(counts.iter().all(|c| !c.ends_with("=0")), "every kind is on the server under /me");
    let srv_project = w.server_get(&tok, "/me/items/automation").await?;
    let data = srv_project[0]["data"].as_str().unwrap_or_default();
    use base64::Engine as _;
    let decoded = base64::engine::general_purpose::STANDARD.decode(data).map(|b| String::from_utf8_lossy(&b).to_string()).unwrap_or_default();
    w.report.check(!decoded.contains("hunter2"), "the secret param never reached the server");
    Ok(())
}

async fn s2(w: &mut World) -> R {
    let invite = w.a().call("sync_invite", json!({})).await?;
    let invite = invite.as_str().unwrap_or_default().to_string();
    w.report.check(split_invite(&invite).is_some_and(|(s, t)| s == w.server.url() && t == w.token_a), "A's sync invite is the same server and A's member token");
    let c = w.b.call("sync_connect", json!({ "invite": invite })).await?;
    w.report.note(format!("B connected: {}", short(&c["connection"])));
    let st = w.b.call("sync_now", json!({})).await?;
    w.report.note(format!("B's first sync: {}", short(&st["status"])));
    let rows = w.b.call("profiles", json!({})).await?;
    let mine = rows.as_array().and_then(|r| r.iter().find(|p| p["id"] == json!(w.sp)).cloned()).unwrap_or_default();
    w.report.check(!mine.is_null(), format!("B has the profile: folder={} proxy_id={} extensions={} sync={}", mine["folder"], mine["proxy_id"], mine["extensions"], mine["sync"]));
    w.report.check(mine["folder"] == json!("Personal F"), "in its folder");
    let px = w.b.call("proxy_list", json!({})).await?;
    w.report.check(px.as_array().is_some_and(|a| a.iter().any(|p| p["name"] == json!("Live proxy") && p["id"] == mine["proxy_id"])), format!("B has the bound proxy: {}", short(&px)));
    let f = w.b.call("folder_list", json!({})).await?;
    w.report.check(f.to_string().contains("Personal F"), format!("B has the folder: {}", short(&f)));
    let t = w.b.call("tag_list", json!({})).await?;
    w.report.check(t.to_string().contains("warm-up") && t.to_string().contains(&w.sp), format!("B has the tag on the profile: {}", short(&t)));
    let bm = w.b.call("bookmark_list", json!({})).await?;
    w.report.check(bm.to_string().contains("Live personal bookmark"), format!("B has the bookmark: {}", short(&bm)));
    let ex = w.b.call("extension_list", json!({})).await?;
    w.report.check(ex.to_string().contains("Live Lib Ext"), format!("B has the library extension: {}", short(&ex)));
    let pb = w.b.call("automation_list", json!({})).await?;
    let pa = w.a().call("automation_list", json!({})).await?;
    let text = |v: &Value| v[0]["blocks"][0]["params"]["text"].clone();
    w.report.check(text(&pb) == json!("") && text(&pa) == json!("hunter2"), format!("the secret step param is blank on B ({}) and filled on A ({})", text(&pb), text(&pa)));
    Ok(())
}

async fn s3(w: &mut World) -> R {
    let sp = w.sp.clone();
    let hits0 = w.proxy.log.lock().unwrap().len();
    let l = w.a().call("launch", json!({ "id": sp })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    let base = w.proxied_url("");
    let set = w.set_in_browser(&ws, &base, "s1", "fromA").await?;
    let hits: Vec<String> = w.proxy.log.lock().unwrap()[hits0..].iter().filter(|h| h.contains("live.test")).cloned().collect();
    w.report.note(format!("A set s1 via the bound proxy: {} ; proxy saw {hits:?}", short(&set)));
    w.report.check(!hits.is_empty(), "A's browser went through the bound proxy");
    let r = w.b.call("launch", json!({ "id": sp })).await;
    let want = "this profile is open on Device A: close it there first";
    match &r {
        Err(e) => w.report.check(e == want, format!("B's start refused with the SYNC_REFUSALS.leased text: \"{e}\"")),
        Ok(v) => w.report.check(false, format!("B's start was not refused: {}", short(v))),
    };
    let rows = w.b.call("profiles", json!({})).await?;
    let mine = rows.as_array().and_then(|r| r.iter().find(|p| p["id"] == json!(sp)).cloned()).unwrap_or_default();
    w.report.note(format!("B's row: sync={}", mine["sync"]));
    std::fs::write(w.out.join("a_ws.txt"), ws).ok();
    Ok(())
}

async fn s4(w: &mut World) -> R {
    let sp = w.sp.clone();
    let stop = w.a().call("stop", json!({ "id": sp })).await?;
    w.report.note(format!("A closed it in {} ms", stop["closed_ms"]));
    let row = w.server_get(&w.token_a, &format!("/me/profiles/{sp}")).await?;
    w.report.note(format!("server /me row: session_rev={} session_size={} open_on={}", row["session_rev"], row["session_size"], row["open_on"]));
    let hits0 = w.proxy.log.lock().unwrap().len();
    let l = w.b.call("launch", json!({ "id": sp })).await?;
    let ws = l["ws"].as_str().ok_or("no CDP")?.to_string();
    let read = w.read_browser(&ws, &w.proxied_url("")).await?;
    w.report.note(format!("B's browser: {}", short(&read)));
    let cookies: Vec<String> = serde_json::from_value(read["cookies"].clone()).unwrap_or_default();
    w.report.check(cookies.contains(&"srv_s1=fromA".to_string()) && read["page"]["ls"]["ls_s1"] == json!("fromA"), "B opens it with A's cookie and localStorage");
    let hits: Vec<String> = w.proxy.log.lock().unwrap()[hits0..].iter().filter(|h| h.contains("live.test")).cloned().collect();
    w.report.check(!hits.is_empty(), format!("B's browser used the synced bound proxy: {hits:?}"));
    w.report.check(read["page"]["lib_ext"] == json!("lib"), "the synced library extension runs in B's browser");
    w.b.call("stop", json!({ "id": sp })).await?;
    Ok(())
}

async fn s5(w: &mut World) -> R {
    let sp = w.sp.clone();
    w.server.stop().await;
    w.report.note("team server stopped (SIGTERM)");
    let saved = w.b.call("edit_profile", json!({ "id": sp, "config": { "notes": "offline edit by B" } })).await?;
    w.report.note(format!("B edited the profile offline: notes={}", saved["notes"]));
    let r = w.b.call("sync_now", json!({})).await;
    let want = format!("the sync server at 127.0.0.1:{} did not answer", w.server.port);
    match &r {
        Err(e) => w.report.check(*e == want, format!("B's sync now refused: \"{e}\"")),
        Ok(v) => w.report.check(false, format!("B's sync went: {}", short(v))),
    };
    let first = w.b.call("sync_state", json!({})).await?;
    w.report.check(first["status"]["pending"].as_u64().unwrap_or(0) >= 1, format!("B's status right after the refused sync now counts the edit: {}", short(&first["status"])));
    let t0 = Instant::now();
    let mut st = first.clone();
    while t0.elapsed() < Duration::from_secs(20) && st["status"]["pending"].as_u64().unwrap_or(0) == 0 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        st = w.b.call("sync_state", json!({})).await?;
    }
    w.report.check(st["status"]["pending"].as_u64().unwrap_or(0) >= 1, format!("B's outbox holds it {:?} later: {}", t0.elapsed(), short(&st["status"])));
    w.server.start().await?;
    w.report.note("team server started again on the same data");
    let st = w.b.call("sync_now", json!({})).await?;
    w.report.check(st["status"]["pending"] == json!(0) && st["status"]["state"] == json!("idle"), format!("B's outbox flushed: {}", short(&st["status"])));
    w.a().call("sync_now", json!({})).await?;
    let pa = w.a().call("profile_get", json!({ "id": sp })).await?;
    w.report.check(pa["notes"] == json!("offline edit by B"), format!("A has B's offline edit after its sync: notes={}", pa["notes"]));
    Ok(())
}

async fn s6(w: &mut World) -> R {
    let sp = w.sp.clone();
    w.a().call("edit_profile", json!({ "id": sp, "config": { "notes": "edit on A" } })).await?;
    w.b.call("edit_profile", json!({ "id": sp, "config": { "notes": "edit on B" } })).await?;
    for _ in 0..2 {
        w.a().call("sync_now", json!({})).await?;
        w.b.call("sync_now", json!({})).await?;
    }
    w.a().call("sync_now", json!({})).await?;
    let mut both = Vec::new();
    for dev in ["A", "B"] {
        let rows = if dev == "A" { w.a().call("profiles", json!({})).await? } else { w.b.call("profiles", json!({})).await? };
        let shown: Vec<String> = rows
            .as_array()
            .map(|r| r.iter().filter(|p| p["name"].as_str().unwrap_or("").starts_with("Synced shop")).map(|p| format!("{} [{}] notes={}", p["name"].as_str().unwrap_or(""), p["id"].as_str().unwrap_or(""), p["notes"])).collect())
            .unwrap_or_default();
        w.report.note(format!("{dev}'s rows: {shown:?}"));
        both.push(shown);
    }
    for (dev, shown) in ["A", "B"].iter().zip(&both) {
        let copy = shown.iter().any(|s| s.contains("(conflict copy)"));
        let a_kept = shown.iter().any(|s| s.contains("\"edit on A\""));
        let b_kept = shown.iter().any(|s| s.contains("\"edit on B\""));
        w.report.check(copy && a_kept && b_kept, format!("{dev} has a \"(conflict copy)\" and both edits are kept"));
    }
    Ok(())
}

async fn s7(w: &mut World) -> R {
    let before = w.server_get(&w.token_a, "/me/profiles").await?;
    let d = w.a().call("sync_disconnect", json!({ "remove": true })).await?;
    w.report.note(format!("A disconnected with removeFromServer: connection={}", d["connection"]));
    let mut left = Vec::new();
    for path in ["/me/profiles", "/me/proxies", "/me/items/bookmark", "/me/items/extension", "/me/items/automation", "/me/items/tag"] {
        let v = w.server_get(&w.token_a, path).await.unwrap_or(Value::Null);
        left.push(format!("{path}={}", v.as_array().map_or(0, |a| a.len())));
    }
    w.report.check(left.iter().all(|c| c.ends_with("=0")), format!("server copies gone ({} profiles before): {}", before.as_array().map_or(0, |a| a.len()), left.join(" ")));
    let rows = w.a().call("profiles", json!({})).await?;
    let kept: Vec<String> = rows.as_array().map(|r| r.iter().map(|p| p["name"].as_str().unwrap_or("").to_string()).collect()).unwrap_or_default();
    w.report.check(kept.iter().any(|n| n == "Synced shop"), format!("A's local profiles stay: {kept:?}"));
    let st = w.b.call("sync_now", json!({})).await;
    let st = match st {
        Ok(v) => v,
        Err(e) => json!({ "refused": e }),
    };
    w.report.note(format!("B's next sync: {}", short(&st)));
    Ok(())
}

// ---- the failure-mode run ----

#[path = "live_e2e_more.rs"]
mod more;

// ---- the run ----

/// A tiny MV3 extension: a service worker, and a content script that marks the page.
fn make_extension(dir: &Path, name: &str, mark: &str, value: &str) -> PathBuf {
    use std::io::Write;
    let manifest = json!({
        "manifest_version": 3, "name": name, "version": "1.0",
        "background": { "service_worker": "bg.js" },
        "content_scripts": [{ "matches": ["<all_urls>"], "js": ["cs.js"], "run_at": "document_start" }]
    });
    let zip_path = dir.join(format!("{}.zip", name.to_lowercase().replace(' ', "-")));
    let f = std::fs::File::create(&zip_path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (n, body) in [
        ("manifest.json", manifest.to_string()),
        ("bg.js", "chrome.runtime.onInstalled.addListener(() => {});\n".to_string()),
        ("cs.js", format!("document.documentElement.dataset.{mark} = '{value}';\n")),
    ] {
        z.start_file(n, o).unwrap();
        z.write_all(body.as_bytes()).unwrap();
    }
    z.finish().unwrap();
    zip_path
}

/// Browsers this run left behind: only ones started on a folder under `out`.
fn kill_leftovers(out: &Path) {
    let ps = std::process::Command::new("ps").args(["-axo", "pid=,command="]).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let mark = out.display().to_string();
    for l in ps.lines() {
        let l = l.trim();
        let Some((pid, cmd)) = l.split_once(' ') else { continue };
        // Browsers on a profile folder under `out`, and reapers of copies there.
        let ours = cmd.contains(&format!("--user-data-dir={mark}")) || (cmd.contains("--reap") && cmd.contains(&mark));
        if ours {
            if let Ok(pid) = pid.parse::<i32>() {
                eprintln!("[live] leftover pid {pid}: {}", &cmd[..cmd.len().min(160)]);
                unsafe { libc::kill(pid, libc::SIGTERM) };
            }
        }
    }
}

#[test]
#[ignore = "live: needs SHARDX_LIVE_SERVER and SHARDX_ENGINE; see the module docs"]
fn run() {
    let (Ok(server_bin), Ok(engine)) = (std::env::var(ENV_SERVER), std::env::var(ENV_ENGINE)) else {
        eprintln!("live_e2e: set {ENV_SERVER} and {ENV_ENGINE} to run it");
        return;
    };
    let engine = engine_binary(Path::new(&engine));
    assert!(engine.is_file(), "no engine at {}", engine.display());
    let fp = std::env::var(ENV_FP).map(PathBuf::from).ok().or_else(|| fingerprint_near(&engine)).expect("a fingerprint: set SHARDX_LIVE_FINGERPRINT");
    let out = std::env::var(ENV_OUT)
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join(format!("shardx-live-{}", uuid::Uuid::new_v4().simple())));
    let logs = out.join("logs");
    std::fs::create_dir_all(&logs).unwrap();
    std::fs::create_dir_all(out.join("ext")).unwrap();
    make_extension(&out.join("ext"), "Live Team Ext", "liveTeam", "team");
    make_extension(&out.join("ext"), "Live Lib Ext", "liveLib", "lib");
    eprintln!("[live] out: {}", out.display());

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
    rt.block_on(async {
        let site = harness::site().await;
        let proxy = harness::proxy(site.port).await;
        let how = harness::Spawn { engine: &engine, fp: &fp, logs: &logs };
        let admin = Dev::spawn("Admin", "admin", out.join("devices/admin"), &how).await.unwrap();
        let a = Dev::spawn("Device A", "a", out.join("devices/a"), &how).await.unwrap();
        let b = Dev::spawn("Device B", "b", out.join("devices/b"), &how).await.unwrap();
        let skew_lib = std::env::var("SHARDX_LIVE_SKEW").ok().map(PathBuf::from);
        let server_skew = out.join("server.skew");
        let d_skew = out.join("d.skew");
        std::fs::write(&server_skew, "0").unwrap();
        std::fs::write(&d_skew, "0").unwrap();
        let mut server_env = Vec::new();
        if let Some(lib) = &skew_lib {
            server_env.push(("DYLD_INSERT_LIBRARIES".to_string(), lib.display().to_string()));
            server_env.push(("SHARDX_SKEW_FILE".to_string(), server_skew.display().to_string()));
        }
        let server = Server {
            bin: PathBuf::from(&server_bin),
            data: out.join("server-data"),
            port: harness::free_port(),
            log: logs.join("server.log"),
            child: None,
            env: server_env,
        };
        let mut w = World {
            out: out.clone(),
            logs: logs.clone(),
            engine: engine.clone(),
            fp: fp.clone(),
            server,
            site,
            proxy,
            admin,
            a: Some(a),
            b,
            report: Report { rows: Vec::new(), out: out.clone() },
            key: String::new(),
            admin_token: String::new(),
            team: String::new(),
            member_a: String::new(),
            member_b: String::new(),
            token_a: String::new(),
            p: String::new(),
            q: String::new(),
            a_browser: 0,
            sp: String::new(),
            relay: None,
            c: None,
            d: None,
            e: None,
            member_c: String::new(),
            member_d: String::new(),
            token_c: String::new(),
            invite_c: String::new(),
            p2: String::new(),
            skew_lib,
            server_skew,
            d_skew,
        };
        if std::env::var("SHARDX_LIVE_SET").as_deref() == Ok("F") {
            more::run_failures(&mut w).await;
            for d in [w.a.take(), w.c.take(), w.d.take(), w.e.take()].into_iter().flatten() {
                d.exit().await;
            }
            let World { admin, b, mut server, .. } = w;
            b.exit().await;
            admin.exit().await;
            server.stop().await;
            return;
        }
        let only = std::env::var("SHARDX_LIVE_ONLY").unwrap_or_default();
        let want = |id: &str| only.is_empty() || only.split(',').any(|o| o == id);
        if want("D1") { scenario!(w, "D1", "diagnostic: a cookie set just before close, closed five ways, the fifth by the bus quit (personal profile on A)", d1); }
        scenario!(w, "T1", "server up; admin joins by the printed invite; two member invites; A and B join by invite (http by IP)", t1);
        scenario!(w, "T2", "admin grants A Create/Edit/Start/Cookies (team) and B Start+Cookies on folder Shop", t2);
        scenario!(w, "T3", "A creates a profile in Shop, starts it (real engine), sets cookie + localStorage, closes: session_rev 1", t3);
        if want("T4") { scenario!(w, "T4", "B sees only Shop's profile, starts it: A's cookie and localStorage are there", t4); }
        if want("T5") { scenario!(w, "T5", "while B has it open, A's start is refused with \"open on Device B\"", t5); }
        if want("T6") { scenario!(w, "T6", "B sets a cookie, keeps the browser 35 s, closes; A opens and sees B's changes", t6); }
        if want("T7") { scenario!(w, "T7", "admin removes Start from B live: B's rights update within seconds, a start is refused", t7); }
        if want("T8") { scenario!(w, "T8", "a team bookmark made by A is in B's browser bookmarks at B's next start (B: folder-only rights)", t8); }
        if want("T9") { scenario!(w, "T9", "a team extension imported by A and assigned to P loads in B's browser (B: folder-only rights)", t9); }
        if want("T9b") { scenario!(w, "T9b", "the same bookmark and extension once B also has See on the team; the extension folder goes after close", t9b); }
        if want("T10") { scenario!(w, "T10", "admin removes B while B has the profile open: B's session discarded, access gone", t10); }
        if want("T11") { scenario!(w, "T11", "kill -9 of A's launcher with the profile open: the reaper closes, uploads within 25 s, wipes", t11); }
        if want("S1") { scenario!(w, "S1", "A connects sync (/me, member token); makes profile+bound proxy+folder+tag+bookmark+library extension+project with a secret; syncs", s1); }
        if want("S2") { scenario!(w, "S2", "B connects with A's sync invite (same token, other device) and gets all of it; the secret is blank on B", s2); }
        if want("S3") { scenario!(w, "S3", "A opens the synced profile and sets a cookie; B's start is refused with SYNC_REFUSALS.leased", s3); }
        if want("S4") { scenario!(w, "S4", "A closes; B opens it with A's cookie", s4); }
        if want("S5") { scenario!(w, "S5", "server stopped; B edits offline (outbox); server back: flushed", s5); }
        if want("S6") { scenario!(w, "S6", "A and B edit the same profile between syncs: a \"(conflict copy)\" and both versions kept", s6); }
        if want("S7") { scenario!(w, "S7", "A disconnects with removeFromServer: server copies gone, local kept", s7); }
        // Down as the app goes down.
        if let Some(a) = w.a.take() {
            a.exit().await;
        }
        let World { admin, b, mut server, .. } = w;
        b.exit().await;
        admin.exit().await;
        server.stop().await;
    });
    kill_leftovers(&out);
    eprintln!("[live] evidence: {}", out.join("evidence.md").display());
}
