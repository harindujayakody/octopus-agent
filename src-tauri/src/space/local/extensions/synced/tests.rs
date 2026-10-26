//! Sync's packages laid down: a missing folder as it comes, an installed one
//! through the swap at its own root, and what is kept out stays out.

use super::*;
use crate::space::local::extensions::chrome_id::chrome_id;
use crate::space::local::extensions::manifest_edit::KeyAction;
use crate::space::local::extensions::swap::Staged;
use crate::space::local::extensions::testkit::{manifest, write_tree, zip, Key, Tmp};
use base64::Engine;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Mutex;

/// Running browsers as a test says they are.
#[derive(Default)]
struct Held(Mutex<Vec<String>>);

impl World for Held {
    fn running_with(&self, _lib_id: &str) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
    fn untracked(&self) -> Vec<String> {
        Vec::new()
    }
    fn paused(&self) -> bool {
        false
    }
}

struct Lib {
    tmp: Tmp,
    lib: PathBuf,
}

impl Lib {
    fn new() -> Lib {
        let tmp = Tmp::new("ext-synced");
        let lib = tmp.0.join("extensions");
        fs::create_dir_all(&lib).unwrap();
        Lib { tmp, lib }
    }

    /// The package another computer sent, as a file.
    fn package(&self, files: &[(&str, &[u8])]) -> PathBuf {
        let p = self.tmp.0.join(format!("{}.zip", uuid::Uuid::new_v4().simple()));
        fs::write(&p, zip(files)).unwrap();
        p
    }

    fn version(&self, id: &str) -> String {
        live_version(&self.lib, id).unwrap()
    }

    fn side(&self, id: &str) -> SourceLocal {
        source::read(&self.lib, id).unwrap()
    }
}

/// Ids nobody else's test uses: the swap marks are the process's own.
fn uid() -> String {
    format!("s{}", uuid::Uuid::new_v4().simple())
}

fn key_text(k: &Key) -> String {
    base64::engine::general_purpose::STANDARD.encode(&k.spki)
}

#[test]
fn a_folder_this_computer_lacks_comes_as_it_is_with_its_date_and_record() {
    let l = Lib::new();
    let id = uid();
    let m = manifest("1.0", json!({}));
    let pkg = l.package(&[("manifest.json", m.as_bytes()), ("bg.js", b"x"), (".added", b"@1700000000\n")]);
    let src = SourceRef::webstore("nkbihfbeogaeaoehlefnkodbefgpgknn");
    assert_eq!(lay_down(&Held::default(), &l.lib, &id, &pkg, 4, None, Some(src.clone())), Laid::Applied);
    assert_eq!(l.version(&id), "1.0");
    assert!(!l.lib.join(&id).join(".added").exists(), "its date moved out of the folder");
    let side = l.side(&id);
    assert_eq!((side.source, side.applied_package_rev, side.added_at.as_deref()), (Some(src), Some(4), Some("@1700000000")));
    assert!(side.recovered);
    assert!(!Paths::new(&l.lib, &id).staging().exists());

    // Without a source in its record, a key in its files names one.
    let (key, id2) = (Key::new(), uid());
    let m = manifest("1.0", json!({ "key": key_text(&key) }));
    let pkg = l.package(&[("manifest.json", m.as_bytes())]);
    assert_eq!(lay_down(&Held::default(), &l.lib, &id2, &pkg, 1, None, None), Laid::Applied);
    let side = l.side(&id2);
    assert_eq!((side.source, side.how), (Some(SourceRef::webstore(&key.id())), Some(How::ManifestKey)));
    assert!(side.added_at.is_some_and(|a| a.starts_with('@')));

    // No extension in it: nothing is left behind.
    let id3 = uid();
    let bad = l.package(&[("readme.txt", b"no manifest")]);
    assert!(matches!(lay_down(&Held::default(), &l.lib, &id3, &bad, 1, None, None), Laid::Failed(_)));
    assert!(!l.lib.join(&id3).exists() && source::read(&l.lib, &id3).is_none());
}

