//! Firefox add-ons: a library of their own beside the Chrome extensions, since
//! Firefox reads neither a Chrome extension nor `--load-extension`. Each add-on
//! is a signed .xpi from addons.mozilla.org; every Firefox profile gets all of
//! them in its `extensions` folder when it starts, and each is pinned on the
//! toolbar once.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};

/// One add-on of the library, as the Extensions page lists it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Addon {
    /// Its Gecko id ("uBlock0@raymondhill.net"); the file is `<id>.xpi`.
    pub id: String,
    pub name: String,
    pub version: String,
    /// The addons.mozilla.org page it came from, "" for a file.
    #[serde(default)]
    pub source: String,
    pub added_at: i64,
}

const INDEX: &str = "index.json";
/// Add-ons this launcher put in a profile, one id per line: the ones it may take out again.
const PLACED: &str = ".octopus-addons";
/// Add-ons already pinned in a profile, so one the person unpins stays unpinned.
const PINNED: &str = ".octopus-addons-pinned";

fn dir() -> Result<PathBuf> {
    let d = crate::store::data_root()?.join("firefox-addons");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn read_index(d: &Path) -> Vec<Addon> {
    std::fs::read(d.join(INDEX)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_index(d: &Path, list: &[Addon]) -> Result<()> {
    std::fs::write(d.join(INDEX), serde_json::to_vec_pretty(list)?)?;
    Ok(())
}

/// A Gecko id is a file name here: an email-like id or a {uuid}, nothing that walks out.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && !id.contains("..")
        && id.chars().all(|c| c.is_ascii_alphanumeric() || "@._-{}+".contains(c))
}

pub fn list() -> Result<Vec<Addon>> {
    let d = dir()?;
    let mut l: Vec<Addon> = read_index(&d).into_iter().filter(|a| d.join(format!("{}.xpi", a.id)).is_file()).collect();
    l.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(l)
}

/// The id, name and version inside an .xpi's manifest.json.
fn read_xpi(bytes: &[u8]) -> Result<(Option<String>, String, String)> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).context("not an .xpi (zip) file")?;
    let mut text = String::new();
    zip.by_name("manifest.json").context("the .xpi has no manifest.json")?.read_to_string(&mut text)?;
    let m: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).context("its manifest.json does not read")?;
    let gecko = m.get("browser_specific_settings").or_else(|| m.get("applications")).and_then(|v| v.get("gecko"));
    let id = gecko.and_then(|g| g.get("id")).and_then(|v| v.as_str()).map(str::to_owned);
    let name = m.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let version = m.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !zip.file_names().any(|n| n.starts_with("META-INF/")) {
        bail!("this .xpi is not signed by Mozilla, and Firefox only loads signed add-ons. Add it from its addons.mozilla.org page instead.");
    }
    Ok((id, name, version))
}

fn keep(id: &str, name: String, version: String, source: String, bytes: &[u8]) -> Result<Addon> {
    if !valid_id(id) {
        bail!("the add-on's id \"{id}\" cannot be used");
    }
    let d = dir()?;
    let tmp = d.join(format!("{id}.xpi.part"));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, d.join(format!("{id}.xpi")))?;
    let mut idx = read_index(&d);
    idx.retain(|a| a.id != id);
    let a = Addon { id: id.to_string(), name, version, source, added_at: now() };
    idx.push(a.clone());
    write_index(&d, &idx)?;
    Ok(a)
}

/// An .xpi from disk: it must name its Gecko id, as one from addons.mozilla.org does.
pub fn import_file(path: &Path) -> Result<Addon> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let (id, name, version) = read_xpi(&bytes)?;
    let Some(id) = id else {
        bail!("this .xpi does not name its add-on id. Add it from its addons.mozilla.org page instead.");
    };
    keep(&id, name, version, String::new(), &bytes)
}

