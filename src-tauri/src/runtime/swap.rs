//! The engine folder is replaced whole and never emptied first (#122). A new
//! tree is unpacked beside it, checked, and swapped in by two renames; any
//! step that fails leaves the engine that was there.
//!
//! Beside the live `<root>` in the runtime folder:
//!   `.<root>.staging/unpack`  where the archive is unpacked and checked
//!   `.<root>.staging/<root>`  the new tree; `staged.json` once it is complete
//!   `.<root>.old`             the previous tree, between the two renames
//!   `.<root>.swap.json`       the swap under way; only it lets `.old` back
//!   `.<root>.trash-*`         what could not be removed yet (next start)
//!   `<key>.part`              a download under way
//!   `<key>.download(.json)`   a complete download, kept until it is unpacked

use super::os::{self, Holders};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Room kept free beyond what the unpacked engine takes.
pub const SPACE_MARGIN: u64 = 256 << 20;
/// Unpacked bytes per archive byte, guessed before the archive is in.
pub const UNPACK_GUESS: u64 = 3;
/// The longest wait between two tries of a refused rename.
const MAX_PAUSE: Duration = Duration::from_secs(2);

/// Where the archive leaves the engine's version. Each host builds one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum Marker {
    /// `ShardX.app/.../ShardX Framework.framework/Versions/<version>/`.
    MacFramework,
    /// `<version>.manifest` beside chrome.exe.
    WinManifest,
    None,
}

#[derive(Clone, Debug)]
pub struct Layout {
    pub base: PathBuf,
    /// The engine folder's name, also the archive's top folder.
    pub root: String,
    /// Archive key on the CDN.
    pub key: String,
    /// The engine binary, inside `root`.
    pub binary: PathBuf,
    pub marker: Marker,
}

impl Layout {
    pub fn host(base: PathBuf, key: &str) -> Layout {
        #[cfg(target_os = "macos")]
        let (root, binary, marker) =
            ("ShardX-Mac-arm64", "ShardX.app/Contents/MacOS/ShardX", Marker::MacFramework);
        #[cfg(target_os = "windows")]
        let (root, binary, marker) = ("ShardX-Windows", "chrome.exe", Marker::WinManifest);
        #[cfg(target_os = "linux")]
        let (root, binary, marker) = ("ShardX-Linux", "chrome", Marker::None);
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let (root, binary, marker) = ("ShardX-Engine", "shardx", Marker::None);
        Layout { base, root: root.into(), key: key.into(), binary: binary.into(), marker }
    }

    pub fn live(&self) -> PathBuf {
        self.base.join(&self.root)
    }
    pub fn staging(&self) -> PathBuf {
        self.base.join(format!(".{}.staging", self.root))
    }
    pub fn staged_tree(&self) -> PathBuf {
        self.staging().join(&self.root)
    }
    fn unpack(&self) -> PathBuf {
        self.staging().join("unpack")
    }
    fn staged_note(&self) -> PathBuf {
        self.staging().join("staged.json")
    }
    pub fn old(&self) -> PathBuf {
        self.base.join(format!(".{}.old", self.root))
    }
    fn journal(&self) -> PathBuf {
        self.base.join(format!(".{}.swap.json", self.root))
    }
    fn trash_prefix(&self) -> String {
        format!(".{}.trash-", self.root)
    }
    fn trash(&self) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        self.base.join(format!("{}{n}", self.trash_prefix()))
    }
    pub fn part(&self) -> PathBuf {
        self.base.join(format!("{}.part", self.key))
    }
    pub fn archive(&self) -> PathBuf {
        self.base.join(format!("{}.download", self.key))
    }
    fn archive_note(&self) -> PathBuf {
        self.base.join(format!("{}.download.json", self.key))
    }
    /// What launchers before #122 downloaded into.
    fn legacy_tmp(&self) -> PathBuf {
        self.base.join(format!("{}.tmp", self.key))
    }
}

/// A complete download.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Downloaded {
    pub etag: String,
    pub size: u64,
}

/// A complete, checked tree waiting in staging.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Staged {
    pub etag: String,
    /// Files (and links) under the tree, counted once it checked out.
    pub files: u64,
    /// The version its marker names, where the platform has one.
    pub version: Option<String>,
}

