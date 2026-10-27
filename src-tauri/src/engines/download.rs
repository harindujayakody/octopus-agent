//! Installs a stock engine into the launcher's own folder, apart from any copy
//! the computer has. Official builds only: Google Chrome Stable and Chromium
//! snapshots from Google, Firefox from Mozilla, and Brave, Thorium and Helium
//! from their GitHub releases.
//! Unpacked in place; nothing is installed system-wide, so no administrator
//! prompt. Each install notes its version beside it, so the Browsers page can
//! say when a newer one is out.

use super::Engine;
use anyhow::{Context, Result};
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom, Write};
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

/// Where each archive puts the executable. A path starting with `*/` is
/// looked for in each folder at the top (Helium names its folder by version).
fn inside(engine: Engine, dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for rel in places(engine) {
        if let Some(tail) = rel.strip_prefix("*/") {
            let subs = std::fs::read_dir(dir).into_iter().flatten().flatten().filter(|e| e.path().is_dir());
            out.extend(subs.map(|e| e.path().join(tail)));
        } else {
            out.push(dir.join(rel));
        }
    }
    out
}

fn places(engine: Engine) -> Vec<&'static str> {
    let rel: &[&str] = match engine {
        // Chrome Stable's own folder first; Chrome for Testing's (before 2.4.0) still starts until updated.
        #[cfg(target_os = "windows")]
        Engine::Chrome => &["Chrome-bin/chrome.exe", "chrome-win64/chrome.exe"],
        #[cfg(target_os = "windows")]
        Engine::Brave => &["brave.exe"],
        #[cfg(target_os = "windows")]
        Engine::Thorium => &["BIN/thorium.exe", "thorium.exe"],
        #[cfg(target_os = "windows")]
        Engine::Helium => &["*/chrome.exe", "chrome.exe"],
        #[cfg(target_os = "windows")]
        Engine::Chromium => &["chrome-win/chrome.exe"],
        #[cfg(target_os = "windows")]
        Engine::Firefox => &["firefox.exe", "core/firefox.exe"],
        #[cfg(target_os = "macos")]
        Engine::Chrome => &[
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ],
        #[cfg(target_os = "macos")]
        Engine::Brave => &["Brave Browser.app/Contents/MacOS/Brave Browser"],
        #[cfg(target_os = "macos")]
        Engine::Thorium => &["Thorium.app/Contents/MacOS/Thorium"],
        #[cfg(target_os = "macos")]
        Engine::Helium => &["Helium.app/Contents/MacOS/Helium"],
        #[cfg(target_os = "macos")]
        Engine::Chromium => &["chrome-mac/Chromium.app/Contents/MacOS/Chromium"],
        #[cfg(target_os = "macos")]
        Engine::Firefox => &["Firefox.app/Contents/MacOS/firefox"],
        #[cfg(target_os = "linux")]
        Engine::Chrome => &["opt/google/chrome/chrome", "chrome-linux64/chrome", "chrome-linux-arm64/chrome"],
        #[cfg(target_os = "linux")]
        Engine::Brave => &["brave", "brave-browser"],
        #[cfg(target_os = "linux")]
        Engine::Thorium => &["thorium", "*/thorium", "opt/chromium.org/thorium/thorium"],
        #[cfg(target_os = "linux")]
        Engine::Helium => &["*/chrome", "*/helium", "chrome"],
        #[cfg(target_os = "linux")]
        Engine::Chromium => &["chrome-linux/chrome"],
        #[cfg(target_os = "linux")]
        Engine::Firefox => &["firefox/firefox"],
        _ => &[],
    };
    rel.to_vec()
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
    /// A disk image holding the named `.app`.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Dmg(&'static str),
    /// Chrome's Windows installer: a 7z archive of `Chrome-bin` sits inside
    /// it, cut out and unpacked with Windows' own tar, never run.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    ChromeInstaller,
    /// A Debian package: its data archive holds the browser under `opt/`.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Deb,
}

const SNAPSHOTS: &str = "https://storage.googleapis.com/chromium-browser-snapshots";
const FIREFOX_VERSIONS: &str = "https://product-details.mozilla.org/1.0/firefox_versions.json";
/// Google's update service, which names the current Chrome Stable installer.
const OMAHA: &str = "https://tools.google.com/service/update2";
const CHROME_APP_ID: &str = "{8A69D345-D564-463C-AFF1-A69D9E530F96}";
/// Chrome's published versions per platform, newest first.
const VERSION_HISTORY: &str = "https://versionhistory.googleapis.com/v1/chrome/platforms";
const BRAVE_LATEST: &str = "https://api.github.com/repos/brave/brave-browser/releases/latest";
/// Thorium's builds: its own repositories have shipped none since M138, and
/// its release notes point to the collaborator who builds the current ones.
const THORIUM_LATEST: &str = "https://api.github.com/repos/gz83/thorium/releases/latest";
fn helium_latest() -> &'static str {
    if cfg!(target_os = "windows") {
        "https://api.github.com/repos/imputnet/helium-windows/releases/latest"
    } else if cfg!(target_os = "macos") {
        "https://api.github.com/repos/imputnet/helium-macos/releases/latest"
    } else {
        "https://api.github.com/repos/imputnet/helium-linux/releases/latest"
    }
}

