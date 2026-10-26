//! The library swap: the same path, root and id basis after an update, what
//! staging refuses, and what a failure or a dead launcher leaves behind.

use super::*;
use crate::space::local::extensions::chrome_id::chrome_id;
use crate::space::local::extensions::source::{How, SourceLocal};
use crate::space::local::extensions::testkit::{crx3, manifest, stand_in, verified_contents, write_tree, zip, Key, Tmp};
use base64::Engine;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A library in a folder of the test's own; packages come from beside it.
struct Lib {
    tmp: Tmp,
    lib: PathBuf,
}

impl Lib {
    fn new() -> Lib {
        let tmp = Tmp::new("ext-swap");
        let lib = tmp.0.join("extensions");
        fs::create_dir_all(&lib).unwrap();
        Lib { tmp, lib }
    }

    /// A live extension `id`: `files` under its folder (`root` "" or one name),
    /// with a side file when it is linked.
    fn live(&self, id: &str, root: &str, files: &[(&str, &[u8])], link: Option<(&str, How)>) {
        write_tree(&at_root(&self.lib.join(id), root), files);
        if let Some((store_id, how)) = link {
            let side = SourceLocal { source: Some(SourceRef::webstore(store_id)), how: Some(how), recovered: true, ..SourceLocal::default() };
            source::write(&self.lib, id, &side).unwrap();
        }
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.tmp.0.join("in").join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, bytes).unwrap();
        p
    }

    fn root(&self, id: &str) -> PathBuf {
        manifest_root(&self.lib.join(id))
    }

    fn version(&self, dir: &Path) -> String {
        tree_version(dir)
    }

    fn names(&self) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(&self.lib).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        v.sort();
        v
    }

    fn stage(&self, id: &str, pkg: &[u8], order: &Order) -> Result<Staged, Failure> {
        let file = self.file(&format!("{}.pkg", uuid::Uuid::new_v4().simple()), pkg);
        stage_file(&self.lib, id, &file, order, &Ops::quick(), &quiet())
    }
}

fn b64(der: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(der)
}

fn m(version: &str) -> Vec<u8> {
    manifest(version, json!({})).into_bytes()
}

fn m_with(version: &str, extra: serde_json::Value) -> Vec<u8> {
    manifest(version, extra).into_bytes()
}

fn store(id: &str) -> Order {
    Order::store(id, None, None, None)
}

/// Only what the library should hold besides the live folder and its side file.
fn assert_tidy(l: &Lib, id: &str) {
    let extra: Vec<String> = l
        .names()
        .into_iter()
        .filter(|n| n.starts_with(&format!(".{id}.")) || n.starts_with(&format!("{id}.")))
        .filter(|n| *n != format!("{id}.source.json") && *n != format!(".{id}.prev") && *n != format!(".{id}.prev.json"))
        .collect();
    assert!(extra.is_empty(), "left behind: {extra:?}");
}

/// Live with the store's key, new without: the key goes in, the id stays.
#[test]
fn a_store_update_keeps_the_id_its_key_gives() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);
    l.live("e1", "", &[("manifest.json", &m_with("1.0", json!({ "key": b64(&dev.spki) }))), ("bg.js", b"1;")], Some((&dev.id(), How::Link)));
    let before = chrome_id(&l.root("e1")).unwrap();
    assert_eq!(before, dev.id());

    let pkg = crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("1.1")), ("bg.js", b"2;")]));
    let staged = l.stage("e1", &pkg, &store(&dev.id())).unwrap();
    assert_eq!((staged.key, staged.ready(), staged.root.as_str()), (KeyAction::Inserted, true, ""));
    assert!(staged.grown.is_empty() && staged.identity.is_none());

    let done = apply(&l.lib, "e1", &Ops::quick()).unwrap();
    assert_eq!((done.from.as_str(), done.to.as_str()), ("1.0", "1.1"));
    assert_eq!(done.atomic, cfg!(any(target_os = "macos", target_os = "linux")));
    assert_eq!(chrome_id(&l.root("e1")).unwrap(), before);
    assert_eq!(fs::read(l.lib.join("e1/bg.js")).unwrap(), b"2;");
    assert_eq!(l.version(&l.lib.join(".e1.prev")), "1.0", "the tree before is kept");
    assert!(l.lib.join(".e1.prev.json").is_file());
    assert_tidy(&l, "e1");
}