/// What the launcher records for a tree once it is live.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Record {
    pub etag: String,
    pub version: Option<String>,
    pub build: Option<String>,
}

/// Written before the first rename, dropped once the record is saved. Only an
/// unfinished one puts `.old` back: a copy a cleanup left half removed never
/// stands in for a missing engine.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Journal {
    /// Files in the live tree as it was moved aside.
    pub old_files: u64,
    pub record: Record,
    /// The new tree is live; its record is what is left to save.
    pub done: bool,
}

pub fn journal(layout: &Layout) -> Option<Journal> {
    serde_json::from_str(&fs::read_to_string(layout.journal()).ok()?).ok()
}

/// Whole or not at all, and on disk before the rename it announces.
fn write_journal(layout: &Layout, j: &Journal) -> io::Result<()> {
    use io::Write;
    let tmp = layout.base.join(format!(".{}.swap.tmp", layout.root));
    let mut f = fs::File::create(&tmp)?;
    f.write_all(serde_json::to_string(j).unwrap_or_default().as_bytes())?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, layout.journal())
}

/// The record of a tree a swap put live and nobody saved yet. A journal not
/// marked done still counts once the staged tree is gone from beside its note:
/// only the second rename moves it.
pub fn finished(layout: &Layout) -> Option<Record> {
    let j = journal(layout)?;
    if !layout.live().exists() {
        return None;
    }
    let moved = || {
        !layout.staged_tree().exists() && staged_note(layout).is_some_and(|n| n.etag == j.record.etag)
    };
    (j.done || moved()).then_some(j.record)
}

/// The swap is recorded, or undone.
pub fn settle(layout: &Layout) {
    let _ = fs::remove_file(layout.journal());
}

/// `.old` is the whole engine an unfinished swap moved aside, and none is live.
fn returnable(layout: &Layout) -> bool {
    let old = layout.old();
    !layout.live().exists()
        && old.exists()
        && journal(layout).is_some_and(|j| !j.done && count_files(&old) == j.old_files)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Download,
    Space,
    Extract,
    Verify,
    Busy,
    Swap,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub stage: Stage,
    pub message: String,
    /// Browsers found running from the engine folder (Busy only).
    pub browsers: u32,
    /// Profile starts under way here (Busy only).
    pub starting: u32,
}

impl Failure {
    pub fn new(stage: Stage, message: impl Into<String>) -> Failure {
        Failure { stage, message: message.into(), browsers: 0, starting: 0 }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Failure {}

impl Stage {
    pub fn name(self) -> &'static str {
        match self {
            Stage::Download => "download",
            Stage::Space => "space",
            Stage::Extract => "extract",
            Stage::Verify => "verify",
            Stage::Busy => "busy",
            Stage::Swap => "swap",
        }
    }
}

type PathOp<R> = Box<dyn Fn(&Path) -> R + Send + Sync>;
type PairOp<R> = Box<dyn Fn(&Path, &Path) -> R + Send + Sync>;

/// The steps that can fail, swapped for failing ones in tests.
pub struct Ops {
    pub extract: PairOp<Result<()>>,
    pub free_bytes: PathOp<Option<u64>>,
    pub holders: PathOp<Holders>,
    /// Launches under way (a browser about to start from the engine).
    pub starting: Box<dyn Fn() -> usize + Send + Sync>,
    pub rename: PairOp<io::Result<()>>,
    pub remove: PathOp<io::Result<()>>,
    /// A rename Windows refuses for a moment (an antivirus reading a new file)
    /// is tried this many times, from `pause` apart, doubling up to `MAX_PAUSE`.
    pub tries: u32,
    pub pause: Duration,
}

impl Ops {
    /// The real file system, unzip, process table and disk.
    pub fn real(layout: &Layout) -> Ops {
        let binary = layout.live().join(&layout.binary);
        Ops {
            extract: Box::new(unzip),
            free_bytes: Box::new(os::free_bytes),
            holders: Box::new(move |live| {
                let mut h = os::holders(live, &binary);
                // Profiles started on this engine count even where the scan cannot see them.
                let tracked = if super::bundled_engine_in_use() {
                    crate::process::Tracker::shared().running().len()
                } else {
                    0
                };
                h.untracked = h.browsers.saturating_sub(tracked);
                h.browsers = h.browsers.max(tracked);
                h
            }),
            starting: Box::new(crate::launch::in_flight),
            rename: Box::new(|a, b| fs::rename(a, b)),
            remove: Box::new(|p| fs::remove_dir_all(p)),
            // About 11 s in all.
            tries: 10,
            pause: Duration::from_millis(100),
        }
    }