#[test]
fn an_installed_one_is_swapped_at_its_own_root_and_keeps_its_id() {
    let l = Lib::new();
    let id = uid();
    write_tree(&l.lib.join(&id).join("wallet"), &[("manifest.json", manifest("1.0", json!({})).as_bytes()), ("bg.js", b"old")]);
    let before = chrome_id(&manifest_root(&l.lib.join(&id))).unwrap();
    let pkg = l.package(&[("manifest.json", manifest("1.1", json!({})).as_bytes()), ("bg.js", b"new")]);
    assert_eq!(lay_down(&Held::default(), &l.lib, &id, &pkg, 2, None, None), Laid::Applied);
    let root = l.lib.join(&id).join("wallet");
    assert_eq!(fs::read(root.join("bg.js")).unwrap(), b"new", "still under its own folder");
    assert_eq!(chrome_id(&manifest_root(&l.lib.join(&id))).unwrap(), before);
    assert_eq!(l.side(&id).applied_package_rev, Some(2));
    assert!(Paths::new(&l.lib, &id).prev().exists(), "the version before is kept aside");
    assert_eq!(plan(&l.lib, &id, 2, Some("1.1"), Some(1)), Plan::Have);
}

#[test]
fn a_held_one_waits_staged_and_goes_in_without_a_second_download() {
    let l = Lib::new();
    let id = uid();
    write_tree(&l.lib.join(&id), &[("manifest.json", manifest("1.0", json!({})).as_bytes())]);
    let world = Held::default();
    world.0.lock().unwrap().push("shop".into());
    let pkg = l.package(&[("manifest.json", manifest("1.1", json!({})).as_bytes())]);
    assert_eq!(lay_down(&world, &l.lib, &id, &pkg, 3, None, None), Laid::Waiting(vec!["shop".into()]));
    assert_eq!(l.version(&id), "1.0");
    assert_eq!(plan(&l.lib, &id, 3, Some("1.1"), Some(2)), Plan::Staged, "staged: nothing to download");
    assert_eq!(plan(&l.lib, &id, 4, Some("1.2"), Some(2)), Plan::Fetch, "a newer package is downloaded");
    assert_eq!(retry(&world, &l.lib, &id, 3, None), Laid::Waiting(vec!["shop".into()]));
    world.0.lock().unwrap().clear();
    assert_eq!(retry(&world, &l.lib, &id, 3, None), Laid::Applied);
    assert_eq!(l.version(&id), "1.1");
    assert_eq!(plan(&l.lib, &id, 3, Some("1.1"), Some(2)), Plan::Have);
}

#[test]
fn one_that_would_change_its_id_here_or_is_older_is_kept_out_and_not_fetched_again() {
    let l = Lib::new();
    let id = uid();
    write_tree(&l.lib.join(&id), &[("manifest.json", manifest("1.0", json!({})).as_bytes()), ("bg.js", b"mine")]);
    let keyed = manifest("1.1", json!({ "key": key_text(&Key::new()) }));
    let pkg = l.package(&[("manifest.json", keyed.as_bytes()), ("bg.js", b"theirs")]);
    let got = lay_down(&Held::default(), &l.lib, &id, &pkg, 5, None, None);
    assert!(matches!(got, Laid::Refused { conflict: true, .. }), "{got:?}");
    assert_eq!((l.version(&id), fs::read(l.lib.join(&id).join("bg.js")).unwrap()), ("1.0".into(), b"mine".to_vec()));
    assert_eq!(l.side(&id).refused_package_rev, Some(5));
    assert_eq!(plan(&l.lib, &id, 5, Some("1.1"), Some(4)), Plan::Have, "never fetched again");
    assert!(!Paths::new(&l.lib, &id).staging().exists());

    let older = l.package(&[("manifest.json", manifest("0.9", json!({})).as_bytes())]);
    let got = lay_down(&Held::default(), &l.lib, &id, &older, 6, None, None);
    assert!(matches!(got, Laid::Refused { conflict: false, .. }), "{got:?}");
    assert_eq!(l.side(&id).refused_package_rev, Some(6));

    // One that fits goes in, and nothing is refused any more.
    let next = l.package(&[("manifest.json", manifest("1.2", json!({})).as_bytes())]);
    assert_eq!(lay_down(&Held::default(), &l.lib, &id, &next, 7, None, None), Laid::Applied);
    let side = l.side(&id);
    assert_eq!((side.applied_package_rev, side.refused_package_rev), (Some(7), None));
}

#[test]
fn one_for_a_newer_engine_waits_staged_until_the_engine_is_new_enough() {
    let l = Lib::new();
    let id = uid();
    write_tree(&l.lib.join(&id), &[("manifest.json", manifest("1.0", json!({})).as_bytes())]);
    let m = manifest("1.1", json!({ "minimum_chrome_version": "130" }));
    let pkg = l.package(&[("manifest.json", m.as_bytes())]);
    let world = Held::default();
    assert_eq!(lay_down(&world, &l.lib, &id, &pkg, 2, Some("120.0.6099.5"), None), Laid::NeedsEngine("130".into()));
    assert_eq!(plan(&l.lib, &id, 2, Some("1.1"), Some(1)), Plan::Staged);
    assert_eq!(retry(&world, &l.lib, &id, 2, Some("120.0.6099.5")), Laid::NeedsEngine("130".into()));
    assert_eq!(l.version(&id), "1.0");
    assert_eq!(retry(&world, &l.lib, &id, 2, Some("131.0.1.0")), Laid::Applied);
    assert_eq!(l.version(&id), "1.1");
}

