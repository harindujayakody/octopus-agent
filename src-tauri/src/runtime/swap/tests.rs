//! Every step of an engine update failing in turn (#122): what is left must
//! be a working engine, the previous one or the new one.

use super::*;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use std::sync::Arc;

struct Base(PathBuf);

impl Drop for Base {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn base() -> (Base, Layout) {
    let dir = std::env::temp_dir().join(format!("shardx-swap-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&dir).unwrap();
    let layout = Layout::host(dir.clone(), "ShardX-Test.zip");
    (Base(dir), layout)
}

/// An engine tree for this host's layout, `version.txt` saying which it is.
fn engine_files(layout: &Layout, version: &str) -> Vec<(String, Vec<u8>)> {
    let mut files = vec![
        (layout.binary.to_string_lossy().replace('\\', "/"), b"\x7fELF engine".to_vec()),
        ("version.txt".into(), version.as_bytes().to_vec()),
        ("resources/en-US.pak".into(), vec![7u8; 4096]),
    ];
    match layout.marker {
        Marker::MacFramework => files.push((
            format!("ShardX.app/Contents/Frameworks/ShardX Framework.framework/Versions/{version}/ShardX Framework"),
            b"framework".to_vec(),
        )),
        Marker::WinManifest => files.push((format!("{version}.manifest"), b"<assembly/>".to_vec())),
        Marker::None => {}
    }
    files
}

fn write_tree(dir: &Path, files: &[(String, Vec<u8>)]) {
    for (rel, body) in files {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }
}

/// The live engine at `version`, with a file only that version has.
fn live(layout: &Layout, version: &str) {
    let mut files = engine_files(layout, version);
    files.push((format!("only-in-{version}.dll"), b"x".to_vec()));
    write_tree(&layout.live(), &files);
}

fn zip_of(path: &Path, entries: &[(String, Vec<u8>)]) {
    let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o755);
    for (name, body) in entries {
        w.start_file(name.as_str(), opts).unwrap();
        w.write_all(body).unwrap();
    }
    w.finish().unwrap();
}

/// A complete download of the engine at `version`, as `download_engine` leaves it.
fn download(layout: &Layout, version: &str) -> Downloaded {
    let entries: Vec<(String, Vec<u8>)> = engine_files(layout, version)
        .into_iter()
        .map(|(rel, body)| (format!("{}/{rel}", layout.root), body))
        .collect();
    zip_of(&layout.part(), &entries);
    keep_download(layout, &format!("etag-{version}")).unwrap()
}

fn version_of(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join("version.txt")).ok()
}

/// The real file system, but all room, nobody running, and no waiting.
fn ops() -> Ops {
    Ops {
        extract: Box::new(|zip, dest| unzip(zip, dest)),
        free_bytes: Box::new(|_| Some(u64::MAX)),
        holders: Box::new(|_| Holders::default()),
        starting: Box::new(|| 0),
        rename: Box::new(|a, b| fs::rename(a, b)),
        remove: Box::new(|p| fs::remove_dir_all(p)),
        tries: 1,
        pause: Duration::ZERO,
    }
}

fn refused() -> io::Error {
    // What Windows answers for a folder a running chrome.exe holds.
    io::Error::new(io::ErrorKind::ResourceBusy, "The process cannot access the file because it is being used by another process. (os error 32)")
}

fn rec() -> Record {
    Record { etag: "etag-157.0.0.1".into(), version: Some("157.0.0.1".into()), build: Some("7".into()) }
}

#[test]
fn an_update_replaces_the_engine_whole() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    let staged = stage(&l, &dl, &ops()).unwrap();
    assert_eq!(staged.etag, "etag-157.0.0.1");
    assert!(!l.archive().exists(), "the archive goes once the tree checks out");
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"), "staging touches nothing live");

    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
    assert!(!l.live().join("only-in-156.0.0.1.dll").exists(), "nothing of the old version lingers");
    assert!(cleanup(&l, &ops()));
    assert!(!l.old().exists() && !l.staging().exists());
    if l.marker != Marker::None {
        assert_eq!(version_in(&l.live(), l.marker).as_deref(), Some("157.0.0.1"));
    }
}

#[test]
fn a_first_install_has_nothing_to_move_aside() {
    let (_b, l) = base();
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
    assert!(!l.old().exists());
}