/// Live without a key, new with one: the key goes, the id from the path stays.
#[test]
fn a_store_update_keeps_the_id_its_path_gives() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);
    // Linked by hand: the files must show the same extension.
    l.live("e2", "", &[("manifest.json", &m("2.0")), ("bg.js", b"1;"), ("lib.js", b"same")], Some((&dev.id(), How::User)));
    let before = chrome_id(&l.root("e2")).unwrap();

    let pkg = crx3(&dev, Some(&st), &zip(&[("manifest.json", &m_with("2.1", json!({ "key": b64(&dev.spki) }))), ("bg.js", b"2;"), ("lib.js", b"same")]));
    let staged = l.stage("e2", &pkg, &store(&dev.id())).unwrap();
    assert_eq!(staged.key, KeyAction::Removed);
    assert!(staged.identity.is_none() && staged.ready(), "half its files unchanged: the same extension");

    apply(&l.lib, "e2", &Ops::quick()).unwrap();
    assert_eq!(chrome_id(&l.root("e2")).unwrap(), before);
    assert!(manifest_edit::read_manifest(&l.root("e2")).unwrap().get("key").is_none());
}

/// Design п.7: the new tree goes where the live manifest was, whatever its zip did.
#[test]
fn the_new_tree_takes_the_live_trees_layout() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);

    // Flat live, a wrapped zip: flat.
    l.live("flat", "", &[("manifest.json", &m("1.0")), ("a.js", b"1")], Some((&dev.id(), How::Link)));
    let id_flat = chrome_id(&l.root("flat")).unwrap();
    let wrapped = crx3(&dev, Some(&st), &zip(&[("pkg/manifest.json", &m("1.1")), ("pkg/a.js", b"2")]));
    assert_eq!(l.stage("flat", &wrapped, &store(&dev.id())).unwrap().root, "");
    apply(&l.lib, "flat", &Ops::quick()).unwrap();
    assert!(l.lib.join("flat/manifest.json").is_file() && !l.lib.join("flat/pkg").exists());
    assert_eq!(chrome_id(&l.root("flat")).unwrap(), id_flat);

    // Nested live, a flat zip: nested in the same folder.
    l.live("nest", "inner", &[("manifest.json", &m("1.0")), ("a.js", b"1")], Some((&dev.id(), How::Link)));
    let id_nest = chrome_id(&l.root("nest")).unwrap();
    let plain = crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("1.1")), ("a.js", b"2")]));
    assert_eq!(l.stage("nest", &plain, &store(&dev.id())).unwrap().root, "inner");
    apply(&l.lib, "nest", &Ops::quick()).unwrap();
    assert_eq!(l.root("nest"), l.lib.join("nest/inner"));
    assert_eq!(l.version(&l.lib.join("nest")), "1.1");
    assert_eq!(chrome_id(&l.root("nest")).unwrap(), id_nest);
}