/// The add-on's slug or id in an addons.mozilla.org link, or the text itself when it is one.
fn amo_slug(raw: &str) -> Option<String> {
    let s = raw.trim().trim_end_matches('/');
    if let Some(rest) = s.split("addons.mozilla.org/").nth(1) {
        let parts: Vec<&str> = rest.split('/').collect();
        let at = parts.iter().position(|p| *p == "addon")?;
        return parts.get(at + 1).map(|p| p.split(['?', '#']).next().unwrap_or("").to_string()).filter(|p| !p.is_empty());
    }
    (!s.contains('/') && !s.contains(' ') && !s.is_empty()).then(|| s.to_string())
}

/// From an addons.mozilla.org link (or slug): its current signed file.
pub async fn import_amo(raw: &str) -> Result<Addon> {
    let Some(slug) = amo_slug(raw) else {
        bail!("that is not an addons.mozilla.org add-on link");
    };
    let client = reqwest::Client::builder().user_agent("Octopus-Agent").build()?;
    if !slug.chars().all(|c| c.is_ascii_alphanumeric() || "@._-{}".contains(c)) {
        bail!("that is not an addons.mozilla.org add-on link");
    }
    let api = format!("https://addons.mozilla.org/api/v5/addons/addon/{}/", slug.replace('{', "%7B").replace('}', "%7D"));
    let info: serde_json::Value = client.get(&api).send().await?.error_for_status().context("addons.mozilla.org does not know that add-on")?.json().await?;
    let id = info.get("guid").and_then(|v| v.as_str()).context("addons.mozilla.org gave no add-on id")?.to_string();
    let name = match info.get("name") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Object(m)) => m
            .get("en-US")
            .or_else(|| m.values().next())
            .and_then(|v| v.as_str())
            .unwrap_or(&slug)
            .to_string(),
        _ => slug.clone(),
    };
    let ver = info.get("current_version").context("the add-on has no released version")?;
    let version = ver.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let url = ver.get("file").and_then(|f| f.get("url")).and_then(|v| v.as_str()).context("the add-on has no file to download")?;
    if !url.starts_with("https://addons.mozilla.org/") {
        bail!("the add-on's file is not on addons.mozilla.org");
    }
    let bytes = client.get(url).send().await?.error_for_status()?.bytes().await?;
    read_xpi(&bytes)?;
    keep(&id, name, version, format!("https://addons.mozilla.org/firefox/addon/{slug}/"), &bytes)
}

pub fn delete(id: &str) -> Result<()> {
    if !valid_id(id) {
        bail!("invalid add-on id");
    }
    let d = dir()?;
    let _ = std::fs::remove_file(d.join(format!("{id}.xpi")));
    let mut idx = read_index(&d);
    idx.retain(|a| a.id != id);
    write_index(&d, &idx)
}

fn read_lines(p: &Path) -> BTreeSet<String> {
    std::fs::read_to_string(p)
        .map(|t| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect())
        .unwrap_or_default()
}

fn write_lines(p: &Path, ids: &BTreeSet<String>) {
    let _ = std::fs::write(p, ids.iter().cloned().collect::<Vec<_>>().join("\n") + "\n");
}

/// Before a Firefox profile at `profile` starts: every library add-on copied
/// into its `extensions` folder, one taken out of the library taken out of it
/// (only those this launcher put there), and new ones pinned.
pub fn install_into(profile: &Path) {
    let lib = match dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[addons] library not read: {e:#}");
            return;
        }
    };
    let ids: BTreeSet<String> = list().unwrap_or_default().into_iter().map(|a| a.id).collect();
    let ext = profile.join("extensions");
    let placed = read_lines(&profile.join(PLACED));
    if ids.is_empty() && placed.is_empty() {
        return;
    }
    let _ = std::fs::create_dir_all(&ext);
    for id in &ids {
        let from = lib.join(format!("{id}.xpi"));
        let to = ext.join(format!("{id}.xpi"));
        let same = std::fs::metadata(&to).ok().map(|m| m.len()) == std::fs::metadata(&from).ok().map(|m| m.len());
        if !same {
            if let Err(e) = std::fs::copy(&from, &to) {
                eprintln!("[addons] {id} not installed: {e}");
            }
        }
    }
    for gone in placed.difference(&ids) {
        let _ = std::fs::remove_file(ext.join(format!("{gone}.xpi")));
    }
    write_lines(&profile.join(PLACED), &ids);
    pin_new(profile, &ids);
}

