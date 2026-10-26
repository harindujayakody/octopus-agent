//! A new version laid over a library extension at the same path, with the
//! same root and the same id basis, so Chrome keeps its id and its data
//! (design §3.3). Beside the live `<id>/` in the library:
//!   `.<id>.part`            a download under way
//!   `.<id>.staging/`        `unpack/`, then `tree/`; `staged.json` once checked
//!   `.<id>.weigh/`          a store package unpacked to compare with, while linking
//!   `.<id>.prev/`           the tree before the last update, kept 7 days (`.<id>.prev.json`)
//!   `.<id>.prev.new/`       the live tree between the fallback's two renames
//!   `.<id>.trash-<nanos>/`  what could not be removed yet
//!   `.<id>.zip`, `.<id>.new`, `.<id>.source.tmp`  left by sync or a side-file write

use super::chrome_id::id_from_key;
use super::crx::{self, StoreItem};
use super::manifest_edit::{self, Grant, KeyAction, Kinship};
use super::source::{self, SourceRef};
use super::version::{newer, Version};
use super::{manifest_root, unzip, valid_id};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The tree before an update is kept this long.
pub const PREV_KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Free room asked beyond three times the package.
const ROOM_MARGIN: u64 = 64 << 20;
const MB: u64 = 1 << 20;
/// How long a stage waits for a swap of the same extension to end.
const CLEAR_WAIT: Duration = Duration::from_secs(30);
const VERIFIED_CONTENTS_MAX: u64 = 32 << 20;

/// Where one extension's files lie in the library.
pub struct Paths {
    lib: PathBuf,
    id: String,
}

impl Paths {
    pub fn new(lib: &Path, id: &str) -> Paths {
        Paths { lib: lib.to_path_buf(), id: id.to_string() }
    }
    fn dot(&self, rest: &str) -> PathBuf {
        self.lib.join(format!(".{}.{rest}", self.id))
    }
    pub fn live(&self) -> PathBuf {
        self.lib.join(&self.id)
    }
    pub fn part(&self) -> PathBuf {
        self.dot("part")
    }
    pub fn staging(&self) -> PathBuf {
        self.dot("staging")
    }
    pub fn tree(&self) -> PathBuf {
        self.staging().join("tree")
    }
    fn unpack(&self) -> PathBuf {
        self.staging().join("unpack")
    }
    fn note(&self) -> PathBuf {
        self.staging().join("staged.json")
    }
    pub fn prev(&self) -> PathBuf {
        self.dot("prev")
    }
    fn prev_note(&self) -> PathBuf {
        self.dot("prev.json")
    }
    pub fn prev_new(&self) -> PathBuf {
        self.dot("prev.new")
    }
    fn trash(&self) -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        self.dot(&format!("trash-{n}"))
    }
}

/// Where a staged tree came from (`staged.json`): `{"store": id}` or `{"sync": package_rev}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Store(String),
    Sync(u64),
}

/// A weakly linked extension whose new files look like another one's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Identity {
    /// Share of the live files found unchanged in the new tree, 0 to 1.
    pub overlap: f64,
    pub names: Names,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Names {
    pub old: String,
    pub new: String,
}

/// `staged.json`: a complete, checked tree waiting in staging.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Staged {
    /// The live version it was staged against.
    pub from: String,
    pub to: String,
    /// Hex SHA-256 of the package.
    pub sha256: String,
    pub origin: Origin,
    pub key: KeyAction,
    /// The manifest's folder inside the extension's: "" or one name.
    pub root: String,
    /// What the new version may do that the live one could not.
    pub grown: Vec<Grant>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<Identity>,
    /// The engine it asks for, newer than the one here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs_engine: Option<String>,
    /// What the store's signed contents named, read before `_metadata/` went.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_item: Option<StoreItem>,
    /// The tree's files and bytes; tells a complete stage from a swapped-out one.
    pub digest: String,
    /// Goes in as soon as nothing holds the extension.
    pub approved: bool,
    pub at: u64,
}

impl Staged {
    pub fn ready(&self) -> bool {
        self.approved && self.needs_engine.is_none()
    }
}

/// What to stage.
#[derive(Debug, Clone)]
pub struct Order {
    pub origin: Origin,
    /// As update2 described the package.
    pub sha256: Option<String>,
    pub size: Option<u64>,
    /// The engine's version, for `minimum_chrome_version`; None when unknown.
    pub engine: Option<String>,
    /// The person asked for it: applied once free, unless there is something to confirm.
    pub approve: bool,
    /// Its files were weighed against the live ones and accepted (linking by hand).
    pub weighed: bool,
    /// The version update2 named: the package must be it.
    pub version: Option<String>,
    publisher: [u8; 32],
}

impl Order {
    /// The Web Store's package for `id`; made on the thread that asks, so a
    /// test's stand-in store key is the one checked.
    pub fn store(id: &str, sha256: Option<&str>, size: Option<u64>, engine: Option<&str>) -> Order {
        Order {
            origin: Origin::Store(id.to_string()),
            sha256: sha256.map(str::to_string),
            size,
            engine: engine.map(str::to_string),
            approve: true,
            weighed: false,
            version: None,
            publisher: crx::publisher(),
        }
    }

