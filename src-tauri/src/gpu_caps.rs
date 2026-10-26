// What the machine's GPU can actually do, and which library fingerprints it
// can wear without contradicting itself.
//
// Why this exists
// ---------------
// The core replaces the WebGL extension list with the profile's — that is the
// point of the profile. What it cannot do is make an extension WORK. So a
// profile listing WEBGL_compressed_texture_astc on a machine whose driver has
// no ASTC produces a page that reads:
//
//     gl.getSupportedExtensions()          -> [... "WEBGL_compressed_texture_astc" ...]
//     gl.getExtension("WEBGL_compressed_texture_astc")  -> null
//
// The list says yes and the object says no. That is not a weak spoof, it is a
// self-contradiction, and it costs a detector two calls with no permission, no
// timing and no baseline. Anti-fraud vendors check exactly this pair because
// it is the cheapest way to catch a rewritten list.
//
// Hence: find out what the host really supports, once, and keep profiles that
// need more than that away from the user — silently when a profile is picked
// for them, loudly when they pick one themselves.
//
// How the answer is obtained
// --------------------------
// From the core itself, over DevTools, on a throwaway user data dir. Not from
// this launcher's own webview: on macOS that is WebKit and on Linux WebKitGTK,
// and their extension names and coverage differ from ANGLE's. The only
// authoritative answer is the engine that will actually run the profile.
//
// The result is cached against the engine version, because a Chromium bump can
// change ANGLE and with it the list.
//
// One probe at a time, under one deadline; a failed one is not repeated in the
// same run, and nothing in the UI waits on it for more than a second.

use crate::{runtime, store};
use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

/// Start, port and answer together; past it the engine is killed. Nothing
/// waits on it, so a cold start on a slow disk still fits.
const PROBE_DEADLINE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HostGlCaps {
    /// UNMASKED_RENDERER_WEBGL of the host, for display in the warning.
    pub renderer: String,
    pub vendor: String,
    pub webgl1: Vec<String>,
    pub webgl2: Vec<String>,
    /// GPUAdapter.features of the host. `None` means NEVER PROBED — a cache
    /// written before this field existed — and must not be read as "this
    /// machine supports nothing": that turned every profile that names a
    /// feature into a red incompatibility notice at once. `Some([])` is a
    /// machine that was asked and has no adapter, which is a real answer.
    #[serde(default)]
    pub webgpu: Option<Vec<String>>,
    /// Engine build the probe ran against; a mismatch re-probes.
    pub engine_version: String,
}

/// What a fingerprint would ask of this machine that the machine cannot give.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Compat {
    pub compatible: bool,
    /// Extensions the profile declares for WebGL1 that the host lacks.
    pub missing_webgl1: Vec<String>,
    pub missing_webgl2: Vec<String>,
    /// WebGPU features the profile claims that the host adapter lacks. The
    /// engine narrows the reported set to what is really there, so the profile
    /// runs — it just reports a shorter list than the device it names would.
    #[serde(default)]
    pub missing_webgpu: Vec<String>,
    /// The profile's own GPU string, so the UI can say "this is a Mali profile
    /// on an Apple GPU" without a second lookup.
    pub profile_renderer: String,
}

fn cache_path() -> Result<std::path::PathBuf> {
    Ok(store::settings_path()?
        .parent()
        .ok_or_else(|| anyhow!("no config dir"))?
        .join("host-gl-caps.json"))
}

/// The cache file. Format 2 is the first written by a probe that tells "no
/// WebGPU" (kept) from "could not ask" (null); older records are asked again.
#[derive(Serialize, Deserialize)]
struct Disk {
    #[serde(default)]
    format: u32,
    #[serde(flatten)]
    caps: HostGlCaps,
}

const DISK_FORMAT: u32 = 2;

/// Whether an answer is kept for later runs. A machine without WebGPU is an
/// answer; no WebGL, an unasked WebGPU or another engine build is not.
fn worth_keeping(caps: &HostGlCaps, engine: &str) -> bool {
    !caps.webgl1.is_empty() && caps.webgpu.is_some() && caps.engine_version == engine
}