#[test]
fn what_is_here_already_is_not_fetched() {
    let l = Lib::new();
    let id = uid();
    write_tree(&l.lib.join(&id), &[("manifest.json", manifest("1.0", json!({})).as_bytes())]);
    assert_eq!(plan(&l.lib, &id, 3, Some("1.0"), Some(3)), Plan::Have, "a book from before the side file knew it");
    assert_eq!(plan(&l.lib, &id, 3, Some("1.0"), None), Plan::Fetch, "met for the first time: the files decide elsewhere");
    assert_eq!(plan(&l.lib, &uid(), 3, Some("1.0"), Some(3)), Plan::Fetch, "not here at all");
    take(&l.lib, &id, None, Some(3)).unwrap();
    assert_eq!(plan(&l.lib, &id, 3, Some("1.0"), Some(0)), Plan::Have);
    assert_eq!(plan(&l.lib, &id, 4, Some("1.0"), Some(3)), Plan::Fetch);
    // Met on a server anew: what another server's revisions said goes.
    let mut side = l.side(&id);
    side.refused_package_rev = Some(9);
    source::write(&l.lib, &id, &side).unwrap();
    met_anew(&l.lib, &id, None).unwrap();
    assert_eq!((l.side(&id).applied_package_rev, l.side(&id).refused_package_rev), (None, None));
    met_anew(&l.lib, &id, Some(3)).unwrap();
    assert_eq!(plan(&l.lib, &id, 3, Some("1.0"), Some(0)), Plan::Have);

    // The store's own update to that version waits here: it goes in first.
    let note = Staged {
        from: "1.0".into(),
        to: "1.3".into(),
        sha256: String::new(),
        origin: Origin::Store("nkbihfbeogaeaoehlefnkodbefgpgknn".into()),
        key: KeyAction::None,
        root: String::new(),
        grown: Vec::new(),
        identity: None,
        needs_engine: None,
        store_item: None,
        digest: String::new(),
        approved: true,
        at: 0,
    };
    let staging = Paths::new(&l.lib, &id).staging();
    fs::create_dir_all(&staging).unwrap();
    fs::write(staging.join("staged.json"), serde_json::to_vec(&note).unwrap()).unwrap();
    assert_eq!(plan(&l.lib, &id, 4, Some("1.3"), Some(3)), Plan::StoreFirst);
    assert_eq!(plan(&l.lib, &id, 4, Some("1.4"), Some(3)), Plan::Fetch, "a newer one than the store's is fetched");
}

