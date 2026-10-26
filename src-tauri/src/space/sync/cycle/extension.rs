//! Extensions in personal sync (design §3.5). A record goes up whenever it
//! changes, the files only when they did; what comes down is laid down through
//! the same staging and swap as a Web Store update, never under a running browser.

use std::path::{Path, PathBuf};

use anyhow::Context as _;
use serde_json::Value;

use super::{me_path, opened, pulled, send_item, skip, ItemKind, Net, Rec, Stop, Told, PACKAGE_MAX};
use crate::space::client::{TeamClient, TeamError};
use crate::space::local::extensions::source::SourceRef;
use crate::space::local::extensions::synced::{self, Laid, Plan};
use crate::space::local::extensions::version::{newer, Version};
use crate::space::local::extensions::{self as library, updates, usage};
use crate::space::remote::{ItemRow, PackageWritten};

/// In `Rec.files` after a record went up without its files: they go next time.
const UNSENT: &str = "unsent";

/// How the server's record of an extension was taken here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Wrote {
    /// Not now: the book stays, the next sync tries again.
    No,
    /// The record, and the files of its package.
    Theirs,
    /// The record; the files here stay (that package would change the id, or is older).
    Kept,
}

#[cfg(test)]
pub(in crate::space::sync) static ENGINE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
#[cfg(test)]
pub(in crate::space::sync) static FETCHED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// The engine here, for a package's `minimum_chrome_version`.
#[cfg(not(test))]
fn engine() -> Option<String> {
    crate::ext_updates::engine()
}