fn read_disk(text: &str, engine: &str) -> Option<HostGlCaps> {
    let disk: Disk = serde_json::from_str(text).ok()?;
    (disk.format == DISK_FORMAT && worth_keeping(&disk.caps, engine)).then_some(disk.caps)
}

fn cached_for(engine: &str) -> Option<HostGlCaps> {
    read_disk(&std::fs::read_to_string(cache_path().ok()?).ok()?, engine)
}

/// The JS the probe runs. Kept here rather than in a file so there is nothing
/// to ship and nothing to get out of step with the struct above.
const PROBE_JS: &str = r#"(async () => {
  const c1 = document.createElement('canvas').getContext('webgl');
  const c2 = document.createElement('canvas').getContext('webgl2');
  const name = (g) => {
    if (!g) return '';
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
  };
  const vend = (g) => {
    if (!g) return '';
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return d ? String(g.getParameter(d.UNMASKED_VENDOR_WEBGL)) : '';
  };
  // No API or no adapter is an empty list: a real answer. A request that
  // throws or hangs is null: not asked, so not recorded as "no WebGPU".
  let webgpu = [];
  try {
    if (navigator.gpu) {
      const late = new Promise((_, no) => setTimeout(() => no(new Error('late')), 5000));
      const a = await Promise.race([navigator.gpu.requestAdapter(), late]);
      if (a) webgpu = [...a.features].sort();
    }
  } catch (e) { webgpu = null; }
  return JSON.stringify({
    renderer: name(c2) || name(c1),
    vendor: vend(c2) || vend(c1),
    webgl1: c1 ? c1.getSupportedExtensions() : [],
    webgl2: c2 ? c2.getSupportedExtensions() : [],
    webgpu,
  });
})()"#;

/// The page's DevTools socket, once the engine has opened its port.
async fn page_socket(http: &reqwest::Client, port: u16) -> Option<String> {
    let url = format!("http://127.0.0.1:{port}/json/list");
    let list: Value = http.get(url).send().await.ok()?.json().await.ok()?;
    let page = list.as_array()?.iter().find(|t| t["type"] == "page")?;
    page["webSocketDebuggerUrl"].as_str().map(str::to_string)
}

/// Runs PROBE_JS in the engine on `port`. Unbounded on its own: the caller's
/// deadline covers the port, the socket and the answer together.
async fn evaluate_in_core(port: u16) -> Result<String> {
    let http = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    // Poll rather than sleep a fixed amount: a fast machine is not a wait.
    let ws_url = loop {
        if let Some(u) = page_socket(&http, port).await {
            break u;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    };

    let (mut socket, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .context("connect to the core's debugging port")?;
    let msg = json!({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": PROBE_JS,
            "returnByValue": true,
            // The probe is async now: WebGPU only answers through a promise.
            "awaitPromise": true,
        },
    });
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(msg.to_string()))
        .await?;
    // A closed socket ends the wait; the old loop spun on it until its deadline.
    while let Some(msg) = socket.next().await {
        let tokio_tungstenite::tungstenite::Message::Text(text) = msg? else {
            continue;
        };
        let v: Value = serde_json::from_str(&text)?;
        if v["id"] == 1 {
            return v["result"]["result"]["value"]
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| anyhow!("probe returned no value"));
        }
    }
    Err(anyhow!("the engine closed the debugging connection"))
}

/// This run's answer, for the engine build it was asked of.
#[derive(Default)]
struct Memo {
    engine: String,
    answer: Option<Result<HostGlCaps, String>>,
}

/// One probe at a time: the lock is held through it.
#[derive(Default)]
struct Flight(tokio::sync::Mutex<Memo>);