/// Each refusal leaves the live folder as it was and no staging behind.
#[test]
fn staging_refuses_what_is_not_the_next_version_of_this_item() {
    let l = Lib::new();
    let (dev, st, other) = (Key::new(), Key::new(), Key::new());
    let _store = stand_in(&st);
    l.live("e3", "", &[("manifest.json", &m_with("3.0", json!({ "key": b64(&dev.spki) }))), ("bg.js", b"1;")], Some((&dev.id(), How::Link)));
    let body = |v: &str| zip(&[("manifest.json", &m(v)), ("bg.js", b"2;")]);
    let vc = verified_contents(&dev.id(), "3.0");
    let cases: Vec<(Vec<u8>, Order, Kind, &str)> = vec![
        (crx3(&dev, Some(&st), &body("3.0")), store(&dev.id()), Kind::NotNewer, "not newer"),
        (crx3(&dev, Some(&st), &body("2.9")), store(&dev.id()), Kind::NotNewer, "not newer"),
        (crx3(&other, Some(&st), &body("3.1")), store(&dev.id()), Kind::Package, "not "),
        (crx3(&dev, None, &body("3.1")), store(&dev.id()), Kind::Package, "not signed by the Web Store"),
        (crx3(&dev, Some(&st), &body("3.1")), Order::store(&dev.id(), Some(&"0".repeat(64)), None, None), Kind::Package, "hash"),
        (body("3.1"), store(&dev.id()), Kind::Package, "not a CRX3"),
        (
            crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("3.1")), ("_metadata/verified_contents.json", vc.as_bytes())])),
            store(&dev.id()),
            Kind::Package,
            "signed contents",
        ),
        (
            crx3(&dev, Some(&st), &zip(&[("manifest.json", &m_with("3.1", json!({ "key": b64(&other.spki) })))])),
            store(&dev.id()),
            Kind::Manifest,
            "another key",
        ),
        (crx3(&dev, Some(&st), &body("3.1")), store(&other.id()), Kind::Stale, "another Web Store item"),
    ];
    for (pkg, order, kind, why) in cases {
        let f = l.stage("e3", &pkg, &order).unwrap_err();
        assert_eq!(f.kind, kind, "{f}");
        assert!(f.message.contains(why), "{f}");
        assert_eq!(l.version(&l.lib.join("e3")), "3.0");
        assert_tidy(&l, "e3");
    }
}

/// New access, or files that look like another extension: staged, but only
/// the person can let it in.
#[test]
fn what_the_person_must_see_waits_for_their_yes() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);
    l.live("e4", "", &[("manifest.json", &m("4.0")), ("bg.js", b"1;")], Some((&dev.id(), How::Link)));
    let grows = m_with("4.1", json!({ "permissions": ["tabs"], "host_permissions": ["https://*/*"] }));
    let staged = l.stage("e4", &crx3(&dev, Some(&st), &zip(&[("manifest.json", &grows)])), &store(&dev.id())).unwrap();
    assert_eq!(staged.grown.len(), 2);
    assert!(!staged.ready());
    assert!(waiting(&l.lib).is_empty());
    assert!(approve(&l.lib, "e4").unwrap().ready());
    assert_eq!(waiting(&l.lib), ["e4"]);

    // Linked by hand, and nothing in common.
    l.live("e5", "", &[("manifest.json", &m("5.0")), ("a.js", b"mine"), ("b.js", b"mine")], Some((&dev.id(), How::User)));
    let renamed = m_with("5.1", json!({ "name": "Other" }));
    let staged = l.stage("e5", &crx3(&dev, Some(&st), &zip(&[("manifest.json", &renamed), ("a.js", b"theirs")])), &store(&dev.id())).unwrap();
    let who = staged.identity.clone().expect("asked");
    assert_eq!((who.overlap, who.names.old.as_str(), who.names.new.as_str()), (0.0, "Wallet", "Other"));
    assert!(!staged.ready());

    // Not linked yet: weighed the same way.
    l.live("e8", "", &[("manifest.json", &m("8.0")), ("a.js", b"same"), ("b.js", b"old")], None);
    let staged = l.stage("e8", &crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("8.1")), ("a.js", b"same")])), &store(&dev.id())).unwrap();
    assert!(staged.identity.is_none() && staged.ready(), "half its files and its name: the same");

    // An engine older than it asks for: kept, not applied.
    l.live("e6", "", &[("manifest.json", &m("6.0"))], Some((&dev.id(), How::Link)));
    let needs = m_with("6.1", json!({ "minimum_chrome_version": "200" }));
    let order = Order::store(&dev.id(), None, None, Some("156.0.8078.48"));
    let staged = l.stage("e6", &crx3(&dev, Some(&st), &zip(&[("manifest.json", &needs)])), &order).unwrap();
    assert_eq!(staged.needs_engine.as_deref(), Some("200"));
    assert!(!staged.ready() && !approve(&l.lib, "e6").unwrap().ready());
}

