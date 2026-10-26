//! Installs a stock engine into the launcher's own folder, apart from any copy
//! the computer has. Official builds only: Chrome for Testing and Chromium
//! snapshots from Google, Firefox from Mozilla. Unpacked in place; nothing is
//! installed system-wide, so no administrator prompt. Each install notes its
//! version beside it, so the Browsers page can say when a newer one is out.

use super::Engine;
use anyhow::{Context, Result};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Window};
use tokio::io::AsyncWriteExt;

/// `<runtime>/stock/<engine id>/`, beside the Octopus Agent engine.
fn root() -> Result<PathBuf> {
    Ok(crate::runtime::runtime_dir()?.join("stock"))
}

/// The file in an install's folder that holds its version.
const VERSION_FILE: &str = ".octopus-version";

/// The version of the copy the launcher installed, if it noted one.
pub fn installed_version(engine: Engine) -> Option<String> {
    let dir = root().ok()?.join(engine.id());
    let v = std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?;
    Some(v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Removes the launcher's own copy. A copy the computer has elsewhere stays.
pub fn remove(engine: Engine) -> Result<()> {
    let _busy = Busy::claim(engine)?;
    let dir = root()?.join(engine.id());
    if dir.exists() {
        std::fs::remove_dir_all(&dir).with_context(|| {
            format!("remove {} (close every profile that uses {} first)", dir.display(), engine.name())
        })?;
    }
    Ok(())
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent("Octopus-Agent")
        .timeout(std::time::Duration::from_secs(20))
        .build()?)
}

/// The newest version the vendor publishes for this computer.
pub async fn latest(engine: Engine) -> Result<String> {
    let client = client()?;
    Ok(source(&client, engine).await?.version)
}

/// The executable of a downloaded engine, if there is one.
pub fn downloaded(engine: Engine) -> Option<PathBuf> {
    let dir = root().ok()?.join(engine.id());
    inside(engine, &dir).into_iter().find(|p| p.is_file())
}

/// Where each archive puts the executable.
fn inside(engine: Engine, dir: &Path) -> Vec<PathBuf> {
    let rel: &[&str] = match engine {
        #[cfg(target_os = "windows")]
        Engine::Chrome => &["chrome-win64/chrome.exe"],
        #[cfg(target_os = "windows")]
        Engine::Chromium => &["chrome-win/chrome.exe"],
        #[cfg(target_os = "windows")]
        Engine::Firefox => &["firefox.exe", "core/firefox.exe"],
        #[cfg(target_os = "macos")]
        Engine::Chrome => &[
            "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ],
        #[cfg(target_os = "macos")]
        Engine::Chromium => &["chrome-mac/Chromium.app/Contents/MacOS/Chromium"],
        #[cfg(target_os = "macos")]
        Engine::Firefox => &["Firefox.app/Contents/MacOS/firefox"],
        #[cfg(target_os = "linux")]
        Engine::Chrome => &["chrome-linux64/chrome", "chrome-linux-arm64/chrome"],
        #[cfg(target_os = "linux")]
        Engine::Chromium => &["chrome-linux/chrome"],
        #[cfg(target_os = "linux")]
        Engine::Firefox => &["firefox/firefox"],
        _ => &[],
    };
    rel.iter().map(|r| dir.join(r)).collect()
}

/// How the download is opened.
#[derive(Clone, Copy)]
enum Kind {
    Zip,
    /// Firefox's Windows installer, which unpacks itself with /ExtractDir.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Setup,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    TarXz,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Dmg,
}

const CFT: &str = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
const SNAPSHOTS: &str = "https://storage.googleapis.com/chromium-browser-snapshots";
const FIREFOX_VERSIONS: &str = "https://product-details.mozilla.org/1.0/firefox_versions.json";

/// What to fetch, and the version it is.
struct Source {
    url: String,
    kind: Kind,
    version: String,
}

/// The archive to fetch for this computer, asked of the vendor each time.
async fn source(client: &reqwest::Client, engine: Engine) -> Result<Source> {
    let arm = cfg!(target_arch = "aarch64");
    let unsupported = || anyhow::anyhow!("{} has no download for this computer", engine.name());
    match engine {
        Engine::Chrome => {
            let platform = if cfg!(target_os = "windows") {
                "win64"
            } else if cfg!(target_os = "macos") {
                if arm { "mac-arm64" } else { "mac-x64" }
            } else if arm {
                "linux-arm64"
            } else {
                "linux64"
            };
            let v: serde_json::Value = client.get(CFT).send().await?.error_for_status()?.json().await?;
            let stable = &v["channels"]["Stable"];
            let url = stable["downloads"]["chrome"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|d| d["platform"] == platform)
                .and_then(|d| d["url"].as_str())
                .ok_or_else(unsupported)?;
            let version = stable["version"].as_str().unwrap_or_default().to_string();
            Ok(Source { url: url.to_string(), kind: Kind::Zip, version })
        }
        Engine::Chromium => {
            let (folder, zip) = if cfg!(target_os = "windows") {
                ("Win_x64", "chrome-win.zip")
            } else if cfg!(target_os = "macos") {
                (if arm { "Mac_Arm" } else { "Mac" }, "chrome-mac.zip")
            } else if !arm {
                ("Linux_x64", "chrome-linux.zip")
            } else {
                return Err(unsupported());
            };
            let rev = client
                .get(format!("{SNAPSHOTS}/{folder}/LAST_CHANGE"))
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            let rev = rev.trim();
            Ok(Source { url: format!("{SNAPSHOTS}/{folder}/{rev}/{zip}"), kind: Kind::Zip, version: format!("r{rev}") })
        }
        Engine::Firefox => {
            let (os, kind) = if cfg!(target_os = "windows") {
                ("win64", Kind::Setup)
            } else if cfg!(target_os = "macos") {
                ("osx", Kind::Dmg)
            } else {
                (if arm { "linux64-aarch64" } else { "linux64" }, Kind::TarXz)
            };
            // The version first, then that exact build, so what is noted is what was fetched.
            let v: serde_json::Value = client.get(FIREFOX_VERSIONS).send().await?.error_for_status()?.json().await?;
            let version = v["LATEST_FIREFOX_VERSION"].as_str().context("Mozilla gave no Firefox version")?.to_string();
            let url = format!("https://download.mozilla.org/?product=firefox-{version}-ssl&os={os}&lang=en-US");
            Ok(Source { url, kind, version })
        }
        Engine::ShardX => Err(unsupported()),
    }
}

/// Engines being fetched now: a second ask for one waits for nothing and is refused.
static BUSY: Mutex<Option<HashSet<&'static str>>> = Mutex::new(None);

struct Busy(&'static str);

impl Busy {
    fn claim(engine: Engine) -> Result<Busy> {
        let mut g = BUSY.lock().unwrap();
        if !g.get_or_insert_with(HashSet::new).insert(engine.id()) {
            anyhow::bail!("{} is already downloading", engine.name());
        }
        Ok(Busy(engine.id()))
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        if let Some(s) = BUSY.lock().unwrap().as_mut() {
            s.remove(self.0);
        }
    }
}

fn progress(window: &Window, engine: Engine, phase: &str, percent: u64) {
    let _ = window.emit(
        "engines:progress",
        serde_json::json!({ "id": engine.id(), "phase": phase, "percent": percent }),
    );
}

/// Downloads and unpacks `engine`, replacing an earlier download only once the new one is whole.
pub async fn install(window: &Window, engine: Engine) -> Result<PathBuf> {
    let _busy = Busy::claim(engine)?;
    let root = root()?;
    std::fs::create_dir_all(&root).with_context(|| format!("create {}", root.display()))?;
    let dir = root.join(engine.id());
    let staging = root.join(format!("{}.new", engine.id()));
    let _ = std::fs::remove_dir_all(&staging);

    let client = reqwest::Client::builder().user_agent("Octopus-Agent").build()?;
    let Source { url, kind, version } = source(&client, engine).await.context("find the download")?;
    let file = root.join(match kind {
        Kind::Zip => format!("{}.zip", engine.id()),
        Kind::Setup => format!("{}-setup.exe", engine.id()),
        Kind::TarXz => format!("{}.tar.xz", engine.id()),
        Kind::Dmg => format!("{}.dmg", engine.id()),
    });
    let fetched = fetch(&client, window, engine, &url, &file).await;
    if let Err(e) = fetched {
        let _ = std::fs::remove_file(&file);
        return Err(e.context("download"));
    }

    progress(window, engine, "extract", 100);
    let (f, s) = (file.clone(), staging.clone());
    let unpacked = tokio::task::spawn_blocking(move || unpack(kind, &f, &s)).await?;
    let _ = std::fs::remove_file(&file);
    if let Err(e) = unpacked {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e.context("unpack"));
    }
    let Some(exe) = inside(engine, &staging).into_iter().find(|p| p.is_file()) else {
        let _ = std::fs::remove_dir_all(&staging);
        anyhow::bail!("the {} download did not hold the browser where it was expected", engine.name());
    };
    if !version.is_empty() {
        let _ = std::fs::write(staging.join(VERSION_FILE), &version);
    }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&staging, &dir).with_context(|| format!("move into {}", dir.display()))?;
    Ok(dir.join(exe.strip_prefix(&staging).unwrap_or(&exe)))
}

async fn fetch(client: &reqwest::Client, window: &Window, engine: Engine, url: &str, to: &Path) -> Result<()> {
    let mut resp = client.get(url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    let mut out = tokio::fs::File::create(to).await?;
    let (mut received, mut last) = (0u64, u64::MAX);
    while let Some(chunk) = resp.chunk().await? {
        out.write_all(&chunk).await?;
        received += chunk.len() as u64;
        let pct = if total > 0 { received * 100 / total } else { 0 };
        if pct != last {
            last = pct;
            progress(window, engine, "download", pct);
        }
    }
    out.flush().await?;
    out.sync_all().await?;
    if total > 0 && received != total {
        anyhow::bail!("the download stopped at {received} of {total} bytes");
    }
    Ok(())
}

fn unpack(kind: Kind, file: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;
    match kind {
        Kind::Zip => crate::runtime::unzip(file, dest),
        Kind::Setup => run_setup(file, dest),
        Kind::TarXz => run("tar", &[&"-xJf".into(), &file.into(), &"-C".into(), &dest.into()]),
        Kind::Dmg => from_dmg(file, dest),
    }
}

#[cfg(target_os = "windows")]
fn run_setup(file: &Path, dest: &Path) -> Result<()> {
    use std::os::windows::process::CommandExt;
    // NSIS reads the option to the end of the line, spaces and all, and does not want it quoted.
    let status = std::process::Command::new(file)
        .raw_arg(format!("/ExtractDir={}", dest.display()))
        .creation_flags(0x08000000)
        .status()
        .context("run the Firefox installer")?;
    if !status.success() {
        anyhow::bail!("the Firefox installer could not unpack ({status})");
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn run_setup(_file: &Path, _dest: &Path) -> Result<()> {
    anyhow::bail!("an installer is only unpacked on Windows")
}

fn run(program: &str, args: &[&std::ffi::OsString]) -> Result<()> {
    let out = std::process::Command::new(program).args(args).output().with_context(|| format!("run {program}"))?;
    if !out.status.success() {
        anyhow::bail!("{program} failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// Copies Firefox.app out of the disk image and detaches it again.
fn from_dmg(file: &Path, dest: &Path) -> Result<()> {
    let mnt = dest.with_extension("mnt");
    let _ = std::fs::create_dir_all(&mnt);
    run("hdiutil", &[&"attach".into(), &"-nobrowse".into(), &"-readonly".into(), &"-mountpoint".into(), &mnt.clone().into(), &file.into()])?;
    let copied = run("cp", &[&"-R".into(), &mnt.join("Firefox.app").into(), &dest.into()]);
    let _ = run("hdiutil", &[&"detach".into(), &mnt.clone().into()]);
    let _ = std::fs::remove_dir(&mnt);
    copied
}