impl Flight {
    async fn answer<A, Fut>(
        &self,
        force: bool,
        engine: &str,
        disk: impl FnOnce() -> Option<HostGlCaps>,
        ask: A,
    ) -> Result<HostGlCaps>
    where
        A: FnOnce() -> Fut,
        Fut: Future<Output = Result<HostGlCaps>>,
    {
        // A second caller waits here and reads the first one's answer.
        let mut memo = self.0.lock().await;
        let ours = memo.engine == engine;
        if !force && ours {
            match &memo.answer {
                Some(Ok(caps)) => return Ok(caps.clone()),
                Some(Err(why)) => return Err(anyhow!("the GPU check failed earlier in this run: {why}")),
                None => {}
            }
        }
        if !force {
            if let Some(hit) = disk() {
                *memo = Memo { engine: engine.to_string(), answer: Some(Ok(hit.clone())) };
                return Ok(hit);
            }
        }
        let got = ask().await;
        let had_good = ours && matches!(memo.answer, Some(Ok(_)));
        match &got {
            Ok(caps) => *memo = Memo { engine: engine.to_string(), answer: Some(Ok(caps.clone())) },
            // A failed re-check keeps the good answer it was meant to refresh.
            Err(_) if had_good => {}
            Err(e) => *memo = Memo { engine: engine.to_string(), answer: Some(Err(format!("{e:#}"))) },
        }
        got
    }
}

fn flight() -> &'static Flight {
    static F: OnceLock<Flight> = OnceLock::new();
    F.get_or_init(Flight::default)
}

/// Ask the engine what this machine supports. Cached; a failure is remembered
/// for the run (an Err at once, so the UI stops waiting); `force` re-asks.
pub async fn probe(force: bool) -> Result<HostGlCaps> {
    let engine = runtime::engine_version().unwrap_or_default();
    let Some(binary) = runtime::binary_path().ok().filter(|b| b.exists()) else {
        // Not remembered: the engine may finish installing later in this run.
        return cached_for(&engine)
            .filter(|_| !force)
            .ok_or_else(|| anyhow!("engine is not installed yet"));
    };
    // None starts while an install replaces the engine (not remembered either);
    // an install waits for one under way, held through the answer.
    let Some(_engine_use) = runtime::engine_use() else {
        return cached_for(&engine).filter(|_| !force).ok_or_else(|| anyhow!("{}", runtime::UPDATING));
    };
    flight()
        .answer(force, &engine, || cached_for(&engine), || ask_engine(&binary, &engine))
        .await
}

async fn ask_engine(binary: &Path, engine: &str) -> Result<HostGlCaps> {
    let raw = run_probe(binary, PROBE_DEADLINE).await?;
    let caps = parse_answer(&raw, engine)?;
    // A cache that cannot be written costs a probe next run, not this answer.
    if let (true, Ok(path)) = (worth_keeping(&caps, engine), cache_path()) {
        let disk = Disk { format: DISK_FORMAT, caps: caps.clone() };
        if let Ok(text) = serde_json::to_string_pretty(&disk) {
            let _ = std::fs::write(path, text);
        }
    }
    Ok(caps)
}

/// The probe's JSON as caps. No WebGL at all is a failure, not an answer.
fn parse_answer(raw: &str, engine: &str) -> Result<HostGlCaps> {
    let parsed: Value = serde_json::from_str(raw)?;
    let list = |v: &Value| -> Vec<String> {
        v.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let caps = HostGlCaps {
        renderer: parsed["renderer"].as_str().unwrap_or_default().to_string(),
        vendor: parsed["vendor"].as_str().unwrap_or_default().to_string(),
        webgl1: list(&parsed["webgl1"]),
        webgl2: list(&parsed["webgl2"]),
        // null: the adapter request threw or hung, which says nothing of the machine.
        webgpu: parsed["webgpu"].is_array().then(|| list(&parsed["webgpu"])),
        engine_version: engine.to_string(),
    };
    if caps.webgl1.is_empty() {
        anyhow::bail!("the engine reported no WebGL at all");
    }
    Ok(caps)
}

/// A user data dir no other probe shares: two engines on one dir hand off to
/// each other, and one probe's cleanup pulled the dir from under the other.
fn scratch_dir() -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("shardx-glcaps-{}-{n}", std::process::id()))
}