#[cfg(test)]
fn engine() -> Option<String> {
    ENGINE.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn library_dir() -> Option<PathBuf> {
    crate::store::extensions_dir().map_err(|e| eprintln!("[sync] extensions: {e:#}")).ok()
}

/// The server's package revision of an extension; 0 before it has one.
pub(super) fn package_of(row: &ItemRow) -> u64 {
    row.package.as_ref().map_or(0, |p| p.package_rev)
}

/// Its folder is here though the library cannot list it now (mid-swap, or a
/// manifest that does not read): never taken for deleted.
pub(super) fn unlisted(id: &str) -> bool {
    library_dir().is_some_and(|lib| library::unlisted(&lib, id))
}

/// The start's settling of the library done, waited for a while; false: not
/// yet, so extensions wait for the next sync.
pub(super) async fn settled() -> bool {
    let Some(lib) = library_dir() else { return true };
    let done = usage::until_settled(&lib, usage::SETTLE_WAIT).await;
    if !done {
        eprintln!("[sync] extensions: the library is still being settled; left for the next sync");
    }
    done
}

/// This computer's files of `id` as sync compares them; empty when it is not here.
pub(super) fn files_here(id: &str) -> String {
    library_dir().and_then(|lib| synced::files(&lib, id)).unwrap_or_default()
}

fn theirs(row: &ItemRow) -> Value {
    opened(&row.data).unwrap_or_default()
}

fn version_of(v: &Value) -> Option<&str> {
    v.get("version")?.as_str()
}

fn source_of(v: &Value) -> Option<SourceRef> {
    v.get("source").cloned().and_then(|s| serde_json::from_value(s).ok())
}

fn same_version(a: Option<&str>, b: Option<&str>) -> bool {
    match (a.and_then(Version::parse), b.and_then(Version::parse)) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

/// The same on both sides as far as a person can tell: version and source.
/// Size, icon and description follow from the files, and each Chrome tidies `_metadata/` on its own.
fn same(v: &Value, row: &ItemRow) -> bool {
    let t = theirs(row);
    same_version(version_of(v), version_of(&t)) && source_of(v) == source_of(&t)
}

/// The server's is older than this computer's, from one source as far as either
/// knows: a wallet's storage only migrates forward, so this one stays.
fn older_there(v: &Value, row: &ItemRow) -> bool {
    let t = theirs(row);
    let (mine, there) = (source_of(v), source_of(&t));
    let one_source = mine.is_none() || there.is_none() || mine == there;
    one_source && matches!((version_of(v), version_of(&t)), (Some(a), Some(b)) if newer(a, b))
}

/// The record's source into the side file (none named is no unlinking), and
/// `laid` as the package these files are, when that is not known yet.
fn take(id: &str, src: Option<SourceRef>, laid: Option<u64>) {
    let Some(lib) = library_dir() else { return };
    if let Err(e) = synced::take(&lib, id, src, laid) {
        eprintln!("[sync] extension {id}: side file not written: {e:#}");
    }
}

/// This computer's entry for `id` as it reads now.
fn here_now(id: &str) -> Result<Option<(String, Value)>, Stop> {
    Ok(ItemKind::Extension.here()?.remove(id))
}

/// Met for the first time with one here under the same id: the same, or the
/// newer of the two kept, or the server's laid down. A package revision the
/// side file kept from another server means nothing here.
pub(super) async fn first(c: &TeamClient, id: &str, name: &str, v: &Value, row: &ItemRow, told: &mut Told) -> Result<Option<Rec>, Stop> {
    let laid = same(v, row).then(|| package_of(row));
    if let Some(lib) = library_dir() {
        if let Err(e) = synced::met_anew(&lib, id, laid) {
            eprintln!("[sync] extension {id}: side file not written: {e:#}");
        }
    }
    if laid.is_some() {
        return Ok(Some(pulled(ItemKind::Extension, id, row)));
    }
    if older_there(v, row) {
        return keep_mine(c, id, name, v, row, told).await;
    }
    match write(c, row, None, told).await? {
        Wrote::No => return Ok(None),
        Wrote::Theirs => told.warnings.push("A extension was set differently on another computer: that version is kept.".into()),
        Wrote::Kept => {}
    }
    told.topics.insert("extensions");
    taken(c, id, row).await
}

/// Changed on the server since the last sync (`lc`: here too). Its files moved
/// there only if its package did; else only the record did, and the files here stay.
#[allow(clippy::too_many_arguments)]
pub(super) async fn met(
    c: &TeamClient,
    id: &str,
    name: &str,
    v: &Value,
    r: &Rec,
    row: &ItemRow,
    lc: bool,
    told: &mut Told,
) -> Result<Option<Rec>, Stop> {
    if package_of(row) == r.package {
        let there = source_of(&theirs(row));
        take(id, there.clone(), None);
        let Some((name, now)) = here_now(id)? else { return Ok(None) };
        let mine = source_of(v);
        if lc && mine.is_some() && there.is_some() && mine != there && source_of(&now) == there {
            told.warnings.push(format!("“{name}” was changed on another computer too: that version is kept."));
        }
        told.topics.insert("extensions");
        // What changed here goes up over it, the files too when they changed.
        if lc && !same(&now, row) {
            return send_item(c, ItemKind::Extension, id, &name, &now, Some(r), Some(row)).await;
        }
        return Ok(Some(pulled(ItemKind::Extension, id, row)));
    }
    if older_there(v, row) {
        return keep_mine(c, id, name, v, row, told).await;
    }
    // Lost here only if this computer's files changed too; a link made here goes back up.
    let differs = lc && (r.files.is_empty() || files_here(id) != r.files) && !same(v, row);
    match write(c, row, Some(r), told).await? {
        Wrote::No => return Ok(None),
        Wrote::Theirs if differs => told.warnings.push(format!("“{name}” was changed on another computer too: that version is kept.")),
        _ => {}
    }
    told.topics.insert("extensions");
    taken(c, id, row).await
}

/// Taken from the server; a source known only here goes back up with it.
async fn taken(c: &TeamClient, id: &str, row: &ItemRow) -> Result<Option<Rec>, Stop> {
    let rec = pulled(ItemKind::Extension, id, row);
    match here_now(id)? {
        Some((name, now)) if source_of(&now).is_some() && source_of(&theirs(row)).is_none() => {
            Ok(send_item(c, ItemKind::Extension, id, &name, &now, Some(&rec), Some(row)).await?.or(Some(rec)))
        }
        _ => Ok(Some(rec)),
    }
}

/// This computer's newer version goes up over the server's older one, files and all.
async fn keep_mine(c: &TeamClient, id: &str, name: &str, v: &Value, row: &ItemRow, told: &mut Told) -> Result<Option<Rec>, Stop> {
    let t = theirs(row);
    // A source the server knows and this computer does not is taken first.
    if source_of(v).is_none() && source_of(&t).is_some() {
        take(id, source_of(&t), None);
    }
    let (name, v) = here_now(id)?.unwrap_or_else(|| (name.to_string(), v.clone()));
    let rec = send_item(c, ItemKind::Extension, id, &name, &v, None, Some(row)).await?;
    if rec.is_some() {
        let (mine, there) = (version_of(&v).unwrap_or_default(), version_of(&t).unwrap_or_default());
        told.warnings.push(format!(
            "“{name}” is newer on this computer ({mine}) than on another one ({there}), so the version on this computer is kept."
        ));
    }
    Ok(rec)
}

/// The server's record written here: its source into the side file, its files
/// fetched only for a package not laid down here, and swapped in once nothing
/// holds the folder (`r`: what the book took last).
pub(super) async fn write(c: &TeamClient, row: &ItemRow, r: Option<&Rec>, told: &mut Told) -> Result<Wrote, Stop> {
    let id = row.id.as_str();
    // Its files are not on the server yet.
    let Some((rev, size)) = row.package.as_ref().map(|p| (p.package_rev, p.size)) else { return Ok(Wrote::No) };
    let Some(lib) = library_dir() else { return Ok(Wrote::No) };
    if !library::valid_id(id) {
        eprintln!("[sync] extension {id}: not a library id; left out");
        return Ok(Wrote::No);
    }
    let t = theirs(row);
    let src = source_of(&t);
    let name = t.get("name").and_then(Value::as_str).unwrap_or(&row.name).to_string();
    let plan = synced::plan(&lib, id, rev, version_of(&t), r.map(|r| r.package));
    take(id, src.clone(), (plan == Plan::Have).then_some(rev));
    let (laid, again) = match plan {
        Plan::Have => return Ok(Wrote::Theirs),
        // A Web Store update to that version waits here: it goes in first.
        Plan::StoreFirst => return Ok(Wrote::No),
        Plan::Staged => {
            let (l, who, e) = (lib.clone(), id.to_string(), engine());
            let laid = tokio::task::spawn_blocking(move || synced::retry(&usage::System, &l, &who, rev, e.as_deref()))
                .await
                .unwrap_or_else(|e| Laid::Failed(e.to_string()));
            (laid, true)
        }
        Plan::Fetch => match fetch(c, &lib, id, rev, size, src).await? {
            Some(laid) => (laid, false),
            None => return Ok(Wrote::No),
        },
    };
    Ok(outcome(id, &name, rev, laid, again, told))
}

/// Package `rev` downloaded and laid down; None when it could not be had now.
async fn fetch(c: &TeamClient, lib: &Path, id: &str, rev: u64, size: u64, src: Option<SourceRef>) -> Result<Option<Laid>, Stop> {
    // One update or link of an extension at a time, sync's included.
    let Some(_claim) = updates::claim(lib, id) else {
        eprintln!("[sync] extension {id}: being updated here; left for the next sync");
        return Ok(None);
    };
    if let Err(e) = synced::room(lib, size) {
        eprintln!("[sync] extension {id}: {e}");
        return Ok(None);
    }
    let zip = lib.join(format!(".{id}.zip"));
    let path = format!("{}/package", me_path("items/extension", id)?);
    #[cfg(test)]
    FETCHED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let got = skip(c.fetch(&path, &zip, PACKAGE_MAX).await, id);
    if !matches!(got, Ok(Some(_))) {
        let _ = std::fs::remove_file(&zip);
        return got.map(|_| None);
    }
    let (l, who, file, e) = (lib.to_path_buf(), id.to_string(), zip.clone(), engine());
    let laid = tokio::task::spawn_blocking(move || synced::lay_down(&usage::System, &l, &who, &file, rev, e.as_deref(), src))
        .await
        .unwrap_or_else(|e| Laid::Failed(e.to_string()));
    let _ = std::fs::remove_file(&zip);
    Ok(Some(laid))
}

/// What a package laid down means for the book and the person; `again`: it
/// was staged at an earlier sync, and one still waiting is not news.
fn outcome(id: &str, name: &str, rev: u64, laid: Laid, again: bool, told: &mut Told) -> Wrote {
    if again && matches!(laid, Laid::Waiting(_) | Laid::NeedsEngine(_)) {
        return Wrote::No;
    }
    let book = crate::store::data_root().map(|d| d.join(updates::BOOK));
    told.topics.insert("extension-updates");
    match laid {
        Laid::Applied => {
            eprintln!("[sync] extension {id}: package {rev} laid down");
            if let Ok(b) = &book {
                updates::note_conflict(b, id, None);
            }
            told.topics.insert("extensions");
            Wrote::Theirs
        }
        Laid::Waiting(profiles) => {
            let who = if profiles.is_empty() { "the launcher".to_string() } else { profiles.join(", ") };
            eprintln!("[sync] extension {id}: package {rev} staged; it goes in once {who} lets it go");
            Wrote::No
        }
        Laid::NeedsEngine(min) => {
            eprintln!("[sync] extension {id}: package {rev} staged; it needs browser core {min} or newer");
            Wrote::No
        }
        Laid::Refused { conflict, message } => {
            eprintln!("[sync] extension {id}: package {rev} kept out: {message}");
            told.warnings.push(if conflict {
                if let Ok(b) = &book {
                    updates::note_conflict(b, id, Some(&message));
                }
                format!("“{name}” from another computer would change its ID here, so the version on this computer is kept.")
            } else {
                format!("“{name}” from another computer is older than the version here, so the version on this computer is kept.")
            });
            Wrote::Kept
        }
        Laid::Failed(why) => {
            eprintln!("[sync] extension {id}: package {rev} not laid down: {why}");
            Wrote::No
        }
    }
}

/// Its record went up as `rec`, over the server's `over`. The files follow when
/// they changed since they last went up, or it is new there or goes over an older one.
pub(super) async fn after_put(c: &TeamClient, id: &str, v: &Value, mut rec: Rec, r: Option<&Rec>, over: Option<&ItemRow>) -> Result<Rec, Stop> {
    rec.package = over.map(package_of).or(r.map(|r| r.package)).unwrap_or(0);
    rec.files = files_here(id);
    let ships = match (r, over) {
        // A book from before files were kept: by version, or no package there yet.
        (Some(r), Some(o)) if r.files.is_empty() => o.package.is_none() || !same_version(version_of(v), version_of(&theirs(o))),
        (Some(r), Some(_)) => r.files != rec.files,
        _ => true,
    };
    if !ships {
        take(id, None, Some(rec.package));
        return Ok(rec);
    }
    match put_package(c, id, rec.package).await {
        Ok(Packed::Sent { rev, files }) => {
            if let Some(lib) = library_dir() {
                if let Err(e) = synced::sent(&lib, id, rev) {
                    eprintln!("[sync] extension {id}: side file not written: {e:#}");
                }
            }
            Ok(Rec { package: rev, files, ..rec })
        }
        // Kept here as it is; the others keep theirs until its files change.
        Ok(Packed::TooBig(files)) => Ok(Rec { files, ..rec }),
        Ok(Packed::Gone) => Ok(Rec { hash: String::new(), files: UNSENT.into(), ..rec }),
        // The record is up, so this is kept; the files go at the next sync.
        Err(e) => {
            eprintln!("[sync] {id}: {e}");
            Ok(Rec { hash: String::new(), files: UNSENT.into(), ..rec })
        }
    }
}

enum Packed {
    Sent { rev: u64, files: String },
    TooBig(String),
    Gone,
}

/// Its files up over package `base`, packed while no swap of the folder runs.
async fn put_package(c: &TeamClient, id: &str, base: u64) -> Net<Packed> {
    let Some(dir) = library::load_path(id) else { return Ok(Packed::Gone) };
    let zip = std::env::temp_dir().join(format!("shardx-sync-ext-{}.zip", uuid::Uuid::new_v4().simple()));
    let (at, who) = (zip.clone(), id.to_string());
    let packed = tokio::task::spawn_blocking(move || -> anyhow::Result<(u64, String)> {
        let _alone = usage::exclusive(&who, usage::SWAP_WAIT).context("the extension is being updated")?;
        let files = library::files_digest(&dir)?;
        Ok((library::zip_dir(&dir, &at)?, files))
    })
    .await
    .map_err(|e| TeamError::Garbled(e.to_string()))
    .and_then(|r| r.map_err(|e| TeamError::Garbled(format!("{e:#}"))));
    let (size, files) = match packed {
        Ok(x) => x,
        Err(e) => {
            let _ = std::fs::remove_file(&zip);
            return Err(e);
        }
    };
    if size > PACKAGE_MAX {
        let _ = std::fs::remove_file(&zip);
        eprintln!("[sync] extension {id} is {} MB packed; sync keeps extensions up to 64 MB", size >> 20);
        return Ok(Packed::TooBig(files));
    }
    let path = format!("{}/package?base_package_rev={base}", me_path("items/extension", id)?);
    let sent: Net<PackageWritten> = c.send_file(&path, &zip).await;
    let _ = std::fs::remove_file(&zip);
    sent.map(|w| Packed::Sent { rev: w.package_rev, files })
}
