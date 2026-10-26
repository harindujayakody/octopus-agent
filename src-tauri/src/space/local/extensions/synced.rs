//! A package from another of the person's computers laid down here (design
//! §3.5.3–3.5.4): a folder this computer lacks as it comes, an installed one
//! through the same staging and swap as an update, at this computer's own root
//! and only while its id stays the same. Fetching is sync's; this is the files.

use super::source::{self, How, SourceLocal, SourceRef};
use super::swap::{self, Failure, Kind, Ops, Order, Origin, Paths};
use super::usage::{self, Outcome, World};
use super::version::newer;
use super::{manifest_root, valid_id};
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::Path;

/// What to do about the server's package of an extension.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    /// Its files are here, or were refused here: only the record is taken.
    Have,
    /// Staged here already: tried again, nothing downloaded.
    Staged,
    /// The store's own update to that version or newer waits to go in here first.
    StoreFirst,
    Fetch,
}

/// The installed version, when its manifest reads.
fn live_version(lib: &Path, id: &str) -> Option<String> {
    if !valid_id(id) {
        return None;
    }
    let m = super::manifest_edit::read_manifest(&manifest_root(&lib.join(id))).ok()?;
    m.get("version")?.as_str().map(str::to_string)
}

/// For package `rev` of `id`, whose record names `version`. `booked`: the
/// package the sync book took for it last, when the book knows the item.
pub fn plan(lib: &Path, id: &str, rev: u64, version: Option<&str>, booked: Option<u64>) -> Plan {
    let Some(live) = live_version(lib, id) else { return Plan::Fetch };
    if let Some(booked) = booked {
        let side = source::read(lib, id).unwrap_or_default();
        // A book older than the side file's record says which package these files are.
        let laid = side.applied_package_rev.or((booked > 0).then_some(booked));
        if laid == Some(rev) || side.refused_package_rev == Some(rev) {
            return Plan::Have;
        }
    }
    let Some(s) = swap::staged(lib, id).filter(|s| s.from == live) else { return Plan::Fetch };
    match &s.origin {
        Origin::Sync(r) if *r == rev => Plan::Staged,
        Origin::Store(_) if s.approved && version.is_some_and(|v| !newer(v, &s.to)) => Plan::StoreFirst,
        _ => Plan::Fetch,
    }
}

/// How laying a package down went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Laid {
    Applied,
    /// Staged; these profiles hold it (none named: the launcher itself is busy).
    Waiting(Vec<String>),
    NeedsEngine(String),
    /// Kept out, and not fetched again: it would change the id here (`conflict`), or is older.
    Refused { conflict: bool, message: String },
    Failed(String),
}

/// Sync's package at `file` laid down as `id`; `source` is what its record names.
pub fn lay_down(world: &dyn World, lib: &Path, id: &str, file: &Path, rev: u64, engine: Option<&str>, source: Option<SourceRef>) -> Laid {
    if !valid_id(id) {
        return Laid::Failed("invalid extension id".into());
    }
    let ops = Ops::real();
    if live_version(lib, id).is_none() {
        match fresh(lib, id, file, rev, source, &ops) {
            Ok(true) => return Laid::Applied,
            // One went in meanwhile: an update of it, then.
            Ok(false) => {}
            Err(e) => return Laid::Failed(format!("{e:#}")),
        }
    }
    match swap::stage_file(lib, id, file, &Order::sync(rev, engine), &ops, &swap::quiet()) {
        Ok(s) => match s.needs_engine {
            Some(min) => Laid::NeedsEngine(min),
            None => apply(world, lib, id, rev, &ops),
        },
        Err(f) => failed(lib, id, rev, f),
    }
}

/// What is staged for `id` tried again: the engine looked at anew, then put in when free.
pub fn retry(world: &dyn World, lib: &Path, id: &str, rev: u64, engine: Option<&str>) -> Laid {
    match swap::staged(lib, id).and_then(|s| s.needs_engine) {
        Some(min) if engine.is_some_and(|e| newer(&min, e)) => return Laid::NeedsEngine(min),
        Some(_) => {
            if let Err(f) = swap::engine_met(lib, id) {
                return Laid::Failed(f.message);
            }
        }
        None => {}
    }
    apply(world, lib, id, rev, &Ops::real())
}

fn apply(world: &dyn World, lib: &Path, id: &str, rev: u64, ops: &Ops) -> Laid {
    match usage::try_apply(world, lib, id, ops) {
        Ok(Outcome::Applied(_)) => Laid::Applied,
        Ok(Outcome::Deferred { profiles }) => Laid::Waiting(profiles),
        Ok(Outcome::Nothing) => Laid::Failed("nothing is staged for this extension".into()),
        Err(f) => failed(lib, id, rev, f),
    }
}

fn failed(lib: &Path, id: &str, rev: u64, f: Failure) -> Laid {
    if !matches!(f.kind, Kind::IdConflict | Kind::NotNewer) {
        return Laid::Failed(f.message);
    }
    let mut side = source::read(lib, id).unwrap_or_default();
    side.refused_package_rev = Some(rev);
    if let Err(e) = source::write(lib, id, &side) {
        eprintln!("[extensions] {id}: side file not updated: {e:#}");
    }
    Laid::Refused { conflict: f.kind == Kind::IdConflict, message: f.message }
}