/// One engine start, bounded by `deadline`. On return the engine and all it
/// started are gone, and so is its scratch dir.
async fn run_probe(binary: &Path, deadline: Duration) -> Result<String> {
    let scratch = scratch_dir();
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch)?;
    let out = run_engine(binary, &scratch, deadline).await;
    remove_scratch(&scratch).await;
    out
}

async fn run_engine(binary: &Path, scratch: &Path, deadline: Duration) -> Result<String> {
    // A free port from the OS rather than a fixed one: the user may well have
    // profiles running, and a collision here would read their browser instead
    // of ours.
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0")?;
        l.local_addr()?.port()
    };

    // A page, not about:blank.  WebGPU is [SecureContext] and about:blank is
    // an opaque origin, so navigator.gpu is simply not there and the probe
    // recorded "this machine has no WebGPU adapter" -- which then stuck in the
    // cache and made every preset show a GPU mismatch.  A file:// URL is
    // potentially trustworthy, so the same probe answers with the real
    // adapter.  WebGL never needed this; it has no secure-context rule.
    let probe_page = scratch.join("probe.html");
    std::fs::write(&probe_page, "<!doctype html><title>gl</title>")?;

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", scratch.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        // Off-screen rather than headless: headless can fall back to a
        // software rasteriser, and a software rasteriser's extension list is
        // not the one the user's profiles will run against.
        .arg("--window-position=-32000,-32000")
        .arg("--window-size=200,200")
        .arg(format!("file://{}", probe_page.display()))
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0); // its own group, so the kill below takes its helpers too
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().context("start the engine for a GPU probe")?;
    let pid = child.id();

    let answer = tokio::time::timeout(deadline, async {
        tokio::select! {
            r = evaluate_in_core(port) => r,
            // No display, a crash, a refused sandbox: not worth the deadline.
            st = child.wait() => Err(match st {
                Ok(st) => anyhow!("the engine quit before it answered ({st})"),
                Err(e) => anyhow!("the engine quit before it answered ({e})"),
            }),
        }
    })
    .await
    .unwrap_or_else(|_| Err(anyhow!("the engine did not answer within {deadline:?}")));
    kill_tree(&mut child, pid).await;
    answer
}

/// The engine and its helpers, not just the process we started.
async fn kill_tree(child: &mut tokio::process::Child, pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        // SAFETY: a signal to the group the engine leads (process_group(0)).
        unsafe { libc::killpg(pid as libc::pid_t, libc::SIGKILL) };
    }
    #[cfg(windows)]
    if let (Some(pid), Some(_)) = (pid, child.id()) {
        // /T walks the tree from the live browser, so before the kill below.
        let _ = tokio::task::spawn_blocking(move || {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x0800_0000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
        })
        .await;
    }
    let _ = child.kill().await;
}

