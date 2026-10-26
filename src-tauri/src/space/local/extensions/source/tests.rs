//! The launch pass: a source found once from the files, `.added` moved out,
//! and nothing else in the library touched, however often it runs.

use super::super::chrome_id::{chrome_id, decode_key, id_from_key};
use super::super::manifest_root;
use super::super::testkit::verified_contents;
use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const PHANTOM_KEY: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjcmb0xbGzvg9N2018hVht6y7J6bJjiYtYuw2Mtxrr2vcKXKImxmrryTY9ksBV/00PdqWCHr0DOF6H9gofmTCyOIFGJ37+XejfmWjbkB6qWJHCH1zxiKGCG7TAoGN/Ony4jgsseIZlOmLDOR1+iiNz8dqdth7twRZ4dp+HqjG7e6M7Nj0tRnUscYSdxJCa0pz8V9F442QbzEh/41O3zAo/gP0dqVk3LYqX7xalXPNsTUm9MG1wZcL1jQHi96Oc5nUPQY32gAMDv+CrBr5ylAsDB36cgQSEKdQzFXgVRDq0DJ+Z93CAQ4tHcWNm8jd2YQtp0KuNmwgUec0cAM0UATW6QIDAQAB";
const PHANTOM_ID: &str = "bfnaelmomeimhlpmgjnjophhpkkoljpa";
const KEPLR_ID: &str = "dmkamcknogkgcdfhhbddcghachkejeap";

struct Tmp(PathBuf);

