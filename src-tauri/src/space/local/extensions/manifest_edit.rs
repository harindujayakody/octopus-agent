//! A new tree measured against the live one: the `key` that keeps its id,
//! the access it gains, and how much of it is the same extension.

use super::chrome_id::decode_key;
use anyhow::{bail, Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// manifest.json as Chrome reads it: a BOM and comments allowed.
pub fn read_manifest(root: &Path) -> Result<Value> {
    let v = read_json(&root.join("manifest.json"))?;
    v.is_object().then_some(v).context("manifest.json is not an object")
}

/// A JSON file of an extension as Chrome reads it: a BOM and comments allowed.
pub fn read_json(path: &Path) -> Result<Value> {
    let text = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&strip_comments(text.trim_start_matches('\u{feff}')))
        .with_context(|| format!("{} is not readable JSON", path.display()))
}

/// `//` and `/* */` comments outside strings blanked byte for byte, so offsets hold.
fn strip_comments(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = b.to_vec();
    let (mut i, mut in_str) = (0, false);
    while i < b.len() {
        if in_str {
            match b[i] {
                b'\\' => i += 1,
                b'"' => in_str = false,
                _ => {}
            }
            i += 1;
            continue;
        }
        match (b[i], b.get(i + 1)) {
            (b'"', _) => in_str = true,
            (b'/', Some(b'/')) => {
                let end = b[i..].iter().position(|&c| c == b'\n').map_or(b.len(), |n| i + n);
                out[i..end].fill(b' ');
                i = end;
                continue;
            }
            (b'/', Some(b'*')) => {
                let end = b[i + 2..].windows(2).position(|w| w == b"*/").map_or(b.len(), |n| i + 2 + n + 2);
                out[i..end].fill(b' ');
                i = end;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    // Comments start and end on ASCII, so whole characters were blanked.
    String::from_utf8(out).unwrap_or_default()
}

/// What Chrome derives the id from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdBasis {
    /// The manifest's `key`, as DER.
    Key(Vec<u8>),
    /// The folder's path.
    Path,
}

pub fn id_basis(root: &Path) -> Result<IdBasis> {
    match read_manifest(root)?.get("key") {
        None => Ok(IdBasis::Path),
        Some(k) => k.as_str().and_then(decode_key).map(IdBasis::Key).context("manifest.json has an unreadable key"),
    }
}

/// What `fit_manifest` did to the new manifest's `key` (`staged.json`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyAction {
    None,
    Kept,
    Inserted,
    Removed,
}

/// Makes the new tree's `key` give the id the live one has (design §3.3.2).
/// Only whoever builds the tree runs this; a receiver compares `id_basis`.
pub fn fit_manifest(new_root: &Path, old: &IdBasis) -> Result<KeyAction> {
    match (old, id_basis(new_root)?) {
        (IdBasis::Path, IdBasis::Path) => Ok(KeyAction::None),
        (IdBasis::Key(k), IdBasis::Key(n)) if *k == n => Ok(KeyAction::Kept),
        (IdBasis::Key(_), IdBasis::Key(_)) => bail!("the new version is signed with another key: a different extension"),
        (IdBasis::Key(k), IdBasis::Path) => insert_key(new_root, k).map(|_| KeyAction::Inserted),
        (IdBasis::Path, IdBasis::Key(_)) => remove_key(new_root).map(|_| KeyAction::Removed),
    }
}

/// `"key"` written as text right after the opening brace, the rest left as shipped.
pub fn insert_key(root: &Path, der: &[u8]) -> Result<()> {
    let path = root.join("manifest.json");
    let text = fs::read_to_string(&path)?;
    let plain = strip_comments(&text);
    let open = plain.find('{').context("manifest.json has no object")?;
    if plain[open + 1..].trim_start().starts_with('}') {
        bail!("manifest.json is empty");
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(der);
    let at = open + 1;
    fs::write(&path, format!("{}\n  \"key\": \"{b64}\",{}", &text[..at], &text[at..]))?;
    Ok(())
}

/// The signer's key as Chrome installs a store package: one there that is
/// another key, or unreadable, is replaced, as Chrome's unpacker does.
pub fn set_key(root: &Path, der: &[u8]) -> Result<()> {
    match id_basis(root) {
        Ok(IdBasis::Key(k)) if k == der => Ok(()),
        Ok(IdBasis::Path) => insert_key(root, der),
        _ => {
            remove_key(root)?;
            insert_key(root, der)
        }
    }
}

/// `"key"` taken out; only a plain-JSON manifest can be rewritten safely.
pub fn remove_key(root: &Path) -> Result<()> {
    let path = root.join("manifest.json");
    let text = fs::read_to_string(&path)?;
    let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) else {
        bail!("manifest.json is not plain JSON, so its key cannot be removed safely");
    };
    let kept: serde_json::Map<String, Value> = obj.into_iter().filter(|(k, _)| k != "key").collect();
    fs::write(&path, serde_json::to_string_pretty(&Value::Object(kept))? + "\n")?;
    Ok(())
}

/// One kind of access a new version gains.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantKind {
    /// An API permission (`tabs`, `debugger`...).
    Permission,
    /// A site from `permissions` or `host_permissions`.
    Host,
    /// A site its content scripts run on.
    ScriptHost,
    /// A site whose own page context it runs in (`world: "MAIN"`).
    MainWorld,
    /// A site that may message it (`externally_connectable`).
    Connectable,
    /// A site that may load its files (`web_accessible_resources`).
    WebResource,
    /// `manifest_version` changed; the value is the new one.
    ManifestVersion,
    /// A browser setting or page it takes over: one of [`OVERRIDES`].
    Override,
}