#[test]
fn a_full_disk_stages_nothing() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);
    l.live("e7", "", &[("manifest.json", &m("1.0"))], Some((&dev.id(), How::Link)));
    let file = l.file("u.crx", &crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("1.1"))])));
    let ops = Ops { free_bytes: Box::new(|_| Some(10 << 20)), ..Ops::quick() };
    let f = stage_file(&l.lib, "e7", &file, &store(&dev.id()), &ops, &quiet()).unwrap_err();
    assert_eq!(f.kind, Kind::Space, "{f}");
    assert_tidy(&l, "e7");
}

/// The receiver of sync lays the tree as it comes: no key fitting, only a check.
#[test]
fn a_sync_package_never_changes_the_id_basis() {
    let l = Lib::new();
    let dev = Key::new();
    l.live("s1", "", &[("manifest.json", &m_with("1.0", json!({ "key": b64(&dev.spki) })))], None);
    let same = zip(&[("manifest.json", &m_with("1.1", json!({ "key": b64(&dev.spki) }))), ("x.js", b"1")]);
    let grows = zip(&[("manifest.json", &m_with("1.1", json!({ "key": b64(&dev.spki), "permissions": ["tabs"] })))]);
    let keyless = zip(&[("manifest.json", &m("1.1"))]);
    let older = zip(&[("manifest.json", &m_with("0.9", json!({ "key": b64(&dev.spki) })))]);

    assert_eq!(l.stage("s1", &keyless, &Order::sync(3, None)).unwrap_err().kind, Kind::IdConflict);
    assert_eq!(l.stage("s1", &older, &Order::sync(3, None)).unwrap_err().kind, Kind::NotNewer);
    assert_tidy(&l, "s1");
    // Its builder confirmed the access on the other computer.
    let staged = l.stage("s1", &grows, &Order::sync(3, None)).unwrap();
    assert_eq!((staged.key, staged.grown.len(), staged.ready()), (KeyAction::Kept, 1, true));
    let staged = l.stage("s1", &same, &Order::sync(4, None)).unwrap();
    assert_eq!(staged.origin, Origin::Sync(4));
    apply(&l.lib, "s1", &Ops::quick()).unwrap();
    assert_eq!(source::read(&l.lib, "s1").unwrap().applied_package_rev, Some(4));
    assert_eq!(chrome_id(&l.root("s1")).unwrap(), dev.id());
}

/// A plain update of `id` from 1.0 to 1.1, staged.
fn staged_update(l: &Lib, id: &str) {
    l.live(id, "", &[("manifest.json", &m("1.0")), ("a.js", b"1")], None);
    let staged = l.stage(id, &zip(&[("manifest.json", &m("1.1")), ("a.js", b"2")]), &Order::sync(1, None)).unwrap();
    assert!(staged.ready());
}

fn refuse(e: io::ErrorKind) -> io::Result<()> {
    Err(io::Error::from(e))
}

/// Design п.8: the two renames where no one-step swap exists, and each way they fail.
#[test]
fn without_a_one_step_swap_two_renames_do_it() {
    let l = Lib::new();
    staged_update(&l, "f1");
    let before = chrome_id(&l.root("f1")).unwrap();
    let ops = Ops { exchange: Box::new(|_, _| refuse(io::ErrorKind::Unsupported)), ..Ops::quick() };
    let done = apply(&l.lib, "f1", &ops).unwrap();
    assert!(!done.atomic);
    assert_eq!((l.version(&l.lib.join("f1")), l.version(&l.lib.join(".f1.prev"))), ("1.1".into(), "1.0".into()));
    assert_eq!(chrome_id(&l.root("f1")).unwrap(), before);
    assert_tidy(&l, "f1");
}