#[test]
fn a_source_from_another_computer_never_unlinks_nor_outranks_a_key() {
    let l = Lib::new();
    let id = uid();
    write_tree(&l.lib.join(&id), &[("manifest.json", manifest("1.0", json!({})).as_bytes())]);
    let (a, b) = (SourceRef::webstore("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), SourceRef::webstore("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
    take(&l.lib, &id, Some(a.clone()), None).unwrap();
    assert_eq!((l.side(&id).source, l.side(&id).how), (Some(a.clone()), None));
    take(&l.lib, &id, None, None).unwrap();
    assert_eq!(l.side(&id).source, Some(a), "none named is no unlinking");

    let proven = SourceLocal { source: Some(b.clone()), how: Some(How::ManifestKey), recovered: true, ..SourceLocal::default() };
    source::write(&l.lib, &id, &proven).unwrap();
    take(&l.lib, &id, Some(SourceRef::webstore("cccccccccccccccccccccccccccccccc")), None).unwrap();
    assert_eq!(l.side(&id).source, Some(b), "the key here says otherwise");

    // Not here: no side file is made for it.
    let gone = uid();
    take(&l.lib, &gone, Some(SourceRef::webstore("dddddddddddddddddddddddddddddddd")), Some(1)).unwrap();
    sent(&l.lib, &gone, 2).unwrap();
    assert!(source::read(&l.lib, &gone).is_none());
}

/// A package that came while a fallback swap had the folder aside: it waits
/// for the swap, then looks again under the lock, and never lays an older
/// flat copy over what the swap just put back.
#[test]
fn a_package_met_mid_swap_is_weighed_against_what_the_swap_left() {
    let l = Lib::new();
    let id = uid();
    let p = Paths::new(&l.lib, &id);
    write_tree(&l.lib.join(&id).join("sub"), &[("manifest.json", manifest("2.0", json!({})).as_bytes()), ("bg.js", b"two")]);
    let before = chrome_id(&manifest_root(&l.lib.join(&id))).unwrap();

    let swap = usage::exclusive(&id, std::time::Duration::ZERO).unwrap();
    fs::rename(p.live(), p.prev_new()).unwrap();
    let older = l.package(&[("manifest.json", manifest("1.0", json!({})).as_bytes())]);
    let (lib, who) = (l.lib.clone(), id.clone());
    let laying = std::thread::spawn(move || lay_down(&Held::default(), &lib, &who, &older, 3, None, None));
    std::thread::sleep(std::time::Duration::from_millis(200));
    fs::rename(p.prev_new(), p.live()).unwrap();
    drop(swap);

    let got = laying.join().unwrap();
    assert!(matches!(got, Laid::Refused { conflict: false, .. }), "older than what is here: {got:?}");
    assert_eq!(l.version(&id), "2.0");
    assert_eq!(fs::read(l.lib.join(&id).join("sub").join("bg.js")).unwrap(), b"two");
    assert_eq!(chrome_id(&manifest_root(&l.lib.join(&id))).unwrap(), before);
}

/// A failed put back left the folder aside: the package goes over it put
/// back, at its own root, never into the empty place as it came.
#[test]
fn a_folder_left_aside_is_put_back_before_a_package_goes_in() {
    let l = Lib::new();
    let id = uid();
    let p = Paths::new(&l.lib, &id);
    write_tree(&l.lib.join(&id).join("sub"), &[("manifest.json", manifest("1.0", json!({})).as_bytes())]);
    let before = chrome_id(&manifest_root(&l.lib.join(&id))).unwrap();
    fs::rename(p.live(), p.prev_new()).unwrap();

    let pkg = l.package(&[("manifest.json", manifest("1.1", json!({})).as_bytes())]);
    assert_eq!(lay_down(&Held::default(), &l.lib, &id, &pkg, 2, None, None), Laid::Applied);
    assert_eq!(l.version(&id), "1.1");
    assert!(l.lib.join(&id).join("sub").join("manifest.json").is_file(), "still nested");
    assert_eq!(chrome_id(&manifest_root(&l.lib.join(&id))).unwrap(), before);
    assert!(!p.prev_new().exists());
    assert_eq!(swap::sweep(&l.lib, &Ops::quick()).restored, 0, "nothing left for the next start");
    assert_eq!(l.version(&id), "1.1");

    // A folder whose manifest does not read is left as it is.
    let bad = uid();
    write_tree(&l.lib.join(&bad), &[("manifest.json", b"{ half a")]);
    assert!(matches!(lay_down(&Held::default(), &l.lib, &bad, &pkg, 1, None, None), Laid::Failed(_)));
    assert_eq!(fs::read(l.lib.join(&bad).join("manifest.json")).unwrap(), b"{ half a");
}

/// A record naming a store item never gives a folder with a `key` another
/// item's source: its id comes from the key.
#[test]
fn a_records_source_never_contradicts_a_key() {
    let l = Lib::new();
    let key = Key::new();
    let other = SourceRef::webstore("cccccccccccccccccccccccccccccccc");
    let id = uid();
    write_tree(&l.lib.join(&id), &[("manifest.json", manifest("1.0", json!({ "key": key_text(&key) })).as_bytes())]);
    take(&l.lib, &id, Some(other.clone()), None).unwrap();
    assert_ne!(source::read(&l.lib, &id).and_then(|s| s.source), Some(other.clone()));
    take(&l.lib, &id, Some(SourceRef::webstore(&key.id())), None).unwrap();
    assert_eq!(l.side(&id).source, Some(SourceRef::webstore(&key.id())), "its own key's item is taken");

    let fresh_id = uid();
    let pkg = l.package(&[("manifest.json", manifest("1.0", json!({ "key": key_text(&key) })).as_bytes())]);
    assert_eq!(lay_down(&Held::default(), &l.lib, &fresh_id, &pkg, 1, None, Some(other)), Laid::Applied);
    let side = l.side(&fresh_id);
    assert_eq!((side.source, side.how), (Some(SourceRef::webstore(&key.id())), Some(How::ManifestKey)));
}