/// The toolbar widget Firefox makes for an add-on's button.
fn widget_id(id: &str) -> String {
    let s: String = id.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    format!("{s}-browser-action")
}

/// Puts the add-ons' buttons on the toolbar in prefs.js, once each. Firefox
/// writes its toolbar layout on its first start, so an add-on is pinned from
/// the start after that; until then its button sits in the puzzle menu.
fn pin_new(profile: &Path, ids: &BTreeSet<String>) {
    let done = read_lines(&profile.join(PINNED));
    let new: Vec<&String> = ids.iter().filter(|id| !done.contains(*id)).collect();
    if new.is_empty() {
        return;
    }
    let prefs = profile.join("prefs.js");
    let Ok(text) = std::fs::read_to_string(&prefs) else { return };
    const KEY: &str = "user_pref(\"browser.uiCustomization.state\", ";
    let Some(line) = text.lines().find(|l| l.starts_with(KEY)) else { return };
    let literal = line[KEY.len()..].trim_end().trim_end_matches(';').trim_end().trim_end_matches(')');
    let Ok(raw) = serde_json::from_str::<String>(literal) else { return };
    let Ok(mut state) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
    let Some(placements) = state.get_mut("placements").and_then(|p| p.as_object_mut()) else { return };
    let mut pinned = Vec::new();
    for id in &new {
        let w = widget_id(id);
        if let Some(area) = placements.get_mut("unified-extensions-area").and_then(|a| a.as_array_mut()) {
            area.retain(|v| v.as_str() != Some(&w));
        }
        let Some(nav) = placements.get_mut("nav-bar").and_then(|a| a.as_array_mut()) else { return };
        if !nav.iter().any(|v| v.as_str() == Some(&w)) {
            let at = nav.iter().position(|v| v.as_str() == Some("unified-extensions-button")).unwrap_or(nav.len());
            nav.insert(at, serde_json::Value::String(w));
        }
        pinned.push((*id).clone());
    }
    let Ok(json) = serde_json::to_string(&state) else { return };
    let Ok(lit) = serde_json::to_string(&json) else { return };
    let out: String = text
        .lines()
        .map(|l| if l.starts_with(KEY) { format!("{KEY}{lit});") } else { l.to_string() })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    if std::fs::write(&prefs, out).is_ok() {
        let all: BTreeSet<String> = done.into_iter().chain(pinned).collect();
        write_lines(&profile.join(PINNED), &all);
    }
}

#[tauri::command]
pub async fn firefox_addon_list() -> Result<Vec<Addon>, String> {
    tokio::task::spawn_blocking(list).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn firefox_addon_import_url(url: String) -> Result<Addon, String> {
    import_amo(&url).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn firefox_addon_import_file(path: String) -> Result<Addon, String> {
    tokio::task::spawn_blocking(move || import_file(Path::new(&path))).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn firefox_addon_delete(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || delete(&id)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_amo_link() {
        assert_eq!(amo_slug("https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/").as_deref(), Some("ublock-origin"));
        assert_eq!(amo_slug("https://addons.mozilla.org/firefox/addon/dark-reader/?src=search").as_deref(), Some("dark-reader"));
        assert_eq!(amo_slug("ublock-origin").as_deref(), Some("ublock-origin"));
        assert_eq!(amo_slug("https://example.com/x"), None);
    }

    #[test]
    fn a_widget_id_is_firefox_own() {
        assert_eq!(widget_id("uBlock0@raymondhill.net"), "ublock0_raymondhill_net-browser-action");
        assert_eq!(widget_id("{446900e4-71c2-419f-a6a7-df9c091e268b}"), "_446900e4-71c2-419f-a6a7-df9c091e268b_-browser-action");
    }

    #[test]
    fn ids_cannot_walk_out() {
        assert!(valid_id("uBlock0@raymondhill.net"));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
    }
}