#[test]
fn a_failed_first_rename_changes_nothing() {
    let l = Lib::new();
    staged_update(&l, "f2");
    let ops = Ops {
        exchange: Box::new(|_, _| refuse(io::ErrorKind::Unsupported)),
        rename: Box::new(|_, _| refuse(io::ErrorKind::PermissionDenied)),
        ..Ops::quick()
    };
    assert_eq!(apply(&l.lib, "f2", &ops).unwrap_err().kind, Kind::Swap);
    assert_eq!(l.version(&l.lib.join("f2")), "1.0");
    assert!(!l.lib.join(".f2.prev.new").exists());
    assert_eq!(waiting(&l.lib), ["f2"], "the update is kept");
    apply(&l.lib, "f2", &Ops::quick()).unwrap();
    assert_eq!(l.version(&l.lib.join("f2")), "1.1");
}

#[test]
fn a_failed_second_rename_puts_the_first_back() {
    let l = Lib::new();
    staged_update(&l, "f3");
    let ops = Ops {
        exchange: Box::new(|_, _| refuse(io::ErrorKind::Unsupported)),
        rename: Box::new(|a, b| if a.ends_with("tree") { refuse(io::ErrorKind::PermissionDenied) } else { fs::rename(a, b) }),
        ..Ops::quick()
    };
    assert_eq!(apply(&l.lib, "f3", &ops).unwrap_err().kind, Kind::Swap);
    assert_eq!(l.version(&l.lib.join("f3")), "1.0");
    assert!(!l.lib.join(".f3.prev.new").exists());
    assert_eq!(waiting(&l.lib), ["f3"]);
}

/// Neither the new tree nor the old one could go in: the next start puts the old one back.
#[test]
fn what_a_failed_put_back_leaves_the_next_start_restores() {
    let l = Lib::new();
    staged_update(&l, "f4");
    let ops = Ops {
        exchange: Box::new(|_, _| refuse(io::ErrorKind::Unsupported)),
        rename: Box::new(|a, b| if a.ends_with("f4") { fs::rename(a, b) } else { refuse(io::ErrorKind::PermissionDenied) }),
        ..Ops::quick()
    };
    let f = apply(&l.lib, "f4", &ops).unwrap_err();
    assert!(f.message.contains("next time"), "{f}");
    assert!(!l.lib.join("f4").exists() && l.lib.join(".f4.prev.new").is_dir());

    let swept = sweep(&l.lib, &Ops::quick());
    assert_eq!((swept.restored, swept.kept), (1, 1));
    assert_eq!(l.version(&l.lib.join("f4")), "1.0");
    assert_eq!(waiting(&l.lib), ["f4"], "the complete stage stays");
    apply(&l.lib, "f4", &Ops::quick()).unwrap();
    assert_eq!(l.version(&l.lib.join("f4")), "1.1");
}

/// A rename refused for a moment is tried again.
#[test]
fn a_busy_folder_is_tried_again() {
    let l = Lib::new();
    staged_update(&l, "f5");
    let refused = Arc::new(AtomicUsize::new(0));
    let r = refused.clone();
    let ops = Ops {
        exchange: Box::new(move |a, b| {
            if r.fetch_add(1, Ordering::SeqCst) < 2 {
                return refuse(io::ErrorKind::ResourceBusy);
            }
            fs::rename(b, a.with_extension("x"))?;
            fs::rename(a, b)?;
            fs::rename(a.with_extension("x"), a)
        }),
        ..Ops::quick()
    };
    assert!(apply(&l.lib, "f5", &ops).unwrap().atomic);
    assert_eq!(refused.load(Ordering::SeqCst), 3);
    assert_eq!(l.version(&l.lib.join("f5")), "1.1");
}