    /// Held to the version update2 named for it.
    pub fn expecting(self, version: &str) -> Order {
        Order { version: Some(version.to_string()), ..self }
    }

    /// The person's own package from another computer: its builder confirmed it there.
    pub fn sync(package_rev: u64, engine: Option<&str>) -> Order {
        Order {
            origin: Origin::Sync(package_rev),
            sha256: None,
            size: None,
            engine: engine.map(str::to_string),
            approve: true,
            weighed: false,
            version: None,
            publisher: crx::publisher(),
        }
    }

    /// What the store's package must be: its id, the publisher's proof, and what update2 said.
    fn expect(&self) -> Option<crx::Expect<'_>> {
        let Origin::Store(sid) = &self.origin else { return None };
        Some(crx::Expect { id: Some(sid), publisher: Some(self.publisher), sha256: self.sha256.as_deref(), size: self.size })
    }
}

/// Why staging or applying stopped; the live folder is untouched by all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Space,
    Download,
    Package,
    Manifest,
    NotNewer,
    IdConflict,
    /// What was staged no longer fits the live folder, or is gone.
    Stale,
    Swap,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub kind: Kind,
    pub message: String,
}

impl Failure {
    pub fn new(kind: Kind, message: impl Into<String>) -> Failure {
        Failure { kind, message: message.into() }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Failure {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub from: String,
    pub to: String,
    /// One exchange, not the two renames.
    pub atomic: bool,
}

/// Steps of a stage, for the progress the UI shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Download,
    Verify,
    Unpack,
}

/// Hears `(phase, received, total)`; total is 0 when unknown.
pub type Progress = Arc<dyn Fn(Phase, u64, u64) + Send + Sync>;

pub fn quiet() -> Progress {
    Arc::new(|_, _, _| {})
}

type PathOp<R> = Box<dyn Fn(&Path) -> R + Send + Sync>;
type PairOp<R> = Box<dyn Fn(&Path, &Path) -> R + Send + Sync>;

/// The steps that can fail, swapped for failing ones in tests.
pub struct Ops {
    pub rename: PairOp<io::Result<()>>,
    /// Both paths swapped in one step; an error where the system or disk cannot.
    pub exchange: PairOp<io::Result<()>>,
    pub remove: PathOp<io::Result<()>>,
    pub free_bytes: PathOp<Option<u64>>,
    /// A rename refused for a moment (Windows, an antivirus reading a new file)
    /// is tried this many times, `pause` apart.
    pub tries: u32,
    pub pause: Duration,
}

impl Ops {
    pub fn real() -> Ops {
        Ops {
            rename: Box::new(|a, b| fs::rename(a, b)),
            exchange: Box::new(exchange),
            remove: Box::new(remove_any),
            free_bytes: Box::new(crate::runtime::free_bytes),
            tries: 15,
            pause: Duration::from_millis(200),
        }
    }

    fn retry(&self, f: impl Fn() -> io::Result<()>) -> io::Result<()> {
        let mut last = f();
        for _ in 1..self.tries.max(1) {
            match &last {
                Err(e) if transient(e) => {}
                _ => break,
            }
            std::thread::sleep(self.pause);
            last = f();
        }
        last
    }

    fn move_to(&self, from: &Path, to: &Path) -> io::Result<()> {
        self.retry(|| (self.rename)(from, to))
    }

    /// The real file system without waits between tries, on a disk that never fills.
    #[cfg(test)]
    pub fn quick() -> Ops {
        Ops { tries: 3, pause: Duration::ZERO, free_bytes: Box::new(|_| Some(u64::MAX)), ..Ops::real() }
    }

    /// Gone, or moved aside to the trash: true once `dir` is free.
    pub(super) fn clear(&self, p: &Paths, dir: &Path) -> bool {
        if fs::symlink_metadata(dir).is_err() {
            return true;
        }
        if (self.remove)(dir).is_ok() || fs::symlink_metadata(dir).is_err() {
            return true;
        }
        (self.rename)(dir, &p.trash()).is_ok()
    }
}

/// Held open for a moment: busy, or Windows' access denied (5) and sharing violation (32).
fn transient(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::ResourceBusy
        || (cfg!(windows)
            && (e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32))))
}

