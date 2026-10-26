//! `sync.json` (what syncs, and what was last synced of each thing) and `sync-outbox.json`
//! (what the server has not taken yet), in the local data; written under a file lock.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Profiles {
    #[default]
    Selected,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Proxies {
    #[default]
    Bound,
    All,
}

/// What syncs, the same on all the person's computers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kinds {
    pub profiles: Profiles,
    pub proxies: Proxies,
    pub folders_tags: bool,
    pub bookmarks: bool,
    pub extensions: bool,
    pub automation: bool,
}

impl Default for Kinds {
    fn default() -> Self {
        Kinds {
            profiles: Profiles::Selected,
            proxies: Proxies::Bound,
            folders_tags: true,
            bookmarks: true,
            extensions: true,
            automation: true,
        }
    }
}

/// What was last synced of one thing: the server's revision, a digest of it as
/// it is here, and an extension's package revision and the files it holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rec {
    pub rev: u64,
    pub hash: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub package: u64,
    /// `files_digest` of an extension's files as they went up or came down;
    /// empty in a book from before it was kept.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub files: String,
}

impl Rec {
    pub fn of(rev: u64, hash: String) -> Rec {
        Rec { rev, hash, ..Rec::default() }
    }
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

/// A profile's browser data here: the server session it was made from, and
/// whether it changed since without going up.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sess {
    pub rev: u64,
    #[serde(default)]
    pub dirty: bool,
}

/// Another device holding a profile's lease, as last heard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Held {
    pub device_id: String,
    pub device_name: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Book {
    #[serde(default)]
    pub kinds: Kinds,
    /// Changed here and not on the server yet.
    #[serde(default)]
    pub kinds_dirty: bool,
    /// The server's sync document this device follows; empty before first contact.
    #[serde(default)]
    pub generation: String,
    #[serde(default)]
    pub doc_rev: u64,
    /// That document is gone: another device removed the synced data.
    #[serde(default)]
    pub removed: bool,
    /// Profiles picked to sync while kinds.profiles is "selected".
    #[serde(default)]
    pub picked: BTreeSet<String>,
    /// By kind, then id.
    #[serde(default)]
    pub records: BTreeMap<String, BTreeMap<String, Rec>>,
    #[serde(default)]
    pub sessions: BTreeMap<String, Sess>,
    /// Conflict copies sync made here.
    #[serde(default)]
    pub conflicts: BTreeSet<String>,
    #[serde(default)]
    pub held: BTreeMap<String, Held>,
    #[serde(default)]
    pub last_sync_at: Option<u64>,
}

impl Book {
    pub fn rec(&self, kind: &str, id: &str) -> Option<&Rec> {
        self.records.get(kind)?.get(id)
    }

    pub fn set_rec(&mut self, kind: &str, id: &str, rec: Rec) {
        self.records.entry(kind.to_string()).or_default().insert(id.to_string(), rec);
    }

    pub fn drop_rec(&mut self, kind: &str, id: &str) {
        if let Some(m) = self.records.get_mut(kind) {
            m.remove(id);
        }
    }

    /// Whether the profile syncs: every one under "all", else the ones picked.
    pub fn syncs(&self, id: &str) -> bool {
        self.kinds.profiles == Profiles::All || self.picked.contains(id)
    }

    /// The device holding it, while its lease is live.
    pub fn held_by(&self, id: &str) -> Option<&Held> {
        self.held.get(id).filter(|h| h.expires_at > super::now())
    }
}

/// A change made here that the server has not taken yet.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Entry {
    pub kind: String,
    pub id: String,
    pub op: Op,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Put,
    Delete,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outbox {
    #[serde(default)]
    pub entries: Vec<Entry>,
}

fn path(name: &str) -> Result<PathBuf> {
    #[cfg(test)]
    if !crate::store::test_config_set() {
        anyhow::bail!("a test touched {name} without a config dir of its own");
    }
    Ok(crate::store::local_root()?.join(name))
}

const BOOK: &str = "sync.json";
const OUTBOX: &str = "sync-outbox.json";
const LOCK: &str = "sync.lock";

/// Held across a read and its write, in this process and against a reaper.
struct Turn {
    _here: std::sync::MutexGuard<'static, ()>,
    _file: Option<fs::File>,
}

fn turn() -> Turn {
    static HERE: Mutex<()> = Mutex::new(());
    let here = HERE.lock().unwrap_or_else(|e| e.into_inner());
    let file = path(LOCK).ok().and_then(|p| {
        let f = fs::OpenOptions::new().create(true).truncate(false).write(true).open(p).ok()?;
        f.lock().ok()?;
        Some(f)
    });
    Turn { _here: here, _file: file }
}

fn read_file<T: Default + serde::de::DeserializeOwned>(name: &str) -> Result<T> {
    let p = path(name)?;
    match fs::read(&p) {
        Ok(b) => serde_json::from_slice(&b).with_context(|| format!("{} is not readable", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e).with_context(|| format!("read {}", p.display())),
    }
}

fn write_file<T: Serialize>(name: &str, v: &T) -> Result<()> {
    let p = path(name)?;
    let tmp = p.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).with_context(|| format!("write {}", tmp.display()))?;
        f.write_all(&serde_json::to_vec_pretty(v)?)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, &p).with_context(|| format!("replace {}", p.display()))
}

/// The book as it is on disk; empty when there is none.
pub fn read() -> Book {
    let _t = turn();
    read_file(BOOK).unwrap_or_else(|e| {
        eprintln!("[sync] {e:#}");
        Book::default()
    })
}

/// Read, change and write the book whole.
pub fn change<T>(f: impl FnOnce(&mut Book) -> T) -> Result<T> {
    let _t = turn();
    let mut b: Book = read_file(BOOK).unwrap_or_default();
    let out = f(&mut b);
    write_file(BOOK, &b)?;
    Ok(out)
}

/// A new book, the old one and its outbox gone.
pub fn reset(b: &Book) -> Result<()> {
    let _t = turn();
    write_file(BOOK, b)?;
    write_file(OUTBOX, &Outbox::default())
}

pub fn outbox() -> Outbox {
    let _t = turn();
    read_file(OUTBOX).unwrap_or_default()
}

/// Kept as `entries`; false when that is what was there.
pub fn set_outbox(entries: Vec<Entry>) -> Result<bool> {
    let _t = turn();
    let was: Outbox = read_file(OUTBOX).unwrap_or_default();
    if was.entries == entries {
        return Ok(false);
    }
    write_file(OUTBOX, &Outbox { entries })?;
    Ok(true)
}

/// Delete all data, or sync disconnected: nothing of it stays here but the empty lock.
pub fn forget() -> Result<()> {
    let _t = turn();
    for name in [BOOK, OUTBOX] {
        let p = path(name)?;
        for f in [p.clone(), p.with_extension("json.tmp")] {
            match fs::remove_file(&f) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(e).with_context(|| format!("remove {}", f.display()));
                }
                _ => {}
            }
        }
    }
    Ok(())
}