/// Windows keeps the files locked a moment after the processes end.
async fn remove_scratch(dir: &Path) {
    for _ in 0..20 {
        if std::fs::remove_dir_all(dir).is_ok() || !dir.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// Which of a fingerprint's declared extensions this machine cannot back.
///
/// Only the direction that matters is checked. A profile that declares FEWER
/// extensions than the host has is fine — the core hides the rest, and a page
/// asking for a hidden one gets null from both the list and getExtension,
/// which is what a device without it looks like. The reverse is the
/// contradiction.
pub fn compat(payload: &Value, caps: &HostGlCaps) -> Compat {
    let host1: BTreeSet<&str> = caps.webgl1.iter().map(String::as_str).collect();
    let host2: BTreeSet<&str> = caps.webgl2.iter().map(String::as_str).collect();
    let declared = |key: &str| -> Vec<String> {
        payload["webgl"][key]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let missing_webgl1: Vec<String> = declared("extensions")
        .into_iter()
        .filter(|e| !host1.contains(e.as_str()))
        .collect();
    let missing_webgl2: Vec<String> = declared("extensions_v2")
        .into_iter()
        .filter(|e| !host2.contains(e.as_str()))
        .collect();
    // An unprobed host answers nothing here: it is not evidence about the
    // machine, and treating it as one flags every profile in the library.
    let missing_webgpu: Vec<String> = match caps.webgpu.as_ref() {
        None => Vec::new(),
        Some(host) => {
            let host_gpu: BTreeSet<&str> = host.iter().map(String::as_str).collect();
            payload["webgpu"]["features"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str())
                        .filter(|f| !host_gpu.contains(f))
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        }
    };
    Compat {
        compatible: missing_webgl1.is_empty()
            && missing_webgl2.is_empty()
            && missing_webgpu.is_empty(),
        missing_webgl1,
        missing_webgl2,
        missing_webgpu,
        profile_renderer: payload["webgl"]["renderer"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps() -> HostGlCaps {
        HostGlCaps {
            renderer: "Apple M3".into(),
            vendor: "Apple".into(),
            webgl1: vec!["EXT_float_blend".into()],
            webgl2: vec!["EXT_float_blend".into()],
            webgpu: Some(vec![
                "texture-compression-astc".into(),
                "texture-compression-bc".into(),
                "shader-f16".into(),
            ]),
            engine_version: String::new(),
        }
    }

    /// Only the direction that matters is reported: a profile claiming FEWER
    /// features than the host has is not a problem — the engine narrows to the
    /// profile's list and a page sees a shorter one, which is what the claimed
    /// device would report anyway.
    #[test]
    fn only_features_the_host_lacks_are_reported() {
        let payload = serde_json::json!({
            "webgpu": { "features": ["texture-compression-astc", "shader-f16"] }
        });
        let c = compat(&payload, &caps());
        assert!(c.missing_webgpu.is_empty());
        assert!(c.compatible);
    }

    #[test]
    fn a_feature_this_machine_cannot_back_is_named() {
        let payload = serde_json::json!({
            "webgpu": { "features": ["texture-compression-etc2", "subgroups", "shader-f16"] }
        });
        let c = compat(&payload, &caps());
        assert_eq!(c.missing_webgpu, vec!["texture-compression-etc2", "subgroups"]);
        assert!(!c.compatible, "the profile asks for what the machine has not got");
    }

    /// A profile with no list at all keeps the old behaviour — the host's own
    /// features, and nothing to warn about.
    #[test]
    fn a_profile_that_declares_nothing_warns_about_nothing() {
        let c = compat(&serde_json::json!({ "webgpu": {} }), &caps());
        assert!(c.missing_webgpu.is_empty());
    }

    /// A machine with no WebGPU adapter reports an empty list, which must not
    /// read as "supports nothing" and warn about every feature a profile names.
    #[test]
    fn a_machine_without_webgpu_is_not_a_machine_that_supports_nothing() {
        let mut c = caps();
        c.webgpu = Some(Vec::new());
        let payload = serde_json::json!({ "webgpu": { "features": ["shader-f16"] } });
        let out = compat(&payload, &c);
        // It IS reported — the profile claims something this machine cannot
        // show — but the warning names one feature, not the whole list.
        assert_eq!(out.missing_webgpu, vec!["shader-f16"]);
    }

    /// A cache written before the WebGPU probe existed says nothing about the
    /// machine. Reading that silence as "has no features" turned every profile
    /// in the library red at once, on desktop and mobile alike, the day the
    /// library gained feature lists.
    #[test]
    fn an_unprobed_host_warns_about_nothing() {
        let mut c = caps();
        c.webgpu = None;
        let payload = serde_json::json!({
            "webgpu": { "features": ["shader-f16", "texture-compression-etc2"] }
        });
        let out = compat(&payload, &c);
        assert!(out.missing_webgpu.is_empty());
        assert!(out.compatible);
    }

    /// And such a cache is not used at all: the launcher re-asks rather than
    /// keep answering from a record that predates the question.
    #[test]
    fn an_unprobed_cache_is_not_a_cache_hit() {
        let mut c = caps();
        c.webgpu = None;
        let json = serde_json::to_string(&c).unwrap();
        let back: HostGlCaps = serde_json::from_str(&json).unwrap();
        assert!(back.webgpu.is_none(), "the field must survive the round trip");
    }

    fn on_disk(c: &HostGlCaps, format: u32) -> String {
        serde_json::to_string(&Disk { format, caps: c.clone() }).unwrap()
    }

    /// WebGL without WebGPU (Linux, old GPUs, VMs) is an answer: kept, not
    /// re-asked on every run.
    #[test]
    fn a_machine_without_webgpu_is_kept() {
        let mut c = caps();
        c.webgpu = Some(Vec::new());
        assert_eq!(read_disk(&on_disk(&c, DISK_FORMAT), "").unwrap().webgpu, Some(vec![]));
    }

    #[test]
    fn what_is_not_an_answer_is_not_kept() {
        let mut no_gl = caps();
        no_gl.webgl1.clear();
        assert!(read_disk(&on_disk(&no_gl, DISK_FORMAT), "").is_none());
        let mut unasked = caps();
        unasked.webgpu = None;
        assert!(read_disk(&on_disk(&unasked, DISK_FORMAT), "").is_none());
        assert!(read_disk(&on_disk(&caps(), DISK_FORMAT), "156.0.1.2").is_none(), "another build");
        // A record from before the format: its empty WebGPU may be about:blank's.
        assert!(read_disk(&serde_json::to_string(&caps()).unwrap(), "").is_none());
        assert!(read_disk(&on_disk(&caps(), DISK_FORMAT), "").is_some());
    }

    #[test]
    fn the_probe_tells_no_webgpu_from_unasked_and_no_webgl_is_a_failure() {
        let gl = r#""renderer":"r","vendor":"v","webgl1":["A"],"webgl2":[]"#;
        let none = parse_answer(&format!("{{{gl},\"webgpu\":[]}}"), "e").unwrap();
        assert_eq!(none.webgpu, Some(vec![]));
        assert!(worth_keeping(&none, "e"));
        let unasked = parse_answer(&format!("{{{gl},\"webgpu\":null}}"), "e").unwrap();
        assert_eq!(unasked.webgpu, None);
        assert!(!worth_keeping(&unasked, "e"));
        assert!(parse_answer(r#"{"webgl1":[],"webgl2":[],"webgpu":[]}"#, "e").is_err());
    }

    use std::sync::atomic::AtomicUsize;
    use std::sync::atomic::Ordering::SeqCst;

    /// The two commands the UI calls together start one engine, not two.
    #[tokio::test]
    async fn two_callers_share_one_probe() {
        let flight = Flight::default();
        let asked = &AtomicUsize::new(0);
        let ask = move || async move {
            asked.fetch_add(1, SeqCst);
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(caps())
        };
        let (a, b) = tokio::join!(
            flight.answer(false, "156", || None, ask),
            flight.answer(false, "156", || None, ask),
        );
        assert_eq!(asked.load(SeqCst), 1);
        assert_eq!(a.unwrap().renderer, b.unwrap().renderer);
    }

    #[tokio::test]
    async fn a_failed_probe_is_not_repeated_until_a_recheck_or_a_new_engine() {
        let flight = Flight::default();
        let asked = &AtomicUsize::new(0);
        let fail = move || async move {
            asked.fetch_add(1, SeqCst);
            Err::<HostGlCaps, _>(anyhow!("no display"))
        };
        assert!(flight.answer(false, "156", || None, fail).await.is_err());
        let again = flight.answer(false, "156", || None, fail).await.unwrap_err();
        assert!(again.to_string().contains("no display"), "{again}");
        assert_eq!(asked.load(SeqCst), 1, "remembered, not asked again");
        assert!(flight.answer(true, "156", || None, fail).await.is_err());
        assert_eq!(asked.load(SeqCst), 2, "force asks");
        assert!(flight.answer(false, "157", || None, fail).await.is_err());
        assert_eq!(asked.load(SeqCst), 3, "another engine build asks");
    }

    #[tokio::test]
    async fn the_cache_answers_and_a_failed_recheck_keeps_the_good_answer() {
        let flight = Flight::default();
        let asked = &AtomicUsize::new(0);
        let fail = move || async move {
            asked.fetch_add(1, SeqCst);
            Err::<HostGlCaps, _>(anyhow!("wedged"))
        };
        assert!(flight.answer(false, "156", || Some(caps()), fail).await.is_ok());
        assert_eq!(asked.load(SeqCst), 0);
        assert!(flight.answer(true, "156", || None, fail).await.is_err());
        assert!(flight.answer(false, "156", || None, fail).await.is_ok());
        assert_eq!(asked.load(SeqCst), 1);
    }

    #[test]
    fn every_probe_has_its_own_scratch_dir() {
        assert_ne!(scratch_dir(), scratch_dir());
    }

    #[cfg(unix)]
    fn fake_engine(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::remove_dir_all(dir);
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join("engine.sh");
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    fn alive(pid: i32) -> bool {
        // SAFETY: signal 0 only checks the pid.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    /// A wedged engine (no port ever) is killed at the deadline with what it
    /// started, and its scratch dir is gone.
    #[cfg(unix)]
    #[tokio::test]
    async fn an_engine_that_never_answers_is_killed_at_the_deadline() {
        let dir = std::env::temp_dir().join(format!("shardx-glcaps-test-wedged-{}", std::process::id()));
        let (args, pids) = (dir.join("args"), dir.join("pids"));
        let engine = fake_engine(
            &dir,
            &format!(
                "for a in \"$@\"; do echo \"$a\"; done > '{}'\nsleep 600 &\necho $! > '{p}'\necho $$ >> '{p}'\nwait",
                args.display(),
                p = pids.display()
            ),
        );
        let started = std::time::Instant::now();
        let err = run_probe(&engine, Duration::from_millis(1500)).await.unwrap_err();
        assert!(err.to_string().contains("did not answer"), "{err:#}");
        assert!(started.elapsed() < Duration::from_secs(8), "{:?}", started.elapsed());

        let pids: Vec<i32> = std::fs::read_to_string(&pids)
            .unwrap()
            .lines()
            .map(|l| l.trim().parse().unwrap())
            .collect();
        assert_eq!(pids.len(), 2, "the engine and its helper");
        let until = std::time::Instant::now() + Duration::from_secs(5);
        while pids.iter().any(|&p| alive(p)) && std::time::Instant::now() < until {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(pids.iter().all(|&p| !alive(p)), "left running: {pids:?}");

        let args = std::fs::read_to_string(&args).unwrap();
        let udd = args.lines().find_map(|l| l.strip_prefix("--user-data-dir=")).unwrap();
        assert!(!Path::new(udd).exists(), "scratch dir left behind: {udd}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// No display, a refused sandbox: the engine exits, and the probe says so
    /// at once instead of waiting out the deadline.
    #[cfg(unix)]
    #[tokio::test]
    async fn an_engine_that_quits_is_not_waited_out() {
        let dir = std::env::temp_dir().join(format!("shardx-glcaps-test-quits-{}", std::process::id()));
        let engine = fake_engine(&dir, "exit 3");
        let started = std::time::Instant::now();
        let err = run_probe(&engine, Duration::from_secs(20)).await.unwrap_err();
        assert!(err.to_string().contains("quit before it answered"), "{err:#}");
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The installed engine for real, named outright since tests never resolve the
    /// real runtime: `SHARDX_ENGINE=<binary> cargo test real_engine -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn real_engine_answers() {
        let engine = std::env::var_os("SHARDX_ENGINE").expect("SHARDX_ENGINE=<the engine binary>");
        let started = std::time::Instant::now();
        let raw = run_probe(Path::new(&engine), PROBE_DEADLINE).await.unwrap();
        let caps = parse_answer(&raw, "").unwrap();
        eprintln!(
            "{:?}: {} | webgl1 {} | webgpu {:?}",
            started.elapsed(),
            caps.renderer,
            caps.webgl1.len(),
            caps.webgpu.as_ref().map(Vec::len)
        );
    }
}
