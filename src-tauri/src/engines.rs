//! Browsers a profile can start in besides the Octopus Agent engine: stock
//! Chrome, Chromium and Firefox, installed by the launcher into its own folder
//! from the Browsers page in Settings. Copies installed on the computer are
//! never used.
//!
//! They get the profile's own data folder, its proxy and its WebRTC choice,
//! and nothing of the fingerprint: none of them reads `--fingerprint-profile`
//! or any `--shardx-*` switch. The editor says so next to the choice.

use crate::space::proxy::{ProxyEntry, ProxyKind};
use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

mod download;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    ShardX,
    Chrome,
    Chromium,
    Firefox,
    Brave,
    Thorium,
    Helium,
}

impl Engine {
    /// The browsers installed from the Browsers page.
    pub const STOCK: [Engine; 6] =
        [Engine::Chrome, Engine::Chromium, Engine::Firefox, Engine::Brave, Engine::Thorium, Engine::Helium];

    /// `_meta.engine` as written; absent or unknown is the ShardX engine.
    pub fn of(name: Option<&str>) -> Engine {
        match name.map(str::trim) {
            Some("chrome") => Engine::Chrome,
            Some("chromium") => Engine::Chromium,
            Some("firefox") => Engine::Firefox,
            Some("brave") => Engine::Brave,
            Some("thorium") => Engine::Thorium,
            Some("helium") => Engine::Helium,
            _ => Engine::ShardX,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Engine::ShardX => "shardx",
            Engine::Chrome => "chrome",
            Engine::Chromium => "chromium",
            Engine::Firefox => "firefox",
            Engine::Brave => "brave",
            Engine::Thorium => "thorium",
            Engine::Helium => "helium",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Engine::ShardX => "Octopus Agent",
            Engine::Chrome => "Google Chrome",
            Engine::Chromium => "Chromium",
            Engine::Firefox => "Firefox",
            Engine::Brave => "Brave",
            Engine::Thorium => "Thorium",
            Engine::Helium => "Helium",
        }
    }

    /// Takes Chromium's switches.
    pub fn chromium_family(self) -> bool {
        !matches!(self, Engine::Firefox)
    }

    /// The executable: only the copy the launcher installed (Settings >
    /// Browsers). A browser installed on the computer, or a path set by
    /// hand, is never started: what a profile runs is installed, updated and
    /// removed here, so its version is always the one the page shows.
    pub fn locate(self) -> Option<PathBuf> {
        download::downloaded(self)
    }
}

/// Where a stock engine keeps the profile's data: inside the profile's own
/// folder, so Trash, reset and sync carry it with the rest, and apart from
/// the ShardX engine's files, which a different browser must not open.
pub fn data_dir(udd: &Path, engine: Engine) -> PathBuf {
    udd.join("engines").join(engine.id())
}

/// What a plain start is made from.
pub struct Plain<'a> {
    pub dir: &'a Path,
    /// The windows' title, the profile's name (Chromium family's `--window-name`), "" for none.
    pub title: &'a str,
    /// The page to open at start (launch.rs `start_page`), put after every switch.
    pub start_url: Option<&'a str>,
    pub proxy: Option<&'a ProxyEntry>,
    /// The profile's `webrtc`: "block", "tcp_only" or "auto".
    pub webrtc: &'a str,
    pub extensions: &'a [PathBuf],
    pub cdp: bool,
    pub headless: bool,
    /// Settings' extra switches, already filtered for a team; Chromium family only.
    pub extra: Vec<String>,
}

/// Why a profile cannot start in `engine` as it is, before anything is written.
pub fn refusal(engine: Engine, plain: &Plain) -> Option<String> {
    let name = engine.name();
    if plain.proxy.is_some_and(|p| !p.username.is_empty() || !p.password.is_empty()) {
        return Some(format!(
            "{name} cannot sign in to a proxy given on its command line. Assign a proxy without \
             a username and password, or start this profile in the Octopus Agent engine."
        ));
    }
    if engine == Engine::Firefox && plain.cdp {
        return Some(
            "Firefox has no Chrome DevTools Protocol, so automation cannot drive it. \
             Start this profile in the Octopus Agent engine, Chrome or Chromium."
                .into(),
        );
    }
    None
}