#[test]
fn an_extract_that_fails_half_way_leaves_the_engine() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    let mut o = ops();
    o.extract = Box::new(|_, dest| {
        // Some of the tree, then the disk fills up.
        fs::create_dir_all(dest.join("ShardX-Partial")).unwrap();
        fs::write(dest.join("ShardX-Partial/half.dll"), b"x").unwrap();
        Err(anyhow::anyhow!("No space left on device (os error 28)"))
    });
    let f = stage(&l, &dl, &o).unwrap_err();
    assert_eq!(f.stage, Stage::Extract);
    assert!(f.message.contains("os error 28"), "{}", f.message);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(!l.staging().exists(), "the half tree is gone");
    assert!(downloaded(&l).is_none(), "an archive that failed to unpack is fetched anew");

    // The next try, from a fresh download, goes through.
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

/// The real unzip failing after it wrote part of the tree: one entry's data no
/// longer matches its CRC (unzip exits 2; the zip crate errors the same way).
#[test]
fn a_real_unpack_that_fails_half_way_leaves_the_engine() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    let mut bytes = fs::read(l.archive()).unwrap();
    let at = bytes.windows(64).position(|w| w.iter().all(|b| *b == 7)).unwrap();
    bytes[at] = 8;
    fs::write(l.archive(), bytes).unwrap();
    let f = stage(&l, &dl, &ops()).unwrap_err();
    assert_eq!(f.stage, Stage::Extract, "{}", f.message);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(!l.staging().exists());
}

#[test]
fn a_damaged_archive_is_dropped_and_touches_nothing() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    fs::write(l.part(), b"PK\x03\x04 cut short").unwrap();
    let dl = keep_download(&l, "etag-x").unwrap();
    let f = stage(&l, &dl, &ops()).unwrap_err();
    assert_eq!(f.stage, Stage::Verify);
    assert!(!l.archive().exists() && downloaded(&l).is_none());
    assert!(!l.staging().exists());
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

#[test]
fn an_archive_without_the_engine_is_refused() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    zip_of(&l.part(), &[(format!("{}/readme.txt", l.root), b"hi".to_vec())]);
    let dl = keep_download(&l, "etag-x").unwrap();
    let f = stage(&l, &dl, &ops()).unwrap_err();
    assert_eq!(f.stage, Stage::Verify);
    assert!(f.message.contains(&l.root), "{}", f.message);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

/// An antivirus that takes a file out of the unpacked tree.
#[test]
fn a_file_lost_after_unpacking_is_caught() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    let mut o = ops();
    let root = l.root.clone();
    o.extract = Box::new(move |zip, dest| {
        unzip(zip, dest)?;
        fs::remove_file(dest.join(&root).join("resources/en-US.pak"))?;
        Ok(())
    });
    let f = stage(&l, &dl, &o).unwrap_err();
    assert_eq!(f.stage, Stage::Verify);
    assert!(f.message.contains("en-US.pak"), "{}", f.message);
    assert!(!l.staging().exists());
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

#[test]
fn a_staged_tree_that_lost_a_file_is_not_swapped() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    fs::remove_file(l.staged_tree().join("resources/en-US.pak")).unwrap();
    assert!(staged(&l).is_none());
    let f = swap(&l, &ops(), &rec()).unwrap_err();
    assert_eq!(f.stage, Stage::Verify);
    assert!(!l.staging().exists(), "dropped: it is downloaded again");
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

#[test]
fn not_enough_room_refuses_before_unpacking_and_keeps_the_download() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    let mut o = ops();
    o.free_bytes = Box::new(|_| Some(10 << 20));
    let f = stage(&l, &dl, &o).unwrap_err();
    assert_eq!(f.stage, Stage::Space);
    assert!(f.message.contains("10 MB is free"), "{}", f.message);
    assert!(!l.staging().exists(), "nothing unpacked");
    assert_eq!(downloaded(&l), Some(dl.clone()), "kept for the try after space is freed");
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));

    // Before the download, the guess counts the unpacked tree and the margin.
    let need = (100 << 20) * (1 + UNPACK_GUESS) + SPACE_MARGIN;
    assert!(room(&o, &l.base, need).is_err());
    assert!(room(&ops(), &l.base, need).is_ok());
    let mut unknown = ops();
    unknown.free_bytes = Box::new(|_| None);
    assert!(room(&unknown, &l.base, need).is_ok(), "an unknown disk is not a full one");
}