/// A launcher that died between the renames, or after the one-step swap.
#[test]
fn a_start_after_a_death_mid_swap_finishes_or_undoes_it() {
    let l = Lib::new();
    // Died after the first rename: the live tree comes back, the stage stays.
    staged_update(&l, "d1");
    fs::rename(l.lib.join("d1"), l.lib.join(".d1.prev.new")).unwrap();
    // Died after the second: the new tree stays, the old one becomes `.prev`.
    staged_update(&l, "d2");
    fs::rename(l.lib.join("d2"), l.lib.join(".d2.prev.new")).unwrap();
    fs::rename(l.lib.join(".d2.staging/tree"), l.lib.join("d2")).unwrap();
    // Died after the one-step swap: staging holds the tree before.
    staged_update(&l, "d3");
    let tmp = l.lib.join(".d3.tmp-swap");
    fs::rename(l.lib.join("d3"), &tmp).unwrap();
    fs::rename(l.lib.join(".d3.staging/tree"), l.lib.join("d3")).unwrap();
    fs::rename(&tmp, l.lib.join(".d3.staging/tree")).unwrap();

    let swept = sweep(&l.lib, &Ops::quick());
    assert_eq!((swept.restored, swept.finished, swept.kept), (1, 2, 1), "{swept:?}");
    assert_eq!(l.version(&l.lib.join("d1")), "1.0");
    assert_eq!(waiting(&l.lib), ["d1"]);
    for id in ["d2", "d3"] {
        assert_eq!(l.version(&l.lib.join(id)), "1.1");
        assert_eq!(l.version(&l.lib.join(format!(".{id}.prev"))), "1.0");
        assert_tidy(&l, id);
    }
    assert!(staged(&l.lib, "d3").is_none(), "the tree before is never applied again");
}

#[test]
fn a_start_removes_what_is_incomplete_or_nobodys() {
    let l = Lib::new();
    // No note: unpacking never finished.
    staged_update(&l, "c1");
    fs::remove_file(l.lib.join(".c1.staging/staged.json")).unwrap();
    // A file gone from a checked tree.
    staged_update(&l, "c2");
    fs::remove_file(l.lib.join(".c2.staging/tree/a.js")).unwrap();
    // Complete: stays.
    staged_update(&l, "c3");
    // Leftovers of downloads, sync, side-file writes and cleanups.
    for name in [".c3.part", ".c3.zip", ".c3.source.tmp", ".c3.weigh/manifest.json", ".c3.trash-1/x", ".c3.new/manifest.json", ".gone.staging/tree/manifest.json", ".gone.prev/manifest.json"] {
        write_tree(&l.lib, &[(name, b"{}")]);
    }
    write_tree(&l.lib, &[(".c3.unknown", b"kept")]);

    let swept = sweep(&l.lib, &Ops::quick());
    assert_eq!(swept.kept, 1, "{swept:?}");
    assert_eq!(waiting(&l.lib), ["c3"]);
    let mut names = l.names();
    names.retain(|n| n.starts_with('.'));
    assert_eq!(names, [".c3.staging", ".c3.unknown"]);
    for id in ["c1", "c2"] {
        assert_eq!(l.version(&l.lib.join(id)), "1.0");
    }
}

#[test]
fn the_tree_before_is_kept_for_a_week() {
    let l = Lib::new();
    for (id, age_days) in [("p1", 8u64), ("p2", 6)] {
        l.live(id, "", &[("manifest.json", &m("2.0"))], None);
        write_tree(&l.lib, &[(&format!(".{id}.prev/manifest.json"), &m("1.0"))]);
        let at = now_secs() - age_days * 24 * 3600;
        fs::write(l.lib.join(format!(".{id}.prev.json")), json!({ "at": at, "version": "1.0" }).to_string()).unwrap();
    }
    l.live("p3", "", &[("manifest.json", &m("2.0"))], None);
    write_tree(&l.lib, &[(".p3.prev/manifest.json", &m("1.0"))]);

    sweep(&l.lib, &Ops::quick());
    assert!(!l.lib.join(".p1.prev").exists() && !l.lib.join(".p1.prev.json").exists());
    assert!(l.lib.join(".p2.prev").is_dir());
    let note: serde_json::Value = serde_json::from_slice(&fs::read(l.lib.join(".p3.prev.json")).unwrap()).unwrap();
    assert!(now_secs() - note["at"].as_u64().unwrap() < 60, "its week starts at the first start that sees it");
    assert_eq!(note["version"], "1.0");
}