    /// `f` again while it is refused for a moment; any other error at once.
    fn retry(&self, f: impl Fn() -> io::Result<()>) -> io::Result<()> {
        let mut pause = self.pause;
        let mut last = f();
        for _ in 1..self.tries.max(1) {
            match &last {
                Err(e) if transient(e) => {}
                _ => break,
            }
            std::thread::sleep(pause);
            pause = (pause * 2).min(MAX_PAUSE);
            last = f();
        }
        last
    }

    /// The folder gone, or moved aside to the trash: true once `dir` is free.
    fn clear(&self, layout: &Layout, dir: &Path) -> bool {
        if !dir.exists() {
            return true;
        }
        if (self.remove)(dir).is_ok() || !dir.exists() {
            return true;
        }
        (self.rename)(dir, &layout.trash()).is_ok()
    }
}

/// A file held open for now: Windows' access denied (5) or sharing violation (32).
fn transient(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::ResourceBusy
        || (cfg!(windows)
            && (e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32))))
}

/// Whether `free` bytes fit `need`; the message names both.
pub fn room(ops: &Ops, dir: &Path, need: u64) -> Result<(), Failure> {
    match (ops.free_bytes)(dir) {
        Some(free) if free < need => Err(Failure::new(
            Stage::Space,
            format!(
                "Not enough free disk space to update the browser engine: it needs about {}, and {} is free on the disk with {}. Free up space and try again; the engine you have was not touched.",
                mb(need),
                mb(free),
                dir.display()
            ),
        )),
        _ => Ok(()),
    }
}

fn mb(n: u64) -> String {
    format!("{} MB", n.div_ceil(1 << 20))
}

/// The version a tree's marker names.
pub fn version_in(tree: &Path, marker: Marker) -> Option<String> {
    match marker {
        Marker::MacFramework => {
            let versions = tree
                .join("ShardX.app/Contents/Frameworks/ShardX Framework.framework/Versions");
            fs::read_dir(versions).ok()?.flatten().find_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                (name != "Current" && name.starts_with(|c: char| c.is_ascii_digit())).then_some(name)
            })
        }
        // The stem has to read as a dotted version, so a stray file cannot pass.
        Marker::WinManifest => fs::read_dir(tree).ok()?.flatten().find_map(|e| {
            let p = e.path();
            (p.extension().and_then(|s| s.to_str()) == Some("manifest"))
                .then(|| p.file_stem().and_then(|s| s.to_str()).map(str::to_string))
                .flatten()
                .filter(|s| s.split('.').count() >= 2 && s.starts_with(|c: char| c.is_ascii_digit()))
        }),
        Marker::None => None,
    }
}

/// The binary there and not empty, and the version marker where there is one.
pub fn verify(layout: &Layout, tree: &Path) -> Result<Option<String>, String> {
    let bin = tree.join(&layout.binary);
    match fs::metadata(&bin) {
        Ok(m) if m.is_file() && m.len() > 0 => {}
        _ => return Err(format!("the engine has no {}", Path::new(&layout.root).join(&layout.binary).display())),
    }
    let version = version_in(tree, layout.marker);
    if layout.marker != Marker::None && version.is_none() {
        return Err("the engine has no version marker".into());
    }
    Ok(version)
}

/// Files and links under `dir`, links not followed.
pub fn count_files(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => count_files(&e.path()),
            Ok(_) => 1,
            Err(_) => 0,
        })
        .sum()
}

/// What the archive's own table of contents says it holds.
struct Index {
    /// Files under the engine's folder, relative to the staging folder.
    files: Vec<String>,
    unpacked: u64,
}