/// The newest GitHub release: its version (the tag less a leading "v" or
/// "M") and the download address of the asset `pick` chooses by name.
async fn github_release(client: &reqwest::Client, api: &str, pick: impl Fn(&str, &str) -> bool) -> Result<(String, String)> {
    let v: serde_json::Value = client.get(api).send().await?.error_for_status()?.json().await?;
    let tag = v["tag_name"].as_str().context("no release was named")?;
    let version = tag.trim_start_matches(['v', 'M']).to_string();
    let url = v["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| Some((a["name"].as_str()?, a["browser_download_url"].as_str()?)))
        .find(|(name, _)| pick(name, &version))
        .map(|(_, url)| url.to_string())
        .context("the release has no build for this computer")?;
    Ok((version, url))
}

/// Thorium's build for this processor: the newest instruction set it has.
fn thorium_flavour() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            return "AVX2";
        }
        if std::arch::is_x86_feature_detected!("avx") {
            return "AVX";
        }
        if std::arch::is_x86_feature_detected!("sse4.1") {
            return "SSE4";
        }
        "SSE3"
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        "ARM64"
    }
}

/// What to fetch, and the version it is.
struct Source {
    url: String,
    kind: Kind,
    version: String,
    /// The server may send it gzipped (Chrome's installer: half the size on the wire).
    gzip: bool,
}

/// An attribute of the first `<tag …>` in `xml` (Omaha's answer is small and flat).
fn xml_attr(xml: &str, tag: &str, attr: &str) -> Option<String> {
    let start = xml.find(&format!("<{tag} "))?;
    let end = start + xml[start..].find('>')?;
    let head = &xml[start..end];
    let key = format!("{attr}=\"");
    let at = head.find(&key)? + key.len();
    Some(head[at..at + head[at..].find('"')?].to_string())
}

/// Chrome Stable's current Windows installer, as Google's updater is told it.
async fn chrome_windows(client: &reqwest::Client) -> Result<Source> {
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><request protocol="3.0" updater="Omaha" updaterversion="1.3.36.372" shell_version="1.3.36.372" ismachine="0" installsource="ondemand"><os platform="win" version="10.0" arch="{arch}"/><app appid="{CHROME_APP_ID}" version="" nextversion="" ap="{arch}-stable" lang="en" brand="GGLS" installage="-1"><updatecheck/></app></request>"#
    );
    let xml = client
        .post(OMAHA)
        .header("Content-Type", "application/xml")
        .body(body)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let version = xml_attr(&xml, "manifest", "version").context("Google named no Chrome version")?;
    let name = xml_attr(&xml, "package", "name").context("Google named no Chrome installer")?;
    // The https mirrors, Google's own host first.
    let mut bases: Vec<String> = Vec::new();
    let mut rest = xml.as_str();
    while let Some(i) = rest.find("codebase=\"") {
        rest = &rest[i + 10..];
        if let Some(j) = rest.find('"') {
            bases.push(rest[..j].to_string());
            rest = &rest[j..];
        }
    }
    let base = bases
        .iter()
        .find(|b| b.starts_with("https://dl.google.com/"))
        .or_else(|| bases.iter().find(|b| b.starts_with("https://")))
        .context("Google named no download address")?;
    Ok(Source { url: format!("{base}{name}"), kind: Kind::ChromeInstaller, version, gzip: true })
}