/// The engine's command line. Firefox's proxy and WebRTC go in `user.js`
/// (`write_firefox_prefs`), since it takes neither as a switch.
pub fn command_line(engine: Engine, plain: &Plain) -> Vec<String> {
    let mut args = Vec::new();
    if engine == Engine::Firefox {
        args.push("-profile".into());
        args.push(plain.dir.display().to_string());
        args.push("-no-remote".into());
        args.push("-new-instance".into());
        // On Windows firefox.exe hands over to a second process and exits;
        // this keeps the one the launcher tracks alive while the window is open.
        args.push("-wait-for-browser".into());
        if plain.headless {
            args.push("-headless".into());
        }
        if let Some(url) = plain.start_url {
            args.push(url.to_string());
        }
        return args;
    }

    args.push(format!("--user-data-dir={}", plain.dir.display()));
    // The profile's name on its windows, so the taskbar thumbnail says which one it is.
    if !plain.title.is_empty() {
        args.push(format!("--window-name={}", plain.title));
    }
    args.push("--no-first-run".into());
    args.push("--no-default-browser-check".into());
    if !plain.extensions.is_empty() {
        let joined = plain.extensions.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(",");
        if engine == Engine::Chrome {
            // Branded Chrome no longer reads --load-extension (137+, any feature
            // switch): the launcher loads them over its debugging port instead
            // (launch.rs `load_over_cdp`).
            args.push("--enable-unsafe-extension-debugging".into());
            if !plain.cdp {
                args.push("--remote-debugging-port=0".into());
            }
        } else {
            args.push(format!("--load-extension={joined}"));
        }
    }
    if let Some(p) = plain.proxy {
        args.push(format!("--proxy-server={}", p.to_proxy_server_arg()));
    }
    // Without the ShardX engine's relay checks, any policy but "auto with no
    // proxy" keeps WebRTC from going around the proxy.
    if plain.webrtc != "auto" || plain.proxy.is_some() {
        args.push("--force-webrtc-ip-handling-policy=disable_non_proxied_udp".into());
    }
    if plain.cdp {
        args.push("--remote-debugging-port=0".into());
        args.push("--remote-allow-origins=*".into());
    }
    if plain.headless {
        args.push("--headless=new".into());
    }
    args.extend(plain.extra.iter().cloned());
    // The page to open at start, after every switch.
    if let Some(url) = plain.start_url {
        args.push(url.to_string());
    }
    args
}

/// Firefox's proxy and WebRTC, rewritten on every start so a changed proxy takes.
pub fn write_firefox_prefs(plain: &Plain) -> Result<()> {
    let mut prefs: Vec<(String, String)> = vec![
        ("browser.shell.checkDefaultBrowser".into(), "false".into()),
        ("browser.aboutwelcome.enabled".into(), "false".into()),
        ("datareporting.policy.dataSubmissionPolicyBypassNotification".into(), "true".into()),
        ("toolkit.telemetry.reportingpolicy.firstRun".into(), "false".into()),
        // The library's add-ons sit in the profile's own folder (firefox_addons.rs):
        // that scope on, and nothing in it waits for a click to be enabled.
        ("extensions.enabledScopes".into(), "15".into()),
        ("extensions.autoDisableScopes".into(), "0".into()),
    ];
    let q = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into());
    match plain.proxy {
        None => prefs.push(("network.proxy.type".into(), "0".into())),
        Some(p) => match p.kind {
            ProxyKind::Socks5 => {
                prefs.push(("network.proxy.type".into(), "1".into()));
                prefs.push(("network.proxy.socks".into(), q(&p.host)));
                prefs.push(("network.proxy.socks_port".into(), p.port.to_string()));
                prefs.push(("network.proxy.socks_version".into(), "5".into()));
                prefs.push(("network.proxy.socks_remote_dns".into(), "true".into()));
            }
            ProxyKind::Http => {
                prefs.push(("network.proxy.type".into(), "1".into()));
                prefs.push(("network.proxy.share_proxy_settings".into(), "true".into()));
                for k in ["http", "ssl"] {
                    prefs.push((format!("network.proxy.{k}"), q(&p.host)));
                    prefs.push((format!("network.proxy.{k}_port"), p.port.to_string()));
                }
            }
            // A TLS connection to the proxy itself has no pref, only a PAC "HTTPS" line.
            ProxyKind::Https => {
                let pac = plain.dir.join("proxy.pac");
                std::fs::write(
                    &pac,
                    format!("function FindProxyForURL(url, host) {{ return \"HTTPS {}:{}\"; }}\n", p.host, p.port),
                )
                .context("write proxy.pac")?;
                let url = url_of(&pac);
                prefs.push(("network.proxy.type".into(), "2".into()));
                prefs.push(("network.proxy.autoconfig_url".into(), q(&url)));
            }
        },
    }
    if plain.proxy.is_some() {
        prefs.push(("network.proxy.no_proxies_on".into(), q("")));
        prefs.push(("network.proxy.allow_hijacking_localhost".into(), "true".into()));
    }
    match plain.webrtc {
        "block" => prefs.push(("media.peerconnection.enabled".into(), "false".into())),
        _ if plain.webrtc != "auto" || plain.proxy.is_some() => {
            prefs.push(("media.peerconnection.ice.default_address_only".into(), "true".into()));
            prefs.push(("media.peerconnection.ice.no_host".into(), "true".into()));
            prefs.push(("media.peerconnection.ice.proxy_only_if_behind_proxy".into(), "true".into()));
        }
        _ => {}
    }
    let body: String = prefs.iter().map(|(k, v)| format!("user_pref({}, {v});\n", q(k))).collect();
    std::fs::write(plain.dir.join("user.js"), body).context("write user.js")
}

fn url_of(path: &Path) -> String {
    let s = path.display().to_string().replace('\\', "/");
    if s.starts_with('/') { format!("file://{s}") } else { format!("file:///{s}") }
}