fn remove_any(p: &Path) -> io::Result<()> {
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(p),
        Ok(_) => fs::remove_file(p),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// `renamex_np(RENAME_SWAP)`: both names swapped at once.
#[cfg(target_os = "macos")]
fn exchange(a: &Path, b: &Path) -> io::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let a = std::ffi::CString::new(a.as_os_str().as_bytes())?;
    let b = std::ffi::CString::new(b.as_os_str().as_bytes())?;
    // SAFETY: two NUL-terminated paths that outlive the call.
    match unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// `renameat2(RENAME_EXCHANGE)` as a raw call: glibc before 2.28 has no wrapper.
#[cfg(target_os = "linux")]
fn exchange(a: &Path, b: &Path) -> io::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let a = std::ffi::CString::new(a.as_os_str().as_bytes())?;
    let b = std::ffi::CString::new(b.as_os_str().as_bytes())?;
    // SAFETY: two NUL-terminated paths that outlive the call; nothing else is passed by pointer.
    let rc = unsafe {
        libc::syscall(libc::SYS_renameat2, libc::AT_FDCWD, a.as_ptr(), libc::AT_FDCWD, b.as_ptr(), libc::RENAME_EXCHANGE)
    };
    match rc {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// Windows and the rest: the two renames.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn exchange(_a: &Path, _b: &Path) -> io::Result<()> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// A valid version from a manifest.
fn version_in(m: &Value) -> Option<String> {
    let v = m.get("version")?.as_str()?;
    Version::parse(v).map(|_| v.to_string())
}

fn same_version(a: &str, b: &str) -> bool {
    matches!((Version::parse(a), Version::parse(b)), (Some(x), Some(y)) if x == y)
}

/// The manifest's folder relative to the extension's: "" or its one subfolder.
fn root_of(dir: &Path) -> String {
    manifest_root(dir).strip_prefix(dir).map(|r| r.to_string_lossy().to_string()).unwrap_or_default()
}

/// `dir`'s manifest folder for `root`, with no trailing separator for "".
fn at_root(dir: &Path, root: &str) -> PathBuf {
    if root.is_empty() {
        dir.to_path_buf()
    } else {
        dir.join(root)
    }
}

/// Every file under `dir` with its bytes, Chrome's `_metadata/` and the old
/// `.added` beside the manifest left out: the same before and after Chrome
/// rebuilds its rule index there.
pub fn tree_digest(dir: &Path) -> io::Result<String> {
    let root = manifest_root(dir);
    let skip = [root.join("_metadata"), root.join(source::ADDED)];
    let mut files = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), String::new())];
    while let Some((at, rel)) = stack.pop() {
        for e in fs::read_dir(&at)? {
            let e = e?;
            let name = e.file_name();
            if crate::store::is_os_litter(&name) || skip.contains(&e.path()) {
                continue;
            }
            let child = format!("{rel}/{}", name.to_string_lossy());
            let t = e.file_type()?;
            if t.is_dir() {
                stack.push((e.path(), child));
            } else {
                files.push((child, e.path(), t.is_symlink()));
            }
        }
    }
    files.sort();
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    for (rel, path, link) in files {
        h.update(rel.as_bytes());
        h.update([0]);
        if link {
            h.update(fs::read_link(&path)?.to_string_lossy().as_bytes());
        } else {
            let mut f = fs::File::open(&path)?;
            let mut fh = Sha256::new();
            loop {
                let n = f.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                fh.update(&buf[..n]);
            }
            h.update(fh.finalize());
        }
        h.update([0]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Whole or not at all.
fn write_atomic(tmp: &Path, to: &Path, body: &[u8]) -> io::Result<()> {
    let wrote = (|| {
        let mut f = fs::File::create(tmp)?;
        f.write_all(body)?;
        f.sync_all()?;
        fs::rename(tmp, to)
    })();
    if wrote.is_err() {
        let _ = fs::remove_file(tmp);
    }
    wrote
}

fn read_note(p: &Paths) -> Option<Staged> {
    serde_json::from_slice(&fs::read(p.note()).ok()?).ok()
}

fn write_note(p: &Paths, s: &Staged) -> io::Result<()> {
    let body = serde_json::to_vec_pretty(s).map_err(io::Error::other)?;
    write_atomic(&p.staging().join("staged.tmp"), &p.note(), &body)
}

/// What is staged for `id`, without looking at the tree.
pub fn staged(lib: &Path, id: &str) -> Option<Staged> {
    valid_id(id).then(|| read_note(&Paths::new(lib, id))).flatten()
}

/// The staged tree is all there, as checked.
fn complete(p: &Paths, n: &Staged) -> bool {
    at_root(&p.tree(), &n.root).join("manifest.json").is_file() && tree_digest(&p.tree()).is_ok_and(|d| d == n.digest)
}

/// Extensions whose update waits only for nobody to hold them.
pub fn waiting(lib: &Path) -> Vec<String> {
    dotted_ids(lib)
        .into_iter()
        .filter(|id| Paths::new(lib, id).live().is_dir() && staged(lib, id).is_some_and(|n| n.ready()))
        .collect()
}

/// The person confirmed what the staged version gains.
pub fn approve(lib: &Path, id: &str) -> Result<Staged, Failure> {
    let p = Paths::new(lib, id);
    let mut n = read_note(&p).ok_or_else(|| Failure::new(Kind::Stale, "nothing is staged for this extension"))?;
    n.approved = true;
    write_note(&p, &n).map_err(|e| Failure::new(Kind::Swap, format!("could not record the confirmation: {e}")))?;
    Ok(n)
}

/// The engine here now meets what the staged version asks for: it may go in.
pub fn engine_met(lib: &Path, id: &str) -> Result<Staged, Failure> {
    let p = Paths::new(lib, id);
    let mut n = read_note(&p).ok_or_else(|| Failure::new(Kind::Stale, "nothing is staged for this extension"))?;
    n.needs_engine = None;
    // Sync's own was let in by the computer that built it.
    n.approved |= matches!(n.origin, Origin::Sync(_));
    write_note(&p, &n).map_err(|e| Failure::new(Kind::Swap, format!("could not record the engine: {e}")))?;
    Ok(n)
}

/// The staged update no longer goes in by itself (the store flagged the item
/// while its stage could not be dropped).
pub fn withhold(lib: &Path, id: &str) -> bool {
    let p = Paths::new(lib, id);
    let Some(mut n) = read_note(&p) else { return false };
    n.approved = false;
    write_note(&p, &n).is_ok()
}

/// The staged update dropped (Cancel, or a newer one to fetch).
pub fn cancel(lib: &Path, id: &str, ops: &Ops) -> bool {
    let p = Paths::new(lib, id);
    let Some(_alone) = super::usage::exclusive(id, CLEAR_WAIT) else { return false };
    forget(&p, ops)
}

/// Room for a package of `size`: three times it and a margin.
pub fn room(ops: &Ops, lib: &Path, size: u64) -> Result<(), Failure> {
    let need = size.saturating_mul(3).saturating_add(ROOM_MARGIN);
    match (ops.free_bytes)(lib) {
        Some(free) if free < need => Err(Failure::new(
            Kind::Space,
            format!(
                "Not enough free disk space for the update: it needs about {} MB, and {} MB is free. Free up space and try again.",
                need.div_ceil(MB),
                free / MB
            ),
        )),
        _ => Ok(()),
    }
}

/// Downloads `url` (update2's codebase) and stages it. The live folder is
/// never touched; any failure leaves nothing but it.
pub async fn stage(lib: &Path, id: &str, url: &str, order: Order, ops: Arc<Ops>, progress: Progress) -> Result<Staged, Failure> {
    if !valid_id(id) {
        return Err(Failure::new(Kind::Stale, "invalid extension id"));
    }
    let p = Paths::new(lib, id);
    if let Some(size) = order.size {
        room(&ops, lib, size)?;
    }
    let cap = order.size.map_or(super::DOWNLOAD_MAX, |s| s.saturating_add(MB).min(super::DOWNLOAD_MAX));
    let part = p.part();
    let total = order.size.unwrap_or(0);
    let tell = progress.clone();
    let got = super::fetch(url, &part, &super::update2::user_agent(), cap, &move |n| tell(Phase::Download, n, total)).await;
    if let Err(e) = got {
        let _ = fs::remove_file(&part);
        return Err(Failure::new(Kind::Download, format!("{e:#}")));
    }
    let (lib, id, file) = (lib.to_path_buf(), id.to_string(), part.clone());
    let out = tokio::task::spawn_blocking(move || stage_file(&lib, &id, &file, &order, &ops, &progress))
        .await
        .unwrap_or_else(|e| Err(Failure::new(Kind::Package, format!("the update could not be unpacked: {e}"))));
    let _ = fs::remove_file(&part);
    out
}

/// Stages a downloaded package (a store CRX, or sync's zip) over `id`:
/// checked, unpacked, laid out as the live tree is, its key fitted, and
/// measured against the live one. Any failure leaves no staging behind.
pub fn stage_file(lib: &Path, id: &str, file: &Path, order: &Order, ops: &Ops, progress: &Progress) -> Result<Staged, Failure> {
    if !valid_id(id) {
        return Err(Failure::new(Kind::Stale, "invalid extension id"));
    }
    let p = Paths::new(lib, id);
    let live = p.live();
    let live_root = manifest_root(&live);
    let old = manifest_edit::read_manifest(&live_root)
        .map_err(|e| Failure::new(Kind::Stale, format!("the installed extension cannot be read: {e:#}")))?;
    let from = version_in(&old).ok_or_else(|| Failure::new(Kind::Manifest, "the installed extension has no valid version"))?;
    // An earlier stage goes first, never while it is being applied.
    {
        let _alone = super::usage::exclusive(id, CLEAR_WAIT)
            .ok_or_else(|| Failure::new(Kind::Swap, "the extension is being updated right now; try again in a minute"))?;
        if !forget(&p, ops) {
            return Err(Failure::new(
                Kind::Swap,
                format!("the folder of an earlier update ({}) could not be cleared", p.staging().display()),
            ));
        }
    }
    room(ops, lib, fs::metadata(file).map_or(0, |m| m.len()))?;
    let made = build(&p, file, order, ops, progress, &live_root, &old, from);
    if made.is_err() {
        forget(&p, ops);
    }
    made
}

#[allow(clippy::too_many_arguments)]
fn build(p: &Paths, file: &Path, order: &Order, ops: &Ops, progress: &Progress, live_root: &Path, old: &Value, from: String) -> Result<Staged, Failure> {
    let pkg = |m: String| Failure::new(Kind::Package, m);
    let io_err = |what: &str, e: &dyn std::fmt::Display| Failure::new(Kind::Package, format!("{what}: {e}"));
    progress(Phase::Verify, 0, 0);
    let bytes = fs::read(file).map_err(|e| io_err("the update could not be read", &e))?;
    let side = source::read(&p.lib, &p.id).unwrap_or_default();
    let (offset, signed_item) = match &order.origin {
        Origin::Store(sid) => {
            // Not linked yet (linking by hand stages first): its files are weighed below.
            if side.source.as_ref().is_some_and(|s| *s != SourceRef::webstore(sid)) {
                return Err(Failure::new(Kind::Stale, format!("the extension is linked to another Web Store item, not {sid}")));
            }
            // A key here gives the id: the store's code never runs under another item's.
            if let Ok(manifest_edit::IdBasis::Key(k)) = manifest_edit::id_basis(live_root) {
                let kid = id_from_key(&k);
                if kid != *sid {
                    return Err(Failure::new(Kind::IdConflict, format!("its key gives it the ID {kid}, not the Web Store item {sid}")));
                }
            }
            let expect = order.expect().unwrap_or_default();
            let v = crx::verify(&bytes, &expect).map_err(|r| pkg(format!("the Web Store's package failed its check: {r}")))?;
            (v.archive_offset, v.verified_contents.as_deref().and_then(crx::verified_item))
        }
        Origin::Sync(_) => (super::crx_payload_offset(&bytes).map_err(|e| pkg(format!("{e:#}")))?, None),
    };
    let sha256: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();

    progress(Phase::Unpack, 0, 0);
    let unpack = p.unpack();
    fs::create_dir_all(&unpack).map_err(|e| io_err("could not make the update's folder", &e))?;
    unzip(&bytes[offset..], &unpack).map_err(|e| pkg(format!("the update cannot be unpacked: {e:#}")))?;
    drop(bytes);
    let new_root = manifest_root(&unpack);
    if !new_root.join("manifest.json").is_file() {
        return Err(pkg("the update holds no manifest.json".into()));
    }
    let bad_manifest = |e: anyhow::Error| Failure::new(Kind::Manifest, format!("the new version's manifest.json: {e:#}"));
    let to = version_in(&manifest_edit::read_manifest(&new_root).map_err(bad_manifest)?)
        .ok_or_else(|| Failure::new(Kind::Manifest, "the new version has no valid version"))?;
    if let Some(named) = order.version.as_deref().filter(|v| !same_version(v, &to)) {
        return Err(pkg(format!("the Web Store named version {named} but sent {to}")));
    }

    // The store's signed contents name the item and version; read before `_metadata/` goes.
    let vc = new_root.join("_metadata").join("verified_contents.json");
    let small = fs::metadata(&vc).is_ok_and(|m| m.is_file() && m.len() <= VERIFIED_CONTENTS_MAX);
    let meta_item = small.then(|| fs::read(&vc).ok()).flatten().and_then(|b| crx::verified_item(&b));
    if let Origin::Store(sid) = &order.origin {
        for item in [&signed_item, &meta_item].into_iter().flatten() {
            if item.id != *sid || !same_version(&item.version, &to) {
                return Err(pkg(format!("its signed contents are for {} {}, not {sid} {to}", item.id, item.version)));
            }
        }
    }
    let meta = new_root.join("_metadata");
    if meta.exists() {
        fs::remove_dir_all(&meta).map_err(|e| io_err("could not clear the update's _metadata", &e))?;
    }

    // Laid out as the live tree is: the path Chrome hashes stays the same.
    let root = root_of(&p.live());
    let tree = p.tree();
    let staged_root = at_root(&tree, &root);
    if !root.is_empty() {
        fs::create_dir_all(&tree).map_err(|e| io_err("could not lay out the update", &e))?;
    }
    ops.move_to(&new_root, &staged_root).map_err(|e| io_err("could not lay out the update", &e))?;
    ops.clear(p, &unpack);

    let old_basis = manifest_edit::id_basis(live_root).map_err(|e| Failure::new(Kind::Manifest, format!("{e:#}")))?;
    let key = match &order.origin {
        // Only the builder fits the key (design §3.3.2).
        Origin::Store(_) => manifest_edit::fit_manifest(&staged_root, &old_basis).map_err(bad_manifest)?,
        Origin::Sync(_) => {
            let new_basis = manifest_edit::id_basis(&staged_root).map_err(bad_manifest)?;
            if new_basis != old_basis {
                return Err(Failure::new(
                    Kind::IdConflict,
                    "the version from the other computer would change this extension's ID here, so it was not applied",
                ));
            }
            match new_basis {
                manifest_edit::IdBasis::Key(_) => KeyAction::Kept,
                manifest_edit::IdBasis::Path => KeyAction::None,
            }
        }
    };
    let new = manifest_edit::read_manifest(&staged_root).map_err(bad_manifest)?;
    match &order.origin {
        Origin::Store(_) if !newer(&to, &from) => {
            return Err(Failure::new(Kind::NotNewer, format!("version {to} is not newer than the installed {from}")))
        }
        Origin::Sync(_) if newer(&from, &to) => {
            return Err(Failure::new(Kind::NotNewer, format!("version {to} from the other computer is older than {from} here")))
        }
        _ => {}
    }
    let needs_engine = new
        .get("minimum_chrome_version")
        .and_then(Value::as_str)
        .filter(|min| order.engine.as_deref().is_some_and(|e| newer(min, e)))
        .map(str::to_string);

    // Weakly linked: the files have to say it is the same extension.
    let weak = !side.how.is_some_and(source::How::strong);
    let identity = match &order.origin {
        Origin::Store(_) if weak && !order.weighed => {
            let overlap = manifest_edit::overlap(live_root, &staged_root).unwrap_or(0.0);
            let same_name = manifest_edit::name_same(live_root, &staged_root);
            (manifest_edit::kinship(overlap, same_name) != Kinship::Same).then(|| Identity {
                overlap,
                names: Names {
                    old: manifest_edit::display_name(live_root).unwrap_or_default(),
                    new: manifest_edit::display_name(&staged_root).unwrap_or_default(),
                },
            })
        }
        _ => None,
    };
    let grown = manifest_edit::perm_growth(old, &new);
    let digest = tree_digest(&tree).map_err(|e| io_err("could not read the update back", &e))?;
    let confirmed = matches!(order.origin, Origin::Sync(_)) || (grown.is_empty() && identity.is_none());
    let staged = Staged {
        approved: order.approve && confirmed && needs_engine.is_none(),
        from,
        to,
        sha256,
        origin: order.origin.clone(),
        key,
        root,
        grown,
        identity,
        needs_engine,
        store_item: signed_item.or(meta_item),
        digest,
        at: now_secs(),
    };
    write_note(p, &staged).map_err(|e| io_err("could not finish staging the update", &e))?;
    Ok(staged)
}

/// What a store package's files say of the live tree (design §3.1.5).
#[derive(Debug, Clone, PartialEq)]
pub struct Weighed {
    pub overlap: f64,
    pub same_name: bool,
    pub names: Names,
    /// The package's version.
    pub version: String,
}

/// The store's package for `order`, checked and unpacked beside the live tree
/// only to be compared with it; nothing of it stays.
pub fn weigh(lib: &Path, id: &str, file: &Path, order: &Order, ops: &Ops) -> Result<Weighed, Failure> {
    let pkg = |m: String| Failure::new(Kind::Package, m);
    if !valid_id(id) {
        return Err(Failure::new(Kind::Stale, "invalid extension id"));
    }
    let p = Paths::new(lib, id);
    let live_root = manifest_root(&p.live());
    if !live_root.join("manifest.json").is_file() {
        return Err(Failure::new(Kind::Stale, "the extension is no longer in the library"));
    }
    let expect = order.expect().ok_or_else(|| pkg("only a Web Store package can be weighed".into()))?;
    let bytes = fs::read(file).map_err(|e| pkg(format!("the package could not be read: {e}")))?;
    let v = crx::verify(&bytes, &expect).map_err(|r| pkg(format!("the Web Store's package failed its check: {r}")))?;
    let dir = p.dot("weigh");
    if !ops.clear(&p, &dir) {
        return Err(Failure::new(Kind::Swap, format!("an earlier comparison's folder ({}) could not be cleared", dir.display())));
    }
    let weighed = (|| {
        fs::create_dir_all(&dir).map_err(|e| pkg(format!("could not make a folder to compare in: {e}")))?;
        unzip(&bytes[v.archive_offset..], &dir).map_err(|e| pkg(format!("the package cannot be unpacked: {e:#}")))?;
        let new_root = manifest_root(&dir);
        let m = manifest_edit::read_manifest(&new_root).map_err(|e| Failure::new(Kind::Manifest, format!("its manifest.json: {e:#}")))?;
        let version = version_in(&m).ok_or_else(|| Failure::new(Kind::Manifest, "the package has no valid version"))?;
        if let Some(named) = order.version.as_deref().filter(|v| !same_version(v, &version)) {
            return Err(pkg(format!("the Web Store named version {named} but sent {version}")));
        }
        Ok(Weighed {
            overlap: manifest_edit::overlap(&live_root, &new_root).unwrap_or(0.0),
            same_name: manifest_edit::name_same(&live_root, &new_root),
            names: Names {
                old: manifest_edit::display_name(&live_root).unwrap_or_default(),
                new: manifest_edit::display_name(&new_root).unwrap_or_default(),
            },
            version,
        })
    })();
    ops.clear(&p, &dir);
    weighed
}

/// The staging folder gone, its note first so it is never taken for complete.
fn forget(p: &Paths, ops: &Ops) -> bool {
    let _ = fs::remove_file(p.note());
    ops.clear(p, &p.staging())
}

/// Swaps the staged tree in at the live path. Refused, with the stage dropped,
/// when the live folder changed since staging or the tree is no longer whole.
/// The caller makes sure nothing holds the extension (`usage::try_apply`).
pub fn apply(lib: &Path, id: &str, ops: &Ops) -> Result<Applied, Failure> {
    let p = Paths::new(lib, id);
    let note = read_note(&p).ok_or_else(|| Failure::new(Kind::Stale, "nothing is staged for this extension"))?;
    // A failed swap's folder back first, so the stage still fits it.
    put_back(&p, ops);
    if let Err(f) = fits(&p, &note) {
        forget(&p, ops);
        return Err(f);
    }
    let live = p.live();
    let atomic = match ops.retry(|| (ops.exchange)(&p.tree(), &live)) {
        Ok(()) => true,
        Err(e) => {
            if e.kind() != io::ErrorKind::Unsupported {
                eprintln!("[extensions] {id}: no one-step swap here ({e}); two renames instead");
            }
            two_renames(&p, ops)?;
            false
        }
    };
    keep_prev(&p, &if atomic { p.tree() } else { p.prev_new() }, &note.from, ops);
    forget(&p, ops);
    record(&p, &note);
    Ok(Applied { from: note.from, to: note.to, atomic })
}

/// The live folder is still what was staged against, and the stage is whole.
fn fits(p: &Paths, note: &Staged) -> Result<(), Failure> {
    let stale = |m: &str| Err(Failure::new(Kind::Stale, m));
    let live = p.live();
    let live_root = manifest_root(&live);
    let Ok(old) = manifest_edit::read_manifest(&live_root) else {
        return stale("the extension is no longer in the library");
    };
    if root_of(&live) != note.root {
        return stale("the extension's folder was laid out anew since the update was downloaded");
    }
    if version_in(&old).as_deref() != Some(note.from.as_str()) {
        return stale("another version was installed since the update was downloaded");
    }
    if !complete(p, note) {
        return stale("the downloaded update is no longer complete (an antivirus may have removed a file); it is downloaded again on the next try");
    }
    let basis = |root: &Path| manifest_edit::id_basis(root).ok();
    if basis(&live_root) != basis(&at_root(&p.tree(), &note.root)) {
        return Err(Failure::new(Kind::IdConflict, "the update would change the extension's ID, so it was not applied"));
    }
    Ok(())
}

/// Live → `.prev.new`, staged → live, the first put back if the second fails.
fn two_renames(p: &Paths, ops: &Ops) -> Result<(), Failure> {
    let (live, aside, tree) = (p.live(), p.prev_new(), p.tree());
    // One an earlier apply could not finish.
    if aside.exists() {
        keep_prev(p, &aside, "", ops);
        if aside.exists() {
            return Err(Failure::new(Kind::Swap, format!("an earlier update's folder ({}) could not be cleared", aside.display())));
        }
    }
    ops.move_to(&live, &aside).map_err(|e| {
        Failure::new(Kind::Swap, format!("the extension's folder is in use ({e}); the update is kept and goes in on the next try"))
    })?;
    if let Err(e) = ops.move_to(&tree, &live) {
        if ops.move_to(&aside, &live).is_err() {
            return Err(Failure::new(
                Kind::Swap,
                format!("the update failed ({e}), and the installed version could not be put back yet; it is put back the next time Octopus Agent starts"),
            ));
        }
        return Err(Failure::new(Kind::Swap, format!("the update failed ({e}); the installed version is unchanged and the update is kept")));
    }
    Ok(())
}

/// The live folder a failed fallback left at `.prev.new` put back; the caller
/// holds the extension alone. True when it moved.
pub fn put_back(p: &Paths, ops: &Ops) -> bool {
    let (live, aside) = (p.live(), p.prev_new());
    if fs::symlink_metadata(&live).is_ok() || !aside.is_dir() {
        return false;
    }
    match ops.move_to(&aside, &live) {
        Ok(()) => {
            eprintln!("[extensions] {}: the installed version is back in place", p.id);
            true
        }
        Err(e) => {
            eprintln!("[extensions] {}: the installed version could not be put back yet: {e}", p.id);
            false
        }
    }
}

/// Every such folder put back in this session, not only at the next start;
/// one whose swap is still under way is left to it.
pub fn put_back_all(lib: &Path, ops: &Ops) -> usize {
    dotted_ids(lib)
        .into_iter()
        .filter(|id| {
            let p = Paths::new(lib, id);
            !p.live().exists() && p.prev_new().is_dir()
        })
        .filter(|id| super::usage::exclusive(id, Duration::ZERO).is_some_and(|_alone| put_back(&Paths::new(lib, id), ops)))
        .count()
}

#[derive(Serialize, Deserialize)]
struct PrevNote {
    at: u64,
    version: String,
}

/// `old` becomes `.prev`, replacing the one before; what cannot be kept goes.
fn keep_prev(p: &Paths, old: &Path, version: &str, ops: &Ops) {
    let _ = fs::remove_file(p.prev_note());
    if !ops.clear(p, &p.prev()) || ops.move_to(old, &p.prev()).is_err() {
        // Never left where it could be taken for an update.
        ops.clear(p, old);
        return;
    }
    let version = if version.is_empty() { tree_version(&p.prev()) } else { version.to_string() };
    write_prev_note(p, &version);
}

fn write_prev_note(p: &Paths, version: &str) {
    let body = serde_json::json!({ "at": now_secs(), "version": version }).to_string();
    let _ = write_atomic(&p.dot("prev.tmp"), &p.prev_note(), body.as_bytes());
}

fn tree_version(dir: &Path) -> String {
    manifest_edit::read_manifest(&manifest_root(dir)).ok().as_ref().and_then(version_in).unwrap_or_default()
}

/// The side file learns what sync laid down and what the store's contents named.
fn record(p: &Paths, note: &Staged) {
    let mut side = source::read(&p.lib, &p.id).unwrap_or_default();
    let before = side.clone();
    if let Origin::Sync(rev) = note.origin {
        side.applied_package_rev = Some(rev);
        side.refused_package_rev = None;
        // Another computer's package: a source its files prove, when none is known here.
        if side.source.is_none() {
            let found = source::recover(&manifest_root(&p.live()));
            let item = note.store_item.as_ref().filter(|_| found.source.is_none());
            side.source = found.source.or_else(|| item.map(|i| SourceRef::webstore(&i.id)));
            side.how = found.how.or(item.map(|_| source::How::VerifiedContents));
        }
    }
    if note.store_item.is_some() {
        side.store_item = note.store_item.clone();
    }
    if side != before {
        if let Err(e) = source::write(&p.lib, &p.id, &side) {
            eprintln!("[extensions] {}: side file not updated: {e:#}", p.id);
        }
    }
}

/// What a sweep did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Swept {
    /// Live folders put back from `.prev.new`.
    pub restored: usize,
    /// Swaps a dead launcher left untidied, finished.
    pub finished: usize,
    /// Complete stages left waiting.
    pub kept: usize,
    pub removed: usize,
}

/// The ids that have anything of ours beside their folder.
fn dotted_ids(lib: &Path) -> BTreeSet<String> {
    let Ok(rd) = fs::read_dir(lib) else { return BTreeSet::new() };
    rd.flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let (id, rest) = name.strip_prefix('.')?.split_once('.')?;
            (valid_id(id) && ours(rest)).then(|| id.to_string())
        })
        .collect()
}