/// Chrome Stable's newest version for a platform of Google's version history.
async fn chrome_version(client: &reqwest::Client, platform: &str) -> Result<String> {
    let v: serde_json::Value = client
        .get(format!("{VERSION_HISTORY}/{platform}/channels/stable/versions"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(v["versions"][0]["version"].as_str().context("Google gave no Chrome version")?.to_string())
}

/// The archive to fetch for this computer, asked of the vendor each time.
async fn source(client: &reqwest::Client, engine: Engine) -> Result<Source> {
    let arm = cfg!(target_arch = "aarch64");
    let unsupported = || anyhow::anyhow!("{} has no download for this computer", engine.name());
    match engine {
        // Google Chrome Stable itself, as a person installs it, not Chrome for Testing.
        Engine::Chrome => {
            if cfg!(target_os = "windows") {
                chrome_windows(client).await
            } else if cfg!(target_os = "macos") {
                let version = chrome_version(client, "mac").await?;
                let url = "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg".to_string();
                Ok(Source { url, kind: Kind::Dmg("Google Chrome.app"), version, gzip: false })
            } else if !arm {
                let version = chrome_version(client, "linux").await?;
                let url = "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb".to_string();
                Ok(Source { url, kind: Kind::Deb, version, gzip: false })
            } else {
                Err(unsupported())
            }
        }
        // Brave's own release builds, as its GitHub releases publish them.
        Engine::Brave => {
            let v: serde_json::Value = client.get(BRAVE_LATEST).send().await?.error_for_status()?.json().await?;
            let tag = v["tag_name"].as_str().context("Brave named no release")?;
            let version = tag.trim_start_matches('v').to_string();
            let (asset, kind) = if cfg!(target_os = "windows") {
                (format!("brave-v{version}-win32-{}.zip", if arm { "arm64" } else { "x64" }), Kind::Zip)
            } else if cfg!(target_os = "macos") {
                (format!("brave-v{version}-darwin-{}.zip", if arm { "arm64" } else { "x64" }), Kind::Zip)
            } else {
                (format!("brave-browser-{version}-linux-{}.zip", if arm { "arm64" } else { "amd64" }), Kind::Zip)
            };
            let url = v["assets"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|a| a["name"] == asset.as_str())
                .and_then(|a| a["browser_download_url"].as_str())
                .ok_or_else(unsupported)?
                .to_string();
            Ok(Source { url, kind, version, gzip: false })
        }
        Engine::Thorium => {
            let flavour = thorium_flavour();
            let (version, url) = github_release(client, THORIUM_LATEST, |name, v| {
                if cfg!(target_os = "windows") {
                    name.eq_ignore_ascii_case(&format!("Thorium_{flavour}_{v}.zip"))
                } else if cfg!(target_os = "macos") {
                    name == if arm { "Thorium_MacOS_ARM64.dmg" } else { "Thorium_MacOS_x64.dmg" }
                } else {
                    name == format!("thorium-browser_{v}_{}.zip", if arm { "arm64" } else { flavour })
                }
            })
            .await?;
            let kind = if cfg!(target_os = "macos") { Kind::Dmg("Thorium.app") } else { Kind::Zip };
            Ok(Source { url, kind, version, gzip: false })
        }
        Engine::Helium => {
            let (version, url) = github_release(client, helium_latest(), |name, v| {
                if cfg!(target_os = "windows") {
                    name == format!("helium_{v}_{}-windows.zip", if arm { "arm64" } else { "x64" })
                } else if cfg!(target_os = "macos") {
                    name == format!("helium_{v}_{}-macos.dmg", if arm { "arm64" } else { "x86_64" })
                } else {
                    name == format!("helium-{v}-{}_linux.tar.xz", if arm { "arm64" } else { "x86_64" })
                }
            })
            .await?;
            let kind = if cfg!(target_os = "macos") {
                Kind::Dmg("Helium.app")
            } else if cfg!(target_os = "windows") {
                Kind::Zip
            } else {
                Kind::TarXz
            };
            Ok(Source { url, kind, version, gzip: false })
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
            Ok(Source { url: format!("{SNAPSHOTS}/{folder}/{rev}/{zip}"), kind: Kind::Zip, version: format!("r{rev}"), gzip: false })
        }
        Engine::Firefox => {
            let (os, kind) = if cfg!(target_os = "windows") {
                ("win64", Kind::Setup)
            } else if cfg!(target_os = "macos") {
                ("osx", Kind::Dmg("Firefox.app"))
            } else {
                (if arm { "linux64-aarch64" } else { "linux64" }, Kind::TarXz)
            };
            // The version first, then that exact build, so what is noted is what was fetched.
            let v: serde_json::Value = client.get(FIREFOX_VERSIONS).send().await?.error_for_status()?.json().await?;
            let version = v["LATEST_FIREFOX_VERSION"].as_str().context("Mozilla gave no Firefox version")?.to_string();
            let url = format!("https://download.mozilla.org/?product=firefox-{version}-ssl&os={os}&lang=en-US");
            Ok(Source { url, kind, version, gzip: false })
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
    let Source { url, kind, version, gzip } = source(&client, engine).await.context("find the download")?;
    let file = root.join(match kind {
        Kind::Zip => format!("{}.zip", engine.id()),
        Kind::Setup | Kind::ChromeInstaller => format!("{}-setup.exe", engine.id()),
        Kind::TarXz => format!("{}.tar.xz", engine.id()),
        Kind::Dmg(_) => format!("{}.dmg", engine.id()),
        Kind::Deb => format!("{}.deb", engine.id()),
    });
    let fetched = fetch(&client, window, engine, &url, &file, gzip).await;
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

async fn fetch(client: &reqwest::Client, window: &Window, engine: Engine, url: &str, to: &Path, gzip: bool) -> Result<()> {
    let mut req = client.get(url);
    if gzip {
        req = req.header("Accept-Encoding", "gzip");
    }
    let mut resp = req.send().await?.error_for_status()?;
    // Counted as it comes over the wire; a gzipped body is unpacked as it is written.
    let total = resp.content_length().unwrap_or(0);
    let zipped = resp
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("gzip"));
    if zipped {
        let mut out = flate2::write::GzDecoder::new(std::fs::File::create(to)?);
        let (mut received, mut last) = (0u64, u64::MAX);
        while let Some(chunk) = resp.chunk().await? {
            out.write_all(&chunk)?;
            received += chunk.len() as u64;
            let pct = if total > 0 { received * 100 / total } else { 0 };
            if pct != last {
                last = pct;
                progress(window, engine, "download", pct);
            }
        }
        out.finish()?.sync_all()?;
        if total > 0 && received != total {
            anyhow::bail!("the download stopped at {received} of {total} bytes");
        }
        return Ok(());
    }
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
        Kind::Dmg(app) => from_dmg(file, dest, app),
        Kind::ChromeInstaller => from_chrome_installer(file, dest),
        Kind::Deb => from_deb(file, dest),
    }
}

/// The 7z archive inside Chrome's Windows installer: its start header names
/// where the archive ends, so it is cut out whole and unpacked with the tar
/// Windows has had since 10 (libarchive reads 7z). The installer never runs.
fn from_chrome_installer(file: &Path, dest: &Path) -> Result<()> {
    const SIG: [u8; 6] = [b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C];
    let mut f = std::fs::File::open(file)?;
    let mut head = vec![0u8; 8 << 20];
    let n = f.read(&mut head)?;
    head.truncate(n);
    let at = head.windows(SIG.len()).position(|w| w == SIG).context("the Chrome installer holds no archive")?;
    let num = |o: usize| u64::from_le_bytes(head[at + o..at + o + 8].try_into().unwrap());
    let len = 32 + num(12) + num(20);
    let archive = dest.with_extension("7z");
    f.seek(SeekFrom::Start(at as u64))?;
    let mut out = std::fs::File::create(&archive)?;
    let copied = std::io::copy(&mut f.take(len), &mut out)?;
    drop(out);
    if copied != len {
        let _ = std::fs::remove_file(&archive);
        anyhow::bail!("the Chrome installer's archive is cut short");
    }
    let tar = std::env::var_os("SystemRoot")
        .map(|r| PathBuf::from(r).join("System32").join("tar.exe"))
        .filter(|p| p.is_file())
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "tar".into());
    let done = run(&tar, &[&"-xf".into(), &archive.clone().into(), &"-C".into(), &dest.into()]);
    let _ = std::fs::remove_file(&archive);
    done
}

/// A Debian package's data archive, unpacked: an `ar` file of named members.
fn from_deb(file: &Path, dest: &Path) -> Result<()> {
    let mut f = std::fs::File::open(file)?;
    let mut magic = [0u8; 8];
    f.read_exact(&mut magic)?;
    if &magic != b"!<arch>\n" {
        anyhow::bail!("the Chrome download is not a Debian package");
    }
    loop {
        let mut hdr = [0u8; 60];
        if f.read_exact(&mut hdr).is_err() {
            anyhow::bail!("the Chrome package holds no data archive");
        }
        let name = String::from_utf8_lossy(&hdr[..16]).trim().trim_end_matches('/').to_string();
        let size: u64 = String::from_utf8_lossy(&hdr[48..58]).trim().parse().context("a broken Debian package")?;
        if name.starts_with("data.tar") {
            let data = dest.with_extension(&name);
            let mut out = std::fs::File::create(&data)?;
            std::io::copy(&mut (&mut f).take(size), &mut out)?;
            drop(out);
            let done = run("tar", &[&"-xf".into(), &data.clone().into(), &"-C".into(), &dest.into()]);
            let _ = std::fs::remove_file(&data);
            return done;
        }
        f.seek(SeekFrom::Current((size + size % 2) as i64))?;
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

/// Copies the named `.app` out of the disk image and detaches it again.
fn from_dmg(file: &Path, dest: &Path, app: &str) -> Result<()> {
    let mnt = dest.with_extension("mnt");
    let _ = std::fs::create_dir_all(&mnt);
    run("hdiutil", &[&"attach".into(), &"-nobrowse".into(), &"-readonly".into(), &"-mountpoint".into(), &mnt.clone().into(), &file.into()])?;
    let copied = run("cp", &[&"-R".into(), &mnt.join(app).into(), &dest.into()]);
    let _ = run("hdiutil", &[&"detach".into(), &mnt.clone().into()]);
    let _ = std::fs::remove_dir(&mnt);
    copied
}