impl Tmp {
    fn new(tag: &str) -> Tmp {
        let p = std::env::temp_dir().join(format!("shardx-src-{tag}-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn put(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, body).unwrap();
}

fn manifest(extra: &str) -> String {
    format!("{{{extra}\"name\": \"x\", \"version\": \"1.0\", \"manifest_version\": 3}}")
}

#[test]
fn the_source_comes_from_the_key_then_the_stores_contents() {
    let t = Tmp::new("recover");
    let root = t.0.join("a");
    put(&root.join("manifest.json"), &manifest(&format!("\"key\": \"{PHANTOM_KEY}\", ")));
    // The key wins over whatever else lies there.
    put(&root.join("_metadata/verified_contents.json"), &verified_contents(KEPLR_ID, "1.0"));
    let o = recover(&root);
    assert_eq!((o.source, o.how), (Some(SourceRef::webstore(PHANTOM_ID)), Some(How::ManifestKey)));

    put(&root.join("manifest.json"), &manifest(""));
    let o = recover(&root);
    assert_eq!((o.source, o.how), (Some(SourceRef::webstore(KEPLR_ID)), Some(How::VerifiedContents)));
    assert_eq!(o.store_item, Some(StoreItem { id: KEPLR_ID.into(), version: "1.0".into() }));

    fs::remove_dir_all(root.join("_metadata")).unwrap();
    assert_eq!(recover(&root), Origin::default());
    // A key Chrome cannot read loads nothing, so names nothing.
    put(&root.join("manifest.json"), &manifest("\"key\": \"@@\", "));
    assert_eq!(recover(&root), Origin::default());
}

#[test]
fn the_pass_records_once_and_moves_added_out() {
    let t = Tmp::new("once");
    let lib = &t.0;
    put(&lib.join("k/manifest.json"), &manifest(""));
    put(&lib.join("k/_metadata/verified_contents.json"), &verified_contents(KEPLR_ID, "1.0"));
    put(&lib.join("k/.added"), "@1788452094\n");
    put(&lib.join("m/manifest.json"), &manifest(""));

    assert_eq!(pass(lib), Pass { written: 2, moved: 1, failed: 0 });
    let k = read(lib, "k").unwrap();
    assert_eq!((k.source, k.how, k.recovered), (Some(SourceRef::webstore(KEPLR_ID)), Some(How::VerifiedContents), true));
    assert_eq!(k.added_at.as_deref(), Some("@1788452094"));
    assert!(!lib.join("k/.added").exists());
    let m = read(lib, "m").unwrap();
    assert_eq!((m.source, m.added_at, m.recovered), (None, None, true));

    // Chrome deletes `_metadata/`, a key appears: the source found stays as it was.
    fs::remove_dir_all(lib.join("k/_metadata")).unwrap();
    put(&lib.join("m/manifest.json"), &manifest(&format!("\"key\": \"{PHANTOM_KEY}\", ")));
    let sides = [fs::read(side_path(lib, "k")).unwrap(), fs::read(side_path(lib, "m")).unwrap()];
    assert_eq!(pass(lib), Pass::default());
    assert_eq!(sides, [fs::read(side_path(lib, "k")).unwrap(), fs::read(side_path(lib, "m")).unwrap()]);
}

#[test]
fn a_date_already_kept_stays_and_a_synced_source_is_not_wiped() {
    let t = Tmp::new("kept");
    let lib = &t.0;
    put(&lib.join("a/manifest.json"), &manifest(""));
    put(&lib.join("a/.added"), "@2");
    let synced = SourceLocal { source: Some(SourceRef::webstore(KEPLR_ID)), added_at: Some("@1".into()), ..SourceLocal::default() };
    write(lib, "a", &synced).unwrap();
    assert_eq!(pass(lib), Pass { written: 1, moved: 1, failed: 0 });
    let a = read(lib, "a").unwrap();
    assert_eq!((a.source, a.added_at.as_deref(), a.recovered), (Some(SourceRef::webstore(KEPLR_ID)), Some("@1"), true));
    assert!(!lib.join("a/.added").exists());
}

#[test]
fn a_folder_it_cannot_read_is_left_as_it_is() {
    let t = Tmp::new("broken");
    let lib = &t.0;
    put(&lib.join("bad/manifest.json"), "{ not json");
    put(&lib.join("bad/.added"), "@1");
    put(&lib.join("none/readme.txt"), "not an extension");
    put(&lib.join("none/.added"), "@1");
    for _ in 0..2 {
        assert_eq!(pass(lib), Pass { written: 0, moved: 0, failed: 1 });
    }
    assert!(lib.join("bad/.added").exists() && lib.join("none/.added").exists());
    assert!(read(lib, "bad").is_none() && read(lib, "none").is_none());
}

#[test]
fn a_nested_root_is_read_where_chrome_reads_it() {
    let t = Tmp::new("nested");
    let lib = &t.0;
    put(&lib.join("n/inner/manifest.json"), &manifest(""));
    put(&lib.join("n/inner/_metadata/verified_contents.json"), &verified_contents(KEPLR_ID, "1.0"));
    put(&lib.join("n/.added"), "@5");
    pass(lib);
    let n = read(lib, "n").unwrap();
    assert_eq!((n.source, n.added_at.as_deref()), (Some(SourceRef::webstore(KEPLR_ID)), Some("@5")));
    assert!(lib.join("n/inner/manifest.json").exists() && !lib.join("n/.added").exists());
}

/// Every file under `dir` by its path from there, as its SHA-256; folders as "dir".
fn snapshot(dir: &Path) -> BTreeMap<String, String> {
    fn walk(base: &Path, at: &Path, out: &mut BTreeMap<String, String>) {
        for e in fs::read_dir(at).unwrap().flatten() {
            let p = e.path();
            let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
            if e.file_type().unwrap().is_dir() {
                out.insert(rel, "dir".into());
                walk(base, &p, out);
            } else {
                out.insert(rel, format!("{:x}", Sha256::digest(fs::read(&p).unwrap())));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap().flatten() {
        if e.file_type().unwrap().is_dir() {
            copy_tree(&e.path(), &to.join(e.file_name()));
        } else {
            fs::copy(e.path(), to.join(e.file_name())).unwrap();
        }
    }
}

/// A real library to copy, only when named in SHARDX_TEST_LIBRARY: by default
/// a test never reads the owner's folders.
fn real_library() -> Option<PathBuf> {
    let lib = PathBuf::from(std::env::var_os("SHARDX_TEST_LIBRARY")?);
    let any = fs::read_dir(&lib).ok()?.flatten().any(|e| e.path().is_dir());
    any.then_some(lib)
}

/// The copy as before any launch pass: `.added` back from its side file, which goes.
fn as_before_the_pass(lib: &Path) {
    for e in fs::read_dir(lib).unwrap().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".source.json") else { continue };
        if !lib.join(id).is_dir() {
            continue;
        }
        if let Some(at) = read(lib, id).and_then(|s| s.added_at) {
            fs::write(lib.join(id).join(ADDED), at).unwrap();
        }
        fs::remove_file(e.path()).unwrap();
    }
}

/// Shaped like the owner's: a store key, the store's contents, neither, a
/// nested root, one recorded already, plus what the pass must not touch.
fn synthetic_library(lib: &Path) {
    put(&lib.join("phantom/manifest.json"), &manifest(&format!("\"key\": \"{PHANTOM_KEY}\", ")));
    put(&lib.join("phantom/.added"), "@1788452083");
    put(&lib.join("keplr/manifest.json"), &manifest(""));
    put(&lib.join("keplr/_metadata/verified_contents.json"), &verified_contents(KEPLR_ID, "1.0"));
    put(&lib.join("keplr/.added"), "@1788452094");
    put(&lib.join("metamask/manifest.json"), "{\"name\": \"__MSG_appName__\", \"default_locale\": \"en\", \"version\": \"13.46.1.0\"}");
    put(&lib.join("metamask/_locales/en/messages.json"), "{\"appName\": {\"message\": \"MetaMask\"}}");
    put(&lib.join("metamask/.added"), "@1788452072");
    put(&lib.join("nested/rabby/manifest.json"), &manifest(""));
    put(&lib.join("nested/.added"), "@1788452010");
    put(&lib.join("done/manifest.json"), &manifest(""));
    write(lib, "done", &SourceLocal { recovered: true, added_at: Some("@1".into()), ..SourceLocal::default() }).unwrap();
    put(&lib.join("broken/manifest.json"), "{");
    put(&lib.join("broken/.added"), "@3");
    put(&lib.join(".old.staging/tree/manifest.json"), &manifest(""));
    put(&lib.join("stray.txt"), "x");
}

/// What the owner's next launch does to the library, run twice: every id
/// Chrome derives stays, and only side files and `.added` change.
#[test]
fn the_launch_pass_twice_keeps_every_id_and_touches_only_side_files() {
    let t = Tmp::new("library");
    let lib = t.0.join("extensions");
    let real = real_library();
    match &real {
        Some(from) => {
            copy_tree(from, &lib);
            as_before_the_pass(&lib);
        }
        None => synthetic_library(&lib),
    }
    let folders: Vec<String> = fs::read_dir(&lib)
        .unwrap()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| super::super::valid_id(n))
        .collect();
    let ids = || -> BTreeMap<String, String> {
        folders.iter().map(|f| (f.clone(), format!("{:?}", chrome_id(&manifest_root(&lib.join(f))).map_err(|e| e.to_string())))).collect()
    };
    let added: BTreeMap<String, String> = folders
        .iter()
        .filter_map(|f| fs::read_to_string(lib.join(f).join(ADDED)).ok().map(|s| (f.clone(), s.trim().to_string())))
        .collect();
    let (ids_before, before) = (ids(), snapshot(&lib));

    let first = pass(&lib);
    let after = snapshot(&lib);
    assert_eq!(ids(), ids_before, "no id Chrome derives changed");
    for (path, hash) in &before {
        match path.strip_suffix("/.added") {
            Some(f) if !after.contains_key(path) => {
                assert_eq!(read(&lib, f).and_then(|s| s.added_at), added.get(f).cloned(), "{f}: the date moved, not lost");
            }
            _ => assert_eq!(after.get(path), Some(hash), "{path} changed"),
        }
    }
    for path in after.keys().filter(|p| !before.contains_key(*p)) {
        let f = path.strip_suffix(".source.json").unwrap_or_else(|| panic!("{path} appeared"));
        assert!(folders.iter().any(|x| x == f), "{path} is no folder's");
    }

    // The source each folder's files prove.
    for f in &folders {
        let root = manifest_root(&lib.join(f));
        let Some(side) = read(&lib, f) else { continue };
        assert!(side.recovered, "{f}");
        let m = read_manifest(&root).unwrap();
        let proved = match m.get("key").and_then(|k| k.as_str()) {
            Some(k) => decode_key(k).map(|der| SourceRef::webstore(&id_from_key(&der))),
            None => recover(&root).source,
        };
        if side.how.is_some() {
            assert_eq!(side.source, proved, "{f}");
        }
        eprintln!("[launch pass] {f}: {:?} {:?} {:?}", side.source, side.how, side.added_at);
    }
    eprintln!("[launch pass] {} folders: {first:?}", folders.len());
    assert_eq!(first.moved, added.keys().filter(|f| !lib.join(f).join(ADDED).exists()).count());
    if real.is_none() {
        assert_eq!(first, Pass { written: 4, moved: 4, failed: 1 });
        assert_eq!(read(&lib, "phantom").unwrap().source, Some(SourceRef::webstore(PHANTOM_ID)));
        assert_eq!(read(&lib, "keplr").unwrap().source, Some(SourceRef::webstore(KEPLR_ID)));
        assert_eq!(read(&lib, "metamask").unwrap().source, None);
        assert!(lib.join("broken/.added").exists(), "a folder it cannot read keeps everything");
    }

    let second = pass(&lib);
    assert_eq!((second.written, second.moved, second.failed), (0, 0, first.failed));
    assert_eq!(snapshot(&lib), after, "the second pass changed nothing");
    assert_eq!(ids(), ids_before);
}