#[test]
fn running_browsers_refuse_the_swap_and_the_update_waits_for_a_retry() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();

    let mut o = ops();
    o.holders = Box::new(|_| Holders { processes: 9, browsers: 2, untracked: 0 });
    let f = swap(&l, &o, &rec()).unwrap_err();
    assert_eq!((f.stage, f.browsers), (Stage::Busy, 2));
    assert!(f.message.contains("2 profiles are still running"), "{}", f.message);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert_eq!(staged(&l).map(|s| s.etag), Some("etag-157.0.0.1".into()), "the update is kept");
    assert!(!f.message.contains("earlier session"), "{}", f.message);
    assert!(journal(&l).is_none());

    // One the launcher does not list: left by an earlier session.
    o.holders = Box::new(|_| Holders { processes: 3, browsers: 1, untracked: 1 });
    let f = swap(&l, &o, &rec()).unwrap_err();
    assert!(f.message.contains("1 profile is still running"), "{}", f.message);
    assert!(f.message.contains("earlier session") && f.message.contains("restart"), "{}", f.message);

    o.holders = Box::new(|_| Holders { processes: 1, browsers: 0, untracked: 0 });
    let f = swap(&l, &o, &rec()).unwrap_err();
    assert!(f.message.contains("1 browser process is still running"), "{}", f.message);

    let mut starting = ops();
    starting.starting = Box::new(|| 1);
    let f = swap(&l, &starting, &rec()).unwrap_err();
    assert_eq!((f.stage, f.browsers, f.starting), (Stage::Busy, 0, 1), "a start is counted apart from the browsers");
    assert_eq!(swap(&l, &o, &rec()).unwrap_err().starting, 0);

    // Closed: the retry swaps the kept tree, nothing unpacked again.
    let unpacked = Arc::new(AtomicUsize::new(0));
    let mut retry = ops();
    let n = unpacked.clone();
    retry.extract = Box::new(move |_, _| {
        n.fetch_add(1, SeqCst);
        Ok(())
    });
    swap(&l, &retry, &rec()).unwrap();
    assert_eq!(unpacked.load(SeqCst), 0);
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

#[test]
fn a_first_rename_windows_refuses_leaves_everything() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    let live_dir = l.live();
    o.rename = Box::new(move |a, b| if a == live_dir { Err(refused()) } else { fs::rename(a, b) });
    let f = swap(&l, &o, &rec()).unwrap_err();
    assert_eq!(f.stage, Stage::Swap);
    assert!(f.message.contains("os error 32"), "{}", f.message);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(staged(&l).is_some());
    assert!(journal(&l).is_none(), "nothing moved, nothing to put back");
}

#[test]
fn a_second_rename_that_fails_puts_the_engine_back() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    let tree = l.staged_tree();
    o.rename = Box::new(move |a, b| if a == tree { Err(refused()) } else { fs::rename(a, b) });
    let f = swap(&l, &o, &rec()).unwrap_err();
    assert_eq!(f.stage, Stage::Swap);
    assert!(f.message.contains("was not changed"), "{}", f.message);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(!l.old().exists());
    assert!(staged(&l).is_some(), "kept for the retry");
}

#[test]
fn a_rename_refused_for_a_moment_is_tried_again() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    o.tries = 5;
    let refusals = Arc::new(AtomicUsize::new(0));
    let (tree, n) = (l.staged_tree(), refusals.clone());
    // An antivirus reading the new chrome.exe: two refusals, then through.
    o.rename = Box::new(move |a, b| {
        if a == tree && n.fetch_add(1, SeqCst) < 2 {
            return Err(refused());
        }
        fs::rename(a, b)
    });
    swap(&l, &o, &rec()).unwrap();
    assert_eq!(refusals.load(SeqCst), 3);
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

/// Only a file held for now is waited for: a missing one fails at once.
#[test]
fn an_error_that_will_not_pass_is_not_tried_again() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    o.tries = 5;
    let calls = Arc::new(AtomicUsize::new(0));
    let (tree, n) = (l.staged_tree(), calls.clone());
    o.rename = Box::new(move |a, b| {
        if a == tree {
            n.fetch_add(1, SeqCst);
            return Err(io::Error::from(io::ErrorKind::NotFound));
        }
        fs::rename(a, b)
    });
    swap(&l, &o, &rec()).unwrap_err();
    assert_eq!(calls.load(SeqCst), 1);
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