fn index(archive: &Path, layout: &Layout) -> Result<Index> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive)?)?;
    let top = format!("{}/", layout.root);
    let mut files = Vec::new();
    let mut unpacked = 0u64;
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i)?;
        unpacked = unpacked.saturating_add(f.size());
        // Zips made on Windows write backslashes.
        let name = f.name().replace('\\', "/");
        if name.starts_with(&top) && !name.ends_with('/') && !f.is_dir() {
            files.push(name);
        }
    }
    Ok(Index { files, unpacked })
}

/// A complete download kept from an earlier try.
pub fn downloaded(layout: &Layout) -> Option<Downloaded> {
    let note: Downloaded = serde_json::from_str(&fs::read_to_string(layout.archive_note()).ok()?).ok()?;
    let len = fs::metadata(layout.archive()).ok()?.len();
    (len == note.size && len > 0).then_some(note)
}

/// Takes the finished `.part` as the download.
pub fn keep_download(layout: &Layout, etag: &str) -> io::Result<Downloaded> {
    let _ = fs::remove_file(layout.archive_note());
    fs::rename(layout.part(), layout.archive())?;
    let note = Downloaded { etag: etag.to_string(), size: fs::metadata(layout.archive())?.len() };
    fs::write(layout.archive_note(), serde_json::to_string(&note).unwrap_or_default())?;
    Ok(note)
}

/// The download dropped: damaged, unpacked already, or about to be replaced.
pub fn drop_download(layout: &Layout) {
    // The note first: an archive without one is never taken for complete.
    let _ = fs::remove_file(layout.archive_note());
    let _ = fs::remove_file(layout.archive());
    let _ = fs::remove_file(layout.part());
}

/// A staged tree from an earlier try, still complete.
pub fn staged(layout: &Layout) -> Option<Staged> {
    let note = staged_note(layout)?;
    let tree = layout.staged_tree();
    (verify(layout, &tree).is_ok() && count_files(&tree) == note.files).then_some(note)
}

/// The staging folder gone, or moved to the trash.
pub fn drop_staging(layout: &Layout, ops: &Ops) -> Result<(), Failure> {
    if ops.clear(layout, &layout.staging()) {
        return Ok(());
    }
    Err(Failure::new(
        Stage::Extract,
        format!("The folder of an earlier update ({}) could not be cleared. Close programs using it and try again.", layout.staging().display()),
    ))
}

/// Its note alone, without walking the tree.
pub fn staged_note(layout: &Layout) -> Option<Staged> {
    serde_json::from_str(&fs::read_to_string(layout.staged_note()).ok()?).ok()
}

/// Unpacks the download into staging and checks the tree. The archive goes
/// once the tree checks out; it stays when the disk was too full to try, or
/// the checked tree could not be moved yet.
pub fn stage(layout: &Layout, dl: &Downloaded, ops: &Ops) -> Result<Staged, Failure> {
    let archive = layout.archive();
    let staging = layout.staging();
    let tree = layout.staged_tree();
    let index = match index(&archive, layout) {
        Ok(i) => i,
        Err(e) => {
            drop_download(layout);
            return Err(Failure::new(
                Stage::Verify,
                format!("The downloaded engine archive is damaged ({e}). It was removed; try again to download it anew."),
            ));
        }
    };
    let entry = format!("{}/{}", layout.root, layout.binary.to_string_lossy().replace('\\', "/"));
    if !index.files.contains(&entry) {
        drop_download(layout);
        return Err(Failure::new(
            Stage::Verify,
            format!("The downloaded engine archive has no {entry}. The engine you have was not touched."),
        ));
    }
    // An earlier try's folder goes first: its room counts.
    drop_staging(layout, ops)?;
    room(ops, &layout.base, index.unpacked.saturating_add(SPACE_MARGIN))?;

    let failed = |stage: Stage, message: String| {
        ops.clear(layout, &staging);
        drop_download(layout);
        Err(Failure::new(stage, message))
    };
    let unpack = layout.unpack();
    if let Err(e) = fs::create_dir_all(&unpack) {
        return failed(Stage::Extract, format!("Could not create {}: {e}", unpack.display()));
    }
    if let Err(e) = (ops.extract)(&archive, &unpack) {
        return failed(
            Stage::Extract,
            format!("Unpacking the engine update failed ({e:#}). The engine you have was not touched."),
        );
    }
    let unpacked = unpack.join(&layout.root);
    #[cfg(unix)]
    super::fix_unix_exec_bits(&unpacked);
    if let Some(gone) = index.files.iter().find(|f| fs::symlink_metadata(unpack.join(f)).is_err()) {
        return failed(
            Stage::Verify,
            format!("The unpacked engine update is missing {gone}; an antivirus may have removed it. Allow the engine folder and try again. The engine you have was not touched."),
        );
    }
    let version = match verify(layout, &unpacked) {
        Ok(v) => v,
        Err(why) => return failed(Stage::Verify, format!("The engine update is incomplete: {why}. The engine you have was not touched.")),
    };
    // Moved once before anything live is: a file an antivirus still holds
    // refuses this rename rather than the swap's. The download stays for that.
    if let Err(e) = ops.retry(|| (ops.rename)(&unpacked, &tree)) {
        ops.clear(layout, &staging);
        return Err(Failure::new(
            Stage::Extract,
            format!("The unpacked engine update is still held by another program ({e}); an antivirus may be checking it. Try again in a minute. The engine you have was not touched."),
        ));
    }
    let staged = Staged { etag: dl.etag.clone(), files: count_files(&tree), version };
    if let Err(e) = fs::write(layout.staged_note(), serde_json::to_string(&staged).unwrap_or_default()) {
        return failed(Stage::Extract, format!("Could not finish unpacking the engine update: {e}"));
    }
    drop_download(layout);
    Ok(staged)
}