/// A folder this computer lacks: the package unpacked as it is, its side file
/// written before it moves in. One there that holds no extension is replaced;
/// false, with nothing done, when an extension is there after all.
fn fresh(lib: &Path, id: &str, file: &Path, rev: u64, source: Option<SourceRef>, ops: &Ops) -> Result<bool> {
    let p = Paths::new(lib, id);
    let _alone = usage::exclusive(id, usage::SWAP_WAIT).context("the extension is being updated; try again in a minute")?;
    let (stage, tree, live) = (p.staging(), p.tree(), p.live());
    // Looked at again under the lock: a swap may have just put it back.
    swap::put_back(&p, ops);
    if p.prev_new().exists() {
        bail!("an earlier update of it has not finished; tried again at the next sync");
    }
    if manifest_root(&live).join("manifest.json").is_file() {
        if live_version(lib, id).is_some() {
            return Ok(false);
        }
        bail!("its folder here does not read, so it is left as it is");
    }
    let _ = fs::remove_dir_all(&stage);
    let made = (|| -> Result<()> {
        fs::create_dir_all(&tree)?;
        super::unpack_archive(file, &tree)?;
        let root = manifest_root(&tree);
        if !root.join("manifest.json").is_file() {
            bail!("its files hold no manifest.json");
        }
        // An older launcher's package carries `.added`: its date goes to the side file.
        let added = tree.join(source::ADDED);
        let at = fs::read_to_string(&added).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let _ = fs::remove_file(&added);
        let found = source::recover(&root);
        // A key gives the id, so the source it names outranks the record's.
        let source = if found.how == Some(How::ManifestKey) { found.source.clone() } else { source.or(found.source.clone()) };
        let how = if source == found.source { found.how } else { None };
        let side = SourceLocal {
            source,
            how,
            store_item: found.store_item,
            added_at: Some(at.unwrap_or_else(super::stamp)),
            applied_package_rev: Some(rev),
            recovered: true,
            ..SourceLocal::default()
        };
        if !ops.clear(&p, &live) {
            bail!("could not clear {}", live.display());
        }
        source::write(lib, id, &side)?;
        fs::rename(&tree, &live).context("move the extension into the library")
    })();
    let _ = fs::remove_dir_all(&stage);
    if made.is_err() && !live.exists() {
        let _ = fs::remove_file(source::side_path(lib, id));
    }
    made.map(|()| true)
}

/// The source the folder's `key` names: the one its id comes from.
fn keyed(lib: &Path, id: &str) -> Option<SourceRef> {
    super::key_id(&manifest_root(&lib.join(id))).map(|k| SourceRef::webstore(&k))
}

/// The record's source into the side file (none named leaves it; a key or
/// signature here outranks it), and `laid` as the package these files are
/// when that is not known yet. Nothing for a folder that is not here.
pub fn take(lib: &Path, id: &str, src: Option<SourceRef>, laid: Option<u64>) -> Result<()> {
    if live_version(lib, id).is_none() {
        return Ok(());
    }
    let mut side = source::read(lib, id).unwrap_or_default();
    let before = side.clone();
    let proven = side.source.is_some() && side.how.is_some_and(How::strong);
    // Never against the id a key here gives.
    let keyed = keyed(lib, id);
    if let Some(s) = src.filter(|s| !proven && side.source.as_ref() != Some(s) && keyed.as_ref().is_none_or(|k| k == s)) {
        // Learned from another computer: as weak as a link by hand.
        side.source = Some(s);
        side.how = None;
    }
    if side.applied_package_rev.is_none() && side.refused_package_rev.is_none() {
        side.applied_package_rev = laid;
    }
    if side != before {
        source::write(lib, id, &side)?;
    }
    Ok(())
}

/// This computer's files went up as package `rev`.
pub fn sent(lib: &Path, id: &str, rev: u64) -> Result<()> {
    if live_version(lib, id).is_none() {
        return Ok(());
    }
    let mut side = source::read(lib, id).unwrap_or_default();
    if side.applied_package_rev == Some(rev) && side.refused_package_rev.is_none() {
        return Ok(());
    }
    (side.applied_package_rev, side.refused_package_rev) = (Some(rev), None);
    source::write(lib, id, &side)
}

/// Met on a server for the first time: these files are its package `laid`,
/// or no package of it is known yet.
pub fn met_anew(lib: &Path, id: &str, laid: Option<u64>) -> Result<()> {
    if live_version(lib, id).is_none() {
        return Ok(());
    }
    let mut side = source::read(lib, id).unwrap_or_default();
    if (side.applied_package_rev, side.refused_package_rev) == (laid, None) {
        return Ok(());
    }
    (side.applied_package_rev, side.refused_package_rev) = (laid, None);
    source::write(lib, id, &side)
}

/// What sync compares to tell the files changed (`files_digest`).
pub fn files(lib: &Path, id: &str) -> Option<String> {
    live_version(lib, id)?;
    super::files_digest(&lib.join(id)).ok()
}

/// Room to lay down a package of `size`.
pub fn room(lib: &Path, size: u64) -> Result<(), String> {
    swap::room(&Ops::real(), lib, size).map_err(|f| f.message)
}

#[cfg(test)]
mod tests;