/// An antivirus still reading the new tree refuses the move inside staging,
/// before the live engine is touched; the download is kept for the next try.
#[test]
fn a_new_tree_still_held_is_refused_before_the_swap() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    let mut o = ops();
    o.tries = 3;
    let unpacked = l.unpack().join(&l.root);
    o.rename = Box::new(move |a, b| if a == unpacked { Err(refused()) } else { fs::rename(a, b) });
    let f = stage(&l, &dl, &o).unwrap_err();
    assert_eq!(f.stage, Stage::Extract);
    assert!(f.message.contains("antivirus"), "{}", f.message);
    assert_eq!(downloaded(&l), Some(dl.clone()), "unpacked again, not downloaded again");
    assert!(!l.staging().exists());
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(journal(&l).is_none() && !l.old().exists());

    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

/// The record rides in the journal from the swap until the caller has saved
/// it, so a launcher stopped in between saves it at the next start.
#[test]
fn the_record_waits_in_the_journal_until_it_is_saved() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    let j = journal(&l).expect("a finished journal");
    assert!(j.done);
    assert_eq!(j.record, rec());
    assert_eq!(finished(&l), Some(rec()));
    // Killed here: the start puts nothing back over the new engine.
    assert!(!restore(&l, &ops()));
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
    settle(&l);
    assert!(journal(&l).is_none() && finished(&l).is_none());
    sweep(&l, &ops());
    assert!(!l.old().exists());

    // A first install has no previous engine, but its record rides along too.
    let (_b2, first) = base();
    let dl = download(&first, "157.0.0.1");
    stage(&first, &dl, &ops()).unwrap();
    swap(&first, &ops(), &rec()).unwrap();
    assert!(journal(&first).is_some_and(|j| j.done && j.old_files == 0));
}

/// Both the swap and the undo refused: the previous engine waits in `.old`
/// and the next start (or status) puts it back.
#[test]
fn a_failed_put_back_is_restored_at_the_next_start() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    let (tree, old) = (l.staged_tree(), l.old());
    o.rename = Box::new(move |a, b| if a == tree || a == old { Err(refused()) } else { fs::rename(a, b) });
    let f = swap(&l, &o, &rec()).unwrap_err();
    assert!(f.message.contains("restored the next time"), "{}", f.message);
    assert!(!l.live().exists());

    assert!(restore(&l, &ops()));
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(!l.old().exists());
    assert!(staged(&l).is_some(), "the update is still there to retry");
    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

/// A retry in the same run, before any start: the swap itself puts the
/// previous engine back first, and asks who runs from it.
#[test]
fn a_retry_after_a_failed_put_back_starts_from_the_previous_engine() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    let (tree, old) = (l.staged_tree(), l.old());
    o.rename = Box::new(move |a, b| if a == tree || a == old { Err(refused()) } else { fs::rename(a, b) });
    swap(&l, &o, &rec()).unwrap_err();

    let mut retry = ops();
    let asked = Arc::new(AtomicUsize::new(0));
    let (n, live_dir) = (asked.clone(), l.live());
    retry.holders = Box::new(move |dir| {
        assert_eq!(dir, live_dir.as_path());
        assert!(dir.exists(), "asked before the previous engine was back");
        n.fetch_add(1, SeqCst);
        Holders::default()
    });
    swap(&l, &retry, &rec()).unwrap();
    assert_eq!(asked.load(SeqCst), 1);
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
    assert_eq!(version_of(&l.old()).as_deref(), Some("156.0.0.1"), "removed by the cleanup");
    assert!(cleanup(&l, &ops()));
    assert!(!l.old().exists());
}