fn busy(h: Holders, starting: usize) -> Failure {
    let n = h.browsers;
    let mut message = if starting > 0 {
        "The engine update is ready, but a profile is starting. Wait for it, close the profiles that are running, and try again.".to_string()
    } else if n == 1 {
        "The engine update is ready, but 1 profile is still running on the current engine. Close it and try again.".to_string()
    } else if n > 1 {
        format!("The engine update is ready, but {n} profiles are still running on the current engine. Close them and try again.")
    } else {
        format!(
            "The engine update is ready, but {} browser process{} still running from the engine folder. Close {} (or restart the computer) and try again.",
            h.processes,
            if h.processes == 1 { " is" } else { "es are" },
            if h.processes == 1 { "it" } else { "them" },
        )
    };
    // Browsers Octopus Agent does not list: left by an earlier session.
    if starting == 0 && n > 0 && h.untracked > 0 {
        message.push_str(" If Octopus Agent shows none running, one is left from an earlier session: end it in Task Manager (Activity Monitor on a Mac) or restart the computer.");
    }
    Failure { stage: Stage::Busy, message, browsers: n as u32, starting: starting as u32 }
}

/// Live → `.old`, staged → live; the first put back if the second fails.
/// Refused while anything runs from the live tree. The staged tree stays for a
/// retry whenever the live one is left in place. `record` rides in the journal
/// until the caller has saved it (`settle`).
pub fn swap(layout: &Layout, ops: &Ops, record: &Record) -> Result<(), Failure> {
    let (live, old, tree) = (layout.live(), layout.old(), layout.staged_tree());
    if staged(layout).is_none() {
        ops.clear(layout, &layout.staging());
        return Err(Failure::new(
            Stage::Verify,
            "The unpacked engine update is no longer complete (an antivirus may have removed a file). It is downloaded again on the next try.",
        ));
    }
    if old.exists() && !restore(layout, ops) {
        if returnable(layout) {
            // The previous engine, still held: nothing moves until it is back.
            return Err(Failure::new(
                Stage::Swap,
                format!("The previous engine in {} could not be put back yet. Close every browser window that Octopus Agent opened and try again.", old.display()),
            ));
        }
        // Not an engine to go back to: a copy an earlier cleanup left.
        if !ops.clear(layout, &old) && live.exists() {
            return Err(Failure::new(
                Stage::Swap,
                format!("A copy of an earlier engine ({}) could not be removed. Delete it and try again.", old.display()),
            ));
        }
    }
    let starting = (ops.starting)();
    let holders = if live.exists() { (ops.holders)(&live) } else { Holders::default() };
    if starting > 0 || holders.any() {
        return Err(busy(holders, starting));
    }
    let had_live = live.exists();
    let mut journal = Journal { old_files: 0, record: record.clone(), done: false };
    if had_live {
        journal.old_files = count_files(&live);
        if let Err(e) = write_journal(layout, &journal) {
            return Err(Failure::new(
                Stage::Swap,
                format!("Could not start replacing the engine ({e}). The engine you have was not changed; the update is kept."),
            ));
        }
        if let Err(e) = ops.retry(|| (ops.rename)(&live, &old)) {
            settle(layout);
            return Err(Failure::new(
                Stage::Swap,
                format!("The engine folder is in use and could not be replaced ({e}). Close every browser window that Octopus Agent opened, and any program that has that folder open, then try again. The update is kept."),
            ));
        }
    }
    if let Err(e) = ops.retry(|| (ops.rename)(&tree, &live)) {
        if had_live && ops.retry(|| (ops.rename)(&old, &live)).is_err() {
            // The journal stays: it is what puts the engine back.
            return Err(Failure::new(
                Stage::Swap,
                format!("Replacing the engine failed ({e}), and the previous engine could not be put back yet. It is kept in {} and is restored the next time Octopus Agent starts.", old.display()),
            ));
        }
        settle(layout);
        return Err(Failure::new(
            Stage::Swap,
            format!("Replacing the engine failed ({e}). The engine you have was not changed; the update is kept and applied when you try again."),
        ));
    }
    // Live from here. A journal that cannot say so costs a download, nothing more.
    journal.done = true;
    let _ = write_journal(layout, &journal);
    Ok(())
}