/// What an extension may take over without a permission, by manifest key.
/// The settings count when they change; the pages and the rest when they appear.
pub const OVERRIDES: [&str; 8] = [
    "chrome_settings_overrides.search_provider",
    "chrome_settings_overrides.homepage",
    "chrome_settings_overrides.startup_pages",
    "chrome_url_overrides.newtab",
    "chrome_url_overrides.bookmarks",
    "chrome_url_overrides.history",
    "devtools_page",
    "omnibox",
];

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Grant {
    pub kind: GrantKind,
    pub value: String,
}

/// What `new` may do that `old` could not (design §3.3.3 p.7). Chrome grants
/// it silently for command-line extensions, so the person must see it.
pub fn perm_growth(old: &Value, new: &Value) -> Vec<Grant> {
    let (o, n) = (Access::of(old), Access::of(new));
    let mut out = BTreeSet::new();
    let mut add = |kind: GrantKind, olds: &BTreeSet<String>, news: &BTreeSet<String>, sites: bool| {
        for v in news.difference(olds) {
            if !sites || !olds.iter().any(|old| covers(old, v)) {
                out.insert(Grant { kind: kind.clone(), value: v.clone() });
            }
        }
    };
    add(GrantKind::Permission, &o.apis, &n.apis, false);
    add(GrantKind::Host, &o.hosts, &n.hosts, true);
    add(GrantKind::ScriptHost, &o.scripts, &n.scripts, true);
    add(GrantKind::MainWorld, &o.main_world, &n.main_world, true);
    add(GrantKind::Connectable, &o.connectable, &n.connectable, true);
    add(GrantKind::WebResource, &o.resources, &n.resources, true);
    let mv = |m: &Value| m.get("manifest_version").map(|v| v.to_string()).unwrap_or_default();
    if mv(old) != mv(new) {
        out.insert(Grant { kind: GrantKind::ManifestVersion, value: mv(new) });
    }
    for key in OVERRIDES {
        let at = |m: &Value| key.split('.').try_fold(m, |v, k| v.get(k)).filter(|v| !v.is_null()).cloned();
        let (was, now) = (at(old), at(new));
        let settings = key.starts_with("chrome_settings_overrides.");
        if now.is_some() && (was.is_none() || (settings && was != now)) {
            out.insert(Grant { kind: GrantKind::Override, value: key.to_string() });
        }
    }
    out.into_iter().collect()
}

#[derive(Default)]
struct Access {
    apis: BTreeSet<String>,
    hosts: BTreeSet<String>,
    scripts: BTreeSet<String>,
    main_world: BTreeSet<String>,
    connectable: BTreeSet<String>,
    resources: BTreeSet<String>,
}

impl Access {
    fn of(m: &Value) -> Access {
        let strings = |v: Option<&Value>| -> Vec<String> {
            v.and_then(Value::as_array)
                .map(|a| a.iter().map(|x| x.as_str().map_or_else(|| x.to_string(), str::to_string)).collect())
                .unwrap_or_default()
        };
        let mut a = Access::default();
        // MV2 keeps sites among the permissions.
        for p in strings(m.get("permissions")) {
            if is_site(&p) {
                a.hosts.insert(p);
            } else {
                a.apis.insert(p);
            }
        }
        a.hosts.extend(strings(m.get("host_permissions")));
        for cs in m.get("content_scripts").and_then(Value::as_array).into_iter().flatten() {
            let matches = strings(cs.get("matches"));
            if cs.get("world").and_then(Value::as_str) == Some("MAIN") {
                a.main_world.extend(matches.iter().cloned());
            }
            a.scripts.extend(matches);
        }
        let ec = m.get("externally_connectable");
        a.connectable.extend(strings(ec.and_then(|e| e.get("matches"))));
        // Other extensions that may message it, "*" for any.
        a.connectable.extend(strings(ec.and_then(|e| e.get("ids"))).into_iter().map(|i| format!("extension:{i}")));
        for war in m.get("web_accessible_resources").and_then(Value::as_array).into_iter().flatten() {
            match war {
                // MV2: a listed file is open to every site.
                Value::String(_) => {
                    a.resources.insert("<all_urls>".into());
                }
                _ => a.resources.extend(strings(war.get("matches"))),
            }
        }
        a
    }
}