/// The launcher killed after the first rename and before the second: the
/// second rename never returns, and nothing after it runs.
#[test]
fn a_launcher_killed_between_the_renames_comes_back_to_the_old_engine() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut killed = ops();
    let tree = l.staged_tree();
    killed.rename = Box::new(move |a, b| {
        if a == tree {
            panic!("killed between the renames");
        }
        fs::rename(a, b)
    });
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| swap(&l, &killed, &rec())));
    assert!(r.is_err());
    assert!(!l.live().exists());
    assert!(journal(&l).is_some_and(|j| !j.done));

    sweep(&l, &ops());
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
    assert!(!l.old().exists());
    assert!(journal(&l).is_none());
    assert!(staged(&l).is_some(), "a complete staged tree survives the sweep");
    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

/// Killed right after the second rename, before the journal says so: the new
/// tree gone from staging is what tells, and its record is still saved.
#[test]
fn a_launcher_killed_right_after_the_second_rename_keeps_its_record() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut killed = ops();
    let tree = l.staged_tree();
    killed.rename = Box::new(move |a, b| {
        fs::rename(a, b)?;
        if a == tree {
            panic!("killed after the second rename");
        }
        Ok(())
    });
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| swap(&l, &killed, &rec())));
    assert!(r.is_err());
    assert!(journal(&l).is_some_and(|j| !j.done));
    assert_eq!(finished(&l), Some(rec()));
    assert!(!restore(&l, &ops()));
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));

    // Killed before the first rename instead: nothing moved, nothing finished.
    let (_b2, l2) = base();
    live(&l2, "156.0.0.1");
    let dl = download(&l2, "157.0.0.1");
    stage(&l2, &dl, &ops()).unwrap();
    let mut early = ops();
    early.rename = Box::new(|_, _| panic!("killed before the first rename"));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| swap(&l2, &early, &rec())));
    assert!(r.is_err());
    assert_eq!(finished(&l2), None);
    sweep(&l2, &ops());
    assert!(journal(&l2).is_none());
    assert_eq!(version_of(&l2.live()).as_deref(), Some("156.0.0.1"));
}

/// A cleanup cut short leaves part of the previous tree. With the live engine
/// gone afterwards (deleted by hand, say), that part is never put back as the
/// engine: nothing is installed, and the next install downloads it.
#[test]
fn a_previous_tree_a_cleanup_cut_short_is_never_put_back() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    settle(&l);
    let mut cut = ops();
    let old = l.old();
    let first = old.join("version.txt");
    cut.remove = Box::new(move |p| {
        if p == old {
            let _ = fs::remove_file(&first);
            return Err(refused());
        }
        fs::remove_dir_all(p)
    });
    cut.rename = Box::new(|_, _| Err(refused()));
    assert!(!cleanup(&l, &cut));
    assert!(l.old().exists() && !l.old().join("version.txt").exists());
    fs::remove_dir_all(l.live()).unwrap();

    assert!(!restore(&l, &ops()));
    sweep(&l, &ops());
    assert!(!l.live().exists() && !l.old().exists());
}

/// An unfinished journal whose tree lost a file is not trusted either.
#[test]
fn a_previous_tree_that_lost_files_is_not_put_back() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    let (tree, old) = (l.staged_tree(), l.old());
    o.rename = Box::new(move |a, b| if a == tree || a == old { Err(refused()) } else { fs::rename(a, b) });
    swap(&l, &o, &rec()).unwrap_err();
    fs::remove_file(l.old().join("version.txt")).unwrap();
    assert!(!restore(&l, &ops()));
    assert!(!l.live().exists());
}

/// The previous engine waiting in `.old` and still held: neither the next
/// swap nor the sweep removes it while it cannot be put back.
#[test]
fn a_previous_engine_still_held_is_kept_until_it_is_back() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut held = ops();
    let (tree, old) = (l.staged_tree(), l.old());
    held.rename = Box::new(move |a, b| if a == tree || a == old { Err(refused()) } else { fs::rename(a, b) });
    swap(&l, &held, &rec()).unwrap_err();

    let f = swap(&l, &held, &rec()).unwrap_err();
    assert_eq!(f.stage, Stage::Swap);
    assert!(f.message.contains("could not be put back yet"), "{}", f.message);
    sweep(&l, &held);
    assert_eq!(version_of(&l.old()).as_deref(), Some("156.0.0.1"));
    assert!(journal(&l).is_some());

    sweep(&l, &ops());
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

/// Killed after the second rename, before the cleanup: the new engine stays.
#[test]
fn a_launcher_killed_after_the_swap_keeps_the_new_engine() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    sweep(&l, &ops());
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
    assert!(!l.old().exists());
}