/// After a swap is recorded: the previous tree and the staging folder go. A
/// failure is left for the next start (`sweep`), never reported.
pub fn cleanup(layout: &Layout, ops: &Ops) -> bool {
    let old = ops.clear(layout, &layout.old());
    let staging = ops.clear(layout, &layout.staging());
    old && staging
}

/// The engine put back from `.old` when a launcher died between the renames
/// (or could not undo the first one): only as an unfinished journal left it,
/// and only whole. True when it was.
pub fn restore(layout: &Layout, ops: &Ops) -> bool {
    if !returnable(layout) {
        return false;
    }
    let back = ops.retry(|| (ops.rename)(&layout.old(), &layout.live())).is_ok();
    if back {
        settle(layout);
    }
    back
}

/// At start, after the caller took a finished journal's record: the engine
/// put back, then what earlier tries left removed — a previous tree no
/// journal claims, trash, an unfinished staging folder, a partial or orphaned
/// download. A complete staged tree or download stays.
pub fn sweep(layout: &Layout, ops: &Ops) {
    restore(layout, ops);
    // `.old` stays only as the engine a restore could not put back yet.
    if !returnable(layout) {
        ops.clear(layout, &layout.old());
        settle(layout);
    }
    if let Ok(entries) = fs::read_dir(&layout.base) {
        let prefix = layout.trash_prefix();
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = (ops.remove)(&e.path());
            }
        }
    }
    if layout.staging().exists() && staged(layout).is_none() {
        ops.clear(layout, &layout.staging());
    }
    let _ = fs::remove_file(layout.part());
    let _ = fs::remove_file(layout.legacy_tmp());
    if downloaded(layout).is_none() {
        drop_download(layout);
    }
}

/// Unzips `zip` into `dest`. The system `unzip` on macOS / Linux: the `zip`
/// crate drops symlinks and +x bits, and trips on Linux archives whose entries
/// come before their folders.
pub fn unzip(zip: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    #[cfg(unix)]
    {
        let out = std::process::Command::new("unzip")
            .arg("-q")
            .arg("-o")
            .arg(zip)
            .arg("-d")
            .arg(dest)
            .output()
            .map_err(|e| anyhow::anyhow!("system `unzip` not found ({e}); install with `apt install unzip` / `brew install unzip`"))?;
        // 0 clean, 1 warnings (backslashes from Windows zips), 2+ fatal.
        let code = out.status.code().unwrap_or(-1);
        if code > 1 {
            anyhow::bail!(
                "unzip failed for {} (exit {code}): {}",
                zip.display(),
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        zip::ZipArchive::new(fs::File::open(zip)?)?.extract(dest)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