fn is_site(p: &str) -> bool {
    p == "<all_urls>" || p.contains("://")
}

/// Whether access to `old` already includes `new`.
fn covers(old: &str, new: &str) -> bool {
    match old {
        "<all_urls>" => !new.starts_with("extension:"),
        "*://*/*" => ["http://", "https://", "*://"].iter().any(|s| new.starts_with(s)),
        "https://*/*" => new.starts_with("https://"),
        "http://*/*" => new.starts_with("http://"),
        "extension:*" => new.starts_with("extension:"),
        _ => old == new,
    }
}

/// Share of the live tree's files (bar manifest.json, `_metadata/`, `.added`)
/// found in the new tree at the same path with the same bytes.
pub fn overlap(old_root: &Path, new_root: &Path) -> Result<f64> {
    let mut files = Vec::new();
    walk(old_root, PathBuf::new(), &mut files)?;
    files.retain(|rel| {
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        !(rel.as_os_str() == "manifest.json" || rel.as_os_str() == ".added" || top == "_metadata")
    });
    if files.is_empty() {
        return Ok(0.0);
    }
    let digest = |p: &Path| fs::read(p).ok().map(Sha256::digest);
    let same = files
        .iter()
        .filter(|rel| {
            let new = new_root.join(rel);
            new.is_file() && digest(&new).is_some_and(|d| Some(d) == digest(&old_root.join(rel)))
        })
        .count();
    Ok(same as f64 / files.len() as f64)
}

fn walk(root: &Path, rel: PathBuf, out: &mut Vec<PathBuf>) -> Result<()> {
    for e in fs::read_dir(root.join(&rel)).with_context(|| format!("read {}", root.join(&rel).display()))? {
        let e = e?;
        if crate::store::is_os_litter(&e.file_name()) {
            continue;
        }
        let t = e.file_type()?;
        let child = rel.join(e.file_name());
        if t.is_dir() {
            walk(root, child, out)?;
        } else if t.is_file() {
            out.push(child);
        }
    }
    Ok(())
}

/// The name the extension shows, `__MSG_*__` resolved; None if it cannot be.
pub fn display_name(root: &Path) -> Option<String> {
    let m = read_manifest(root).ok()?;
    let raw = m.get("name")?.as_str()?;
    let name = match raw.strip_prefix("__MSG_").and_then(|r| r.strip_suffix("__")) {
        None => raw.to_string(),
        // Chrome looks message names up ignoring case.
        Some(key) => {
            let msgs = super::locale_messages(root, &m);
            let found = msgs.as_object()?.iter().find(|(k, _)| k.eq_ignore_ascii_case(key))?;
            found.1.get("message")?.as_str()?.to_string()
        }
    };
    let name = name.trim().to_string();
    (!name.is_empty()).then_some(name)
}

/// Both trees show the same name, ignoring case.
pub fn name_same(old_root: &Path, new_root: &Path) -> bool {
    match (display_name(old_root), display_name(new_root)) {
        (Some(a), Some(b)) => a.to_lowercase() == b.to_lowercase(),
        _ => false,
    }
}

// Calibrated 24.10.2026, installed copy vs the store's current CRX: MetaMask
// 13.46.1→13.53.0 0.44, Rabby 0.94.6→0.94.13 0.96, Phantom 26.28.1→26.34.0 0.12
// (hashed bundle names), Keplr 0.13.45→0.13.53 0.72; all 12 cross pairs 0.00.
pub const SAME_AT: f64 = 0.5;
pub const SAME_NAMED_AT: f64 = 0.1;
pub const OTHER_BELOW: f64 = 0.05;

/// What the files say of two trees taken for one extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kinship {
    Same,
    /// Between the thresholds: the person decides.
    Unsure,
    Other,
}

pub fn kinship(overlap: f64, name_same: bool) -> Kinship {
    if overlap >= SAME_AT || (name_same && overlap >= SAME_NAMED_AT) {
        Kinship::Same
    } else if overlap < OTHER_BELOW {
        Kinship::Other
    } else {
        Kinship::Unsure
    }
}

#[cfg(test)]
mod tests;