#[derive(Serialize)]
pub struct Found {
    pub id: &'static str,
    pub name: &'static str,
    /// The executable a profile starts, wherever it is.
    pub path: Option<String>,
    /// The launcher installed it (Browsers page): it can update and remove it.
    pub managed: bool,
    /// The installed version, when the launcher installed it.
    pub version: Option<String>,
}

fn found(e: Engine) -> Found {
    let path = e.locate();
    let own = download::downloaded(e);
    let managed = path.is_some() && path == own;
    Found {
        id: e.id(),
        name: e.name(),
        path: path.map(|p| p.display().to_string()),
        managed,
        version: if managed { download::installed_version(e) } else { None },
    }
}

/// Which stock engines this computer has, for the editor's engine choice and the Browsers page.
#[tauri::command]
pub fn engines_detect() -> Vec<Found> {
    Engine::STOCK.iter().map(|&e| found(e)).collect()
}

fn stock(id: &str) -> Result<Engine, String> {
    let engine = Engine::of(Some(id));
    if engine == Engine::ShardX {
        return Err(format!("{id} is not a browser that can be installed here"));
    }
    Ok(engine)
}

/// The newest version the vendor publishes, for the update check.
#[tauri::command]
pub async fn engines_latest(id: String) -> Result<String, String> {
    let engine = stock(&id)?;
    download::latest(engine)
        .await
        .map_err(|e| format!("Could not check {} for updates: {e:#}", engine.name()))
}

/// Removes the launcher's own copy of `id`; a copy installed elsewhere stays.
#[tauri::command]
pub async fn engines_remove(id: String) -> Result<Found, String> {
    let engine = stock(&id)?;
    tokio::task::spawn_blocking(move || download::remove(engine))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not remove {}: {e:#}", engine.name()))?;
    Ok(found(engine))
}

/// Downloads `id` into the launcher's folder, reporting `engines:progress`.
#[tauri::command]
pub async fn engines_install(window: tauri::Window, id: String) -> Result<Found, String> {
    let engine = stock(&id)?;
    download::install(&window, engine).await.map_err(|e| {
        format!("Could not download {}: {e:#}. Check the internet connection and try again.", engine.name())
    })?;
    Ok(found(engine))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(kind: ProxyKind, user: &str) -> ProxyEntry {
        serde_json::from_value(serde_json::json!({
            "id": "x", "name": "x", "kind": match kind { ProxyKind::Socks5 => "socks5", ProxyKind::Http => "http", ProxyKind::Https => "https" },
            "host": "10.0.0.1", "port": 1080, "username": user, "password": ""
        }))
        .unwrap()
    }

    fn plain<'a>(dir: &'a Path, p: Option<&'a ProxyEntry>, cdp: bool) -> Plain<'a> {
        Plain { dir, title: "", start_url: None, proxy: p, webrtc: "auto", extensions: &[], cdp, headless: false, extra: Vec::new() }
    }

    #[test]
    fn absent_or_unknown_is_the_shardx_engine() {
        assert_eq!(Engine::of(None), Engine::ShardX);
        assert_eq!(Engine::of(Some("netscape")), Engine::ShardX);
        assert_eq!(Engine::of(Some("firefox")), Engine::Firefox);
    }

    #[test]
    fn a_proxy_with_a_login_and_firefox_automation_are_refused() {
        let dir = Path::new("d");
        let login = proxy(ProxyKind::Http, "me");
        assert!(refusal(Engine::Chrome, &plain(dir, Some(&login), false)).is_some());
        let open = proxy(ProxyKind::Http, "");
        assert!(refusal(Engine::Chrome, &plain(dir, Some(&open), true)).is_none());
        assert!(refusal(Engine::Firefox, &plain(dir, None, true)).is_some());
    }

    #[test]
    fn chrome_gets_its_own_folder_and_the_proxy_and_no_fingerprint() {
        let dir = Path::new("d");
        let p = proxy(ProxyKind::Socks5, "");
        let args = command_line(Engine::Chrome, &plain(dir, Some(&p), false));
        assert!(args.contains(&"--user-data-dir=d".to_string()), "{args:?}");
        assert!(args.contains(&"--proxy-server=socks5://10.0.0.1:1080".to_string()), "{args:?}");
        assert!(args.iter().any(|a| a.starts_with("--force-webrtc-ip-handling-policy")), "{args:?}");
        assert!(!args.iter().any(|a| a.contains("fingerprint") || a.contains("shardx")), "{args:?}");
    }

    #[test]
    fn firefox_takes_its_proxy_from_user_js() {
        let dir = std::env::temp_dir().join(format!("shardx-ff-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = proxy(ProxyKind::Socks5, "");
        let pl = plain(&dir, Some(&p), false);
        assert!(command_line(Engine::Firefox, &pl).contains(&"-no-remote".to_string()));
        write_firefox_prefs(&pl).unwrap();
        let js = std::fs::read_to_string(dir.join("user.js")).unwrap();
        assert!(js.contains("user_pref(\"network.proxy.socks\", \"10.0.0.1\");"), "{js}");
        assert!(js.contains("user_pref(\"network.proxy.socks_remote_dns\", true);"), "{js}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