fn ours(rest: &str) -> bool {
    matches!(rest, "part" | "staging" | "weigh" | "prev" | "prev.json" | "prev.tmp" | "prev.new" | "zip" | "new" | "source.tmp")
        || rest.starts_with("trash-")
}

/// At start, before any profile can: swaps a dead launcher left half done are
/// undone or finished, incomplete stages and leftovers removed, `.prev` older
/// than a week dropped. A complete stage stays.
pub fn sweep(lib: &Path, ops: &Ops) -> Swept {
    let mut s = Swept::default();
    for id in dotted_ids(lib) {
        sweep_one(&Paths::new(lib, &id), ops, &mut s);
    }
    s
}

fn sweep_one(p: &Paths, ops: &Ops, s: &mut Swept) {
    // The fallback's renames: undone with the live folder missing, finished with it there.
    if p.prev_new().exists() {
        if !p.live().exists() {
            if ops.move_to(&p.prev_new(), &p.live()).is_ok() {
                s.restored += 1;
            }
        } else {
            keep_prev(p, &p.prev_new(), "", ops);
            s.finished += 1;
        }
    }
    let live = p.live().is_dir();
    if p.staging().exists() {
        match read_note(p) {
            Some(n) if live && complete(p, &n) => s.kept += 1,
            // Exchanged, then the launcher died: staging holds the tree before.
            Some(n) if live && p.tree().is_dir() && tree_digest(&p.live()).is_ok_and(|d| d == n.digest) => {
                keep_prev(p, &p.tree(), &n.from, ops);
                forget(p, ops);
                s.finished += 1;
            }
            _ => {
                forget(p, ops);
                s.removed += 1;
            }
        }
    }
    if p.prev().exists() {
        let note: Option<PrevNote> = fs::read(p.prev_note()).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let orphan = !live && !p.prev_new().exists();
        match note {
            _ if orphan => {
                ops.clear(p, &p.prev());
                let _ = fs::remove_file(p.prev_note());
                s.removed += 1;
            }
            Some(n) if now_secs().saturating_sub(n.at) > PREV_KEEP.as_secs() => {
                ops.clear(p, &p.prev());
                let _ = fs::remove_file(p.prev_note());
                s.removed += 1;
            }
            // Its week starts now.
            None => write_prev_note(p, &tree_version(&p.prev())),
            Some(_) => {}
        }
    } else if p.prev_note().exists() {
        let _ = fs::remove_file(p.prev_note());
    }
    for rest in ["part", "weigh", "zip", "new", "source.tmp", "prev.tmp"] {
        let leftover = p.dot(rest);
        if fs::symlink_metadata(&leftover).is_ok() {
            let _ = remove_any(&leftover);
            s.removed += 1;
        }
    }
    let trash = format!(".{}.trash-", p.id);
    for e in fs::read_dir(&p.lib).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with(&trash) {
            let _ = (ops.remove)(&e.path());
            s.removed += 1;
        }
    }
}

#[cfg(test)]
mod tests;