/// What a live tree gains from Chrome later (its rule index) does not make it another tree.
#[test]
fn the_digest_is_the_files_not_chromes_additions() {
    let t = Tmp::new("ext-digest");
    let dir = t.0.join("x");
    write_tree(&dir, &[("inner/manifest.json", &m("1.0")), ("inner/a.js", b"1")]);
    let d = tree_digest(&dir).unwrap();
    write_tree(&dir, &[("inner/_metadata/generated_indexed_rulesets/_ruleset1", b"x"), ("inner/.added", b"@1")]);
    assert_eq!(tree_digest(&dir).unwrap(), d);
    write_tree(&dir, &[("inner/a.js", b"2")]);
    assert_ne!(tree_digest(&dir).unwrap(), d, "the bytes count, not only the sizes");
}

/// A server that answers every GET with `body`.
async fn serve(body: Vec<u8>) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/crx/blobs/x.crx", listener.local_addr().unwrap());
    tokio::spawn(async move {
        while let Ok((mut conn, _)) = listener.accept().await {
            let mut req = Vec::new();
            let mut buf = [0u8; 1024];
            while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                match conn.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => req.extend_from_slice(&buf[..n]),
                }
            }
            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = conn.write_all(head.as_bytes()).await;
            let _ = conn.write_all(&body).await;
        }
    });
    url
}

/// The codebase update2 named, fetched within what it said of the file.
#[tokio::test]
async fn a_download_is_held_to_what_update2_said() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);
    l.live("n1", "", &[("manifest.json", &m("1.0"))], Some((&dev.id(), How::Link)));
    // Bytes zip cannot shrink.
    let noise: Vec<u8> = (0u32..(3 << 20) / 32).flat_map(|i| Sha256::digest(i.to_le_bytes()).to_vec()).collect();
    let pkg = crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("1.1")), ("big.bin", &noise)]));
    let sha: String = Sha256::digest(&pkg).iter().map(|b| format!("{b:02x}")).collect();
    let url = serve(pkg.clone()).await;
    let ops = Arc::new(Ops::quick());
    let heard = Arc::new(AtomicUsize::new(0));
    let h = heard.clone();
    let progress: Progress = Arc::new(move |phase, got, _| {
        if phase == Phase::Download {
            h.store(got as usize, Ordering::SeqCst);
        }
    });

    let order = Order::store(&dev.id(), Some(&sha), Some(1 << 20), None);
    let f = stage(&l.lib, "n1", &url, order, ops.clone(), progress.clone()).await.unwrap_err();
    assert_eq!(f.kind, Kind::Download, "{f}");
    assert!(f.message.contains("over 2 MB"), "{f}");
    assert_tidy(&l, "n1");

    let order = Order::store(&dev.id(), Some(&"0".repeat(64)), Some(pkg.len() as u64), None);
    assert_eq!(stage(&l.lib, "n1", &url, order, ops.clone(), progress.clone()).await.unwrap_err().kind, Kind::Package);
    assert_tidy(&l, "n1");

    let order = Order::store(&dev.id(), Some(&sha), Some(pkg.len() as u64), None);
    let staged = stage(&l.lib, "n1", &url, order, ops, progress).await.unwrap();
    assert_eq!((staged.sha256.as_str(), staged.to.as_str()), (sha.as_str(), "1.1"));
    assert_eq!(heard.load(Ordering::SeqCst), pkg.len());
    assert!(!l.lib.join(".n1.part").exists());
}

/// Linking weighs the store's package against the live tree and keeps none of it.
#[test]
fn weighing_leaves_nothing_behind() {
    let l = Lib::new();
    let (dev, st) = (Key::new(), Key::new());
    let _store = stand_in(&st);
    l.live("w1", "", &[("manifest.json", &m("1.0")), ("a.js", b"a"), ("b.js", b"b")], None);
    let pkg = l.file("w.crx", &crx3(&dev, Some(&st), &zip(&[("manifest.json", &m_with("1.2", json!({ "name": "Other" }))), ("a.js", b"a")])));
    let w = weigh(&l.lib, "w1", &pkg, &store(&dev.id()), &Ops::quick()).unwrap();
    assert_eq!((w.overlap, w.same_name, w.version.as_str()), (0.5, false, "1.2"));
    assert_eq!((w.names.old.as_str(), w.names.new.as_str()), ("Wallet", "Other"));
    assert_tidy(&l, "w1");

    let unsigned = l.file("u.crx", &crx3(&dev, None, &zip(&[("manifest.json", &m("1.2"))])));
    let f = weigh(&l.lib, "w1", &unsigned, &store(&dev.id()), &Ops::quick()).unwrap_err();
    assert_eq!(f.kind, Kind::Package, "{f}");
    assert_tidy(&l, "w1");
    assert_eq!(l.version(&l.lib.join("w1")), "1.0");
}