#[test]
fn a_cleanup_windows_refuses_is_finished_at_the_next_start() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    let mut locked = ops();
    let old = l.old();
    locked.remove = Box::new(move |p| if p == old { Err(refused()) } else { fs::remove_dir_all(p) });
    locked.rename = Box::new(|_, _| Err(refused()));
    assert!(!cleanup(&l, &locked), "reported, never an error");
    assert!(l.old().exists());
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));

    sweep(&l, &ops());
    assert!(!l.old().exists(), "gone at the next start");
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"));
}

/// A tree that cannot be removed but can be moved goes to the trash, and the
/// trash goes at the next start.
#[test]
fn what_cannot_be_removed_is_moved_aside_then_swept() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    let dl = download(&l, "157.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    swap(&l, &ops(), &rec()).unwrap();
    let mut o = ops();
    let old = l.old();
    o.remove = Box::new(move |p| if p == old { Err(refused()) } else { fs::remove_dir_all(p) });
    assert!(cleanup(&l, &o));
    assert!(!l.old().exists());
    let trash = || {
        fs::read_dir(&l.base)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(&l.trash_prefix()))
            .count()
    };
    assert_eq!(trash(), 1);
    sweep(&l, &ops());
    assert_eq!(trash(), 0);
}

/// A partly removed copy from an earlier cleanup is never what an update
/// falls back to.
#[test]
fn a_leftover_old_copy_is_cleared_before_the_next_swap() {
    let (_b, l) = base();
    live(&l, "157.0.0.1");
    write_tree(&l.old(), &[("version.txt".into(), b"half of 156".to_vec())]);
    let dl = download(&l, "158.0.0.1");
    stage(&l, &dl, &ops()).unwrap();
    let mut o = ops();
    let tree = l.staged_tree();
    o.rename = Box::new(move |a, b| if a == tree { Err(refused()) } else { fs::rename(a, b) });
    swap(&l, &o, &rec()).unwrap_err();
    assert_eq!(version_of(&l.live()).as_deref(), Some("157.0.0.1"), "the live engine, not the leftover");
    swap(&l, &ops(), &rec()).unwrap();
    assert_eq!(version_of(&l.live()).as_deref(), Some("158.0.0.1"));
}

#[test]
fn the_sweep_removes_what_a_crash_left_and_keeps_what_is_complete() {
    let (_b, l) = base();
    live(&l, "156.0.0.1");
    // A staging folder the launcher died filling, a download cut short, the
    // pre-#122 temp file, and an archive whose note was never written.
    write_tree(&l.staged_tree(), &[("half.dll".into(), b"x".to_vec())]);
    fs::write(l.part(), b"partial").unwrap();
    fs::write(l.legacy_tmp(), b"old").unwrap();
    fs::write(l.archive(), b"no note").unwrap();
    sweep(&l, &ops());
    assert!(!l.staging().exists() && !l.part().exists() && !l.legacy_tmp().exists());
    assert!(!l.archive().exists());

    // A complete download stays for the next try.
    let dl = download(&l, "157.0.0.1");
    sweep(&l, &ops());
    assert_eq!(downloaded(&l), Some(dl));
    assert_eq!(version_of(&l.live()).as_deref(), Some("156.0.0.1"));
}

#[test]
fn the_version_marker_is_read_per_platform() {
    let (_b, l) = base();
    let tree = l.base.join("t");
    write_tree(&tree, &[("foo.manifest".into(), vec![1]), ("156.0.7.8.manifest".into(), vec![1])]);
    assert_eq!(version_in(&tree, Marker::WinManifest).as_deref(), Some("156.0.7.8"));
    write_tree(
        &tree,
        &[("ShardX.app/Contents/Frameworks/ShardX Framework.framework/Versions/157.0.1.2/x".into(), vec![1])],
    );
    fs::create_dir_all(tree.join("ShardX.app/Contents/Frameworks/ShardX Framework.framework/Versions/Current")).unwrap();
    assert_eq!(version_in(&tree, Marker::MacFramework).as_deref(), Some("157.0.1.2"));
    assert_eq!(version_in(&tree, Marker::None), None);
    assert_eq!(version_in(&l.base.join("missing"), Marker::WinManifest), None);
}
