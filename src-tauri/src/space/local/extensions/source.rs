//! Where an extension came from. Only `SourceRef` travels with the item; the
//! rest stays beside its folder in `<id>.source.json`, on this computer only.

use super::chrome_id::{decode_key, id_from_key};
use super::crx::{self, StoreItem};
use super::manifest_edit::read_manifest;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

/// The side file's format.
const VERSION: u32 = 1;
/// The launcher's old marker inside the folder; Chrome never reads it.
pub const ADDED: &str = ".added";
/// A `verified_contents.json` bigger than this is not the store's.
const VERIFIED_CONTENTS_MAX: u64 = 32 << 20;

/// What syncs: it sits in `ExtensionEntry.source`, so in the item's hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceRef {
    Webstore { id: String },
    /// v2: a direct https link to a .crx or .zip.
    Url { url: String },
}

impl SourceRef {
    pub fn webstore(id: &str) -> SourceRef {
        SourceRef::Webstore { id: id.to_string() }
    }
}

/// How the source was learned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum How {
    Link,
    CrxHeader,
    ManifestKey,
    VerifiedContents,
    User,
}

impl How {
    /// Proven by a signature or the key itself; the rest are taken on trust.
    #[allow(dead_code)] // staging reads it; the update check (step 4) calls that
    pub fn strong(self) -> bool {
        matches!(self, How::Link | How::CrxHeader | How::ManifestKey)
    }
}

/// This computer's own record: `extensions/<id>.source.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SourceLocal {
    pub v: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub how: Option<How>,
    /// The id a verified CRX header was signed for, at install.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crx_id: Option<String>,
    /// What the store's `verified_contents.json` named, read before Chrome deletes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_item: Option<StoreItem>,
    /// "@<unix_secs>", once kept in `.added` inside the folder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    /// The last sync package laid down here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied_package_rev: Option<u64>,
    /// A sync package not laid down here (its id would change, or it is older): not fetched again.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refused_package_rev: Option<u64>,
    /// The source was looked for already; never again.
    pub recovered: bool,
}

impl Default for SourceLocal {
    fn default() -> SourceLocal {
        SourceLocal {
            v: VERSION,
            source: None,
            how: None,
            crx_id: None,
            store_item: None,
            added_at: None,
            applied_package_rev: None,
            refused_package_rev: None,
            recovered: false,
        }
    }
}

/// What an install or a look at the files learned of their source.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Origin {
    pub source: Option<SourceRef>,
    pub how: Option<How>,
    pub crx_id: Option<String>,
    pub store_item: Option<StoreItem>,
}

impl SourceLocal {
    /// A new install's record: nothing left to recover.
    pub fn installed(o: Origin, added_at: String) -> SourceLocal {
        SourceLocal {
            source: o.source,
            how: o.how,
            crx_id: o.crx_id,
            store_item: o.store_item,
            added_at: Some(added_at),
            recovered: true,
            ..SourceLocal::default()
        }
    }
}

/// An unknown kind of source (a newer launcher's) reads as none, not as a broken item.
pub fn lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<SourceRef>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok()))
}

pub fn side_path(lib: &Path, id: &str) -> PathBuf {
    lib.join(format!("{id}.source.json"))
}

/// None when there is no side file or it cannot be read.
pub fn read(lib: &Path, id: &str) -> Option<SourceLocal> {
    let bytes = fs::read(side_path(lib, id)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Written whole or not at all.
pub fn write(lib: &Path, id: &str, s: &SourceLocal) -> Result<()> {
    let to = side_path(lib, id);
    let tmp = lib.join(format!(".{id}.source.tmp"));
    let body = serde_json::to_vec_pretty(s)?;
    let wrote = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&body)?;
        f.sync_all()?;
        fs::rename(&tmp, &to)
    })();
    if wrote.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    wrote.with_context(|| format!("write {}", to.display()))
}

/// The source the files themselves show: the manifest's `key`, else the
/// store's `verified_contents.json`, else none.
pub fn recover(root: &Path) -> Origin {
    if let Ok(m) = read_manifest(root) {
        if let Some(k) = m.get("key") {
            // A key Chrome cannot read loads nothing: no source either.
            let Some(der) = k.as_str().and_then(decode_key) else { return Origin::default() };
            return Origin {
                source: Some(SourceRef::webstore(&id_from_key(&der))),
                how: Some(How::ManifestKey),
                ..Origin::default()
            };
        }
    }
    let vc = root.join("_metadata").join("verified_contents.json");
    let small = fs::metadata(&vc).is_ok_and(|m| m.is_file() && m.len() <= VERIFIED_CONTENTS_MAX);
    match small.then(|| fs::read(&vc).ok()).flatten().and_then(|b| crx::verified_item(&b)) {
        Some(item) => Origin {
            source: Some(SourceRef::webstore(&item.id)),
            how: Some(How::VerifiedContents),
            store_item: Some(item),
            crx_id: None,
        },
        None => Origin::default(),
    }
}

/// What one pass did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Pass {
    pub written: usize,
    pub moved: usize,
    pub failed: usize,
}

/// Over every extension folder in `lib`, at launch: each source looked for
/// once (Chrome deletes `_metadata/` on first load). Writes only side files and
/// removes only `.added`; a folder is never renamed and its manifest never touched.
pub fn pass(lib: &Path) -> Pass {
    let mut p = Pass::default();
    let Ok(rd) = fs::read_dir(lib) else { return p };
    let mut ids: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| super::valid_id(n))
        .collect();
    ids.sort();
    for id in ids {
        match settle(lib, &id) {
            Ok((wrote, moved)) => {
                p.written += usize::from(wrote);
                p.moved += usize::from(moved);
            }
            Err(e) => {
                p.failed += 1;
                eprintln!("[extensions] {id}: source not recorded: {e:#}");
            }
        }
    }
    p
}

/// One folder: its side file brought up to date, then `.added` removed.
fn settle(lib: &Path, id: &str) -> Result<(bool, bool)> {
    let dir = lib.join(id);
    let root = super::manifest_root(&dir);
    if !root.join("manifest.json").is_file() {
        return Ok((false, false));
    }
    let had = read(lib, id);
    let mut side = had.clone().unwrap_or_default();
    if !side.recovered {
        // A manifest Chrome cannot read is left for a later launch.
        read_manifest(&root)?;
        let found = recover(&root);
        // A source sync wrote stays unless the files prove one.
        if found.source.is_some() {
            side.source = found.source;
            side.how = found.how;
            side.store_item = found.store_item;
        }
        side.v = VERSION;
        side.recovered = true;
    }
    let added = dir.join(ADDED);
    let marker = match fs::read_to_string(&added) {
        Ok(s) => Some(s.trim().to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e).with_context(|| format!("read {}", added.display())),
    };
    if side.added_at.is_none() {
        side.added_at = marker.clone().filter(|m| !m.is_empty());
    }
    let wrote = had.as_ref() != Some(&side);
    if wrote {
        write(lib, id, &side)?;
    }
    // Only once its date is safe in the side file.
    if marker.is_some() {
        fs::remove_file(&added).with_context(|| format!("remove {}", added.display()))?;
    }
    Ok((wrote, marker.is_some()))
}

#[cfg(test)]
mod tests;