fn uid(tag: &str) -> String {
    format!("{tag}{}", uuid::Uuid::new_v4().simple())
}

/// Neither tree went in: the one before is put back within the session, by
/// the next try of the update or by the minute's retry, never under a swap.
#[test]
fn a_failed_put_back_is_retried_in_the_same_session() {
    let l = Lib::new();
    // Only the first rename works: the live folder goes aside and stays there.
    let failing = |id: &str| {
        let live = l.lib.join(id);
        Ops {
            exchange: Box::new(|_, _| refuse(io::ErrorKind::Unsupported)),
            rename: Box::new(move |a, b| if a == live { fs::rename(a, b) } else { refuse(io::ErrorKind::PermissionDenied) }),
            ..Ops::quick()
        }
    };
    let (a, b) = (uid("pa"), uid("pb"));
    for id in [&a, &b] {
        staged_update(&l, id);
        assert!(apply(&l.lib, id, &failing(id)).unwrap_err().message.contains("could not be put back"));
        assert!(!l.lib.join(id).exists() && l.lib.join(format!(".{id}.prev.new")).is_dir());
    }

    // The update tried again puts the folder back first, then goes in.
    assert_eq!(apply(&l.lib, &a, &Ops::quick()).unwrap().to, "1.1");
    assert_eq!(l.version(&l.lib.join(format!(".{a}.prev"))), "1.0", "the one put back is the one kept aside");

    // The retry leaves one being swapped to its swap, then puts it back.
    {
        let _swapping = crate::space::local::extensions::usage::exclusive(&b, Duration::ZERO).unwrap();
        assert_eq!(put_back_all(&l.lib, &Ops::quick()), 0);
    }
    assert_eq!(put_back_all(&l.lib, &Ops::quick()), 1);
    assert_eq!(l.version(&l.lib.join(&b)), "1.0");
    assert_eq!(waiting(&l.lib), std::slice::from_ref(&b), "its update still waits");
}

/// The store's package goes only over a folder whose key gives the store's
/// id, or that has none; and only as the version update2 named.
#[test]
fn a_store_package_goes_only_where_its_id_and_version_fit() {
    let l = Lib::new();
    let (dev, st, other) = (Key::new(), Key::new(), Key::new());
    let _store = stand_in(&st);
    let id = uid("k");
    // Taken as the store's item (from a sync record), though its key says otherwise.
    l.live(&id, "", &[("manifest.json", &m_with("1.0", json!({ "key": b64(&other.spki) })))], Some((&dev.id(), How::User)));
    let pkg = crx3(&dev, Some(&st), &zip(&[("manifest.json", &m("1.1"))]));
    let f = l.stage(&id, &pkg, &store(&dev.id())).unwrap_err();
    assert_eq!(f.kind, Kind::IdConflict, "{f}");
    assert_eq!(chrome_id(&l.root(&id)).unwrap(), other.id());
    assert_tidy(&l, &id);

    let id = uid("v");
    l.live(&id, "", &[("manifest.json", &m("1.0"))], Some((&dev.id(), How::Link)));
    let f = l.stage(&id, &pkg, &store(&dev.id()).expecting("1.2")).unwrap_err();
    assert_eq!(f.kind, Kind::Package);
    assert!(f.message.contains("named version 1.2 but sent 1.1"), "{f}");
    assert_tidy(&l, &id);
    assert!(l.stage(&id, &pkg, &store(&dev.id()).expecting("1.1.0")).is_ok(), "1.1 and 1.1.0 are one version");
}
