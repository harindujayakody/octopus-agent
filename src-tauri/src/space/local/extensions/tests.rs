//! The library: installs with their source and key, refusals of what is
//! already here, and what a folder, a package and a digest leave out.

use super::testkit::{crx3, stand_in, verified_contents, zip, Key};
use super::*;
use std::path::{Path, PathBuf};

const PHANTOM_KEY: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjcmb0xbGzvg9N2018hVht6y7J6bJjiYtYuw2Mtxrr2vcKXKImxmrryTY9ksBV/00PdqWCHr0DOF6H9gofmTCyOIFGJ37+XejfmWjbkB6qWJHCH1zxiKGCG7TAoGN/Ony4jgsseIZlOmLDOR1+iiNz8dqdth7twRZ4dp+HqjG7e6M7Nj0tRnUscYSdxJCa0pz8V9F442QbzEh/41O3zAo/gP0dqVk3LYqX7xalXPNsTUm9MG1wZcL1jQHi96Oc5nUPQY32gAMDv+CrBr5ylAsDB36cgQSEKdQzFXgVRDq0DJ+Z93CAQ4tHcWNm8jd2YQtp0KuNmwgUec0cAM0UATW6QIDAQAB";
const PHANTOM_ID: &str = "bfnaelmomeimhlpmgjnjophhpkkoljpa";

const MANIFEST: &str = "{\n  \"name\": \"Wallet\",\n  \"version\": \"1.2.3\",\n  \"manifest_version\": 3\n}\n";

/// A data root of the test's own; the library is `lib`.
struct Lib {
    root: crate::store::TestRoot,
    lib: PathBuf,
}

impl Lib {
    fn new() -> Lib {
        let root = crate::store::test_root("ext-lib").with_config();
        let lib = crate::store::extensions_dir().unwrap();
        Lib { root, lib }
    }

    /// `bytes` as a file outside the library.
    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.root.path.join("in").join(name);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, bytes).unwrap();
        p
    }

    /// Everything in the library's folder, by name.
    fn names(&self) -> Vec<String> {
        let mut v: Vec<String> =
            std::fs::read_dir(&self.lib).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        v.sort();
        v
    }

    fn side(&self, id: &str) -> SourceLocal {
        source::read(&self.lib, id).expect("a side file")
    }
}

fn store_package(dev: &Key, store: &Key) -> Vec<u8> {
    crx3(dev, Some(store), &zip(&[("manifest.json", MANIFEST.as_bytes()), ("bg.js", b"1;")]))
}

/// The detail of an `already_in_library` refusal as its text gives it.
fn refusal_of(text: &str) -> serde_json::Value {
    let at = text.find("already_in_library ").unwrap_or_else(|| panic!("not already there: {text}"));
    serde_json::from_str(&text[at + "already_in_library ".len()..]).unwrap()
}

fn refusal(e: &anyhow::Error) -> serde_json::Value {
    let c = crate::space::error::find(e).unwrap_or_else(|| panic!("not a refusal: {e:#}"));
    assert_eq!((c.code(), c.status()), (ALREADY_IN_LIBRARY, 409), "{e:#}");
    let text = c.to_string();
    serde_json::from_str(text.strip_prefix("already_in_library ").expect("code first")).unwrap()
}

/// The download URL must come out as one unbroken string. It was once
/// written with a line continuation and shipped with the indentation still
/// in it, which the store answered with a 404.
#[test]
fn webstore_url_has_no_whitespace() {
    let id = "acmacodkjbdgmoleebolmdjonilkdbch";
    for raw in [
        id,
        "https://chromewebstore.google.com/detail/rabby-wallet/acmacodkjbdgmoleebolmdjonilkdbch",
        "https://chromewebstore.google.com/detail/rabby-wallet/acmacodkjbdgmoleebolmdjonilkdbch?hl=en",
        "https://chrome.google.com/webstore/detail/rabby-wallet/acmacodkjbdgmoleebolmdjonilkdbch",
    ] {
        let u = resolve_download_url(raw).unwrap();
        assert!(!u.contains(char::is_whitespace), "whitespace in {u}");
        assert!(u.starts_with("https://clients2.google.com/service/update2/crx?"), "{u}");
        assert!(u.contains("acceptformat=crx3&"), "{u}");
        assert!(u.ends_with(&format!("x=id%3D{id}%26uc")), "{u}");
    }
}

#[test]
fn direct_links_pass_through_and_lookalikes_are_not_the_store() {
    assert_eq!(resolve_download_url("https://example.com/a.crx").unwrap(), "https://example.com/a.crx");
    assert!(resolve_download_url("not a link").is_err());
    assert!(resolve_download_url("").is_err());
    // SEC-08: read as a URL, not searched for the store's name.
    for raw in [
        "https://chromewebstore.google.com.evil.com/detail/x/acmacodkjbdgmoleebolmdjonilkdbch",
        "https://evil.com/?u=chromewebstore.google.com/detail/x/acmacodkjbdgmoleebolmdjonilkdbch",
        "https://chromewebstore.google.com@evil.com/detail/x/acmacodkjbdgmoleebolmdjonilkdbch",
    ] {
        assert_eq!(resolve_download_url(raw).unwrap(), raw);
        assert!(Want::of_link(raw).link.is_none(), "{raw}");
    }
}

/// Owner's decision 1: a new install from the store carries the store's key,
/// so Chrome gives it the store's id wherever its folder lies.
#[test]
fn a_store_package_gets_its_key_and_the_stores_id() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let e = import(&l.file("w.crx", &store_package(&dev, &store))).unwrap();
    assert_eq!(e.source, Some(SourceRef::webstore(&dev.id())));
    let root = load_path(&e.id).unwrap();
    let m = manifest_edit::read_manifest(&root).unwrap();
    assert_eq!(m["key"], base64::engine::general_purpose::STANDARD.encode(&dev.spki));
    assert_eq!(chrome_id::chrome_id(&root).unwrap(), dev.id());
    let text = std::fs::read_to_string(root.join("manifest.json")).unwrap();
    assert!(text.ends_with(&MANIFEST[1..]), "the rest is left as shipped: {text}");

    let side = l.side(&e.id);
    assert_eq!((side.how, side.crx_id.as_deref(), side.recovered), (Some(How::CrxHeader), Some(dev.id().as_str()), true));
    assert!(e.added_at.starts_with('@') && side.added_at.as_deref() == Some(e.added_at.as_str()));
    assert!(!root.join(".added").exists(), "nothing of the launcher's inside the folder");
    assert_eq!(l.names(), [e.id.clone(), format!("{}.source.json", e.id)], "no stage or download left");
    assert_eq!(list().unwrap()[0].source, e.source);
}

/// Owner's decision 1, with a real store key: the key Phantom ships gives Phantom's id.
#[test]
fn the_store_key_gives_the_store_id() {
    let dir = std::env::temp_dir().join(format!("shardx-ext-key-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("manifest.json"), MANIFEST).unwrap();
    let path_id = chrome_id::chrome_id(&dir).unwrap();
    let phantom = chrome_id::decode_key(PHANTOM_KEY).unwrap();
    manifest_edit::set_key(&dir, &phantom).unwrap();
    assert_eq!(chrome_id::chrome_id(&dir).unwrap(), PHANTOM_ID);
    assert_ne!(path_id, PHANTOM_ID);
    // Its own signer's key again: the file is left as it is.
    let text = std::fs::read_to_string(dir.join("manifest.json")).unwrap();
    manifest_edit::set_key(&dir, &phantom).unwrap();
    assert_eq!(std::fs::read_to_string(dir.join("manifest.json")).unwrap(), text);
    // Another key there is replaced by the signer's, as Chrome's unpacker does.
    let signer = Key::new();
    manifest_edit::set_key(&dir, &signer.spki).unwrap();
    assert_eq!(chrome_id::chrome_id(&dir).unwrap(), signer.id());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_same_store_item_again_is_refused_and_only_updating_is_offered() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let pkg = l.file("w.crx", &store_package(&dev, &store));
    let first = import(&pkg).unwrap();
    let before = l.names();
    for separate in [false, true] {
        let err = import_as(&pkg, separate).unwrap_err();
        let detail = refusal(&err);
        assert_eq!(detail, serde_json::json!({ "entry_id": first.id, "installed": "1.2.3", "separate": false }));
    }
    assert_eq!(l.names(), before, "nothing added, nothing left behind");
}

/// Several files: each refused one is named with why, and the rest go in.
#[tokio::test]
async fn several_files_say_each_refusal_and_keep_the_rest() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let good = l.file("w.crx", &store_package(&dev, &store));
    let broken = l.file("b.zip", b"not a zip");
    let paths: Vec<String> = [&good, &broken, &good].iter().map(|p| p.display().to_string()).collect();
    let r = import_each(&paths, |p| async move { import_as(&p, false) }).await;
    assert_eq!(r.added.len(), 1, "{:?}", r.refused);
    let refused: Vec<&str> = r.refused.iter().map(|x| x.path.as_str()).collect();
    assert_eq!(refused, [paths[1].as_str(), paths[2].as_str()]);
    assert!(!r.refused[1].error.contains(&paths[2]), "the error is the refusal alone: {}", r.refused[1].error);
    let again = refusal_of(&r.refused[1].error);
    assert_eq!(again["entry_id"], r.added[0].id.as_str(), "the same one again is told as already there");
}

/// Owner's decision 1 is about the store: a package signed only by its
/// developer keeps the folder's id, as a zip does, and names no store item.
#[test]
fn a_self_signed_package_gets_no_key_and_names_no_store() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let e = import(&l.file("w.crx", &crx3(&dev, None, &zip(&[("manifest.json", MANIFEST.as_bytes())])))).unwrap();
    assert_eq!(e.source, None);
    let root = load_path(&e.id).unwrap();
    assert!(manifest_edit::read_manifest(&root).unwrap().get("key").is_none());
    assert_eq!(chrome_id::chrome_id(&root).unwrap(), chrome_id::id_from_path(&root).unwrap());
    let side = l.side(&e.id);
    assert_eq!((side.how, side.crx_id.as_deref(), side.recovered), (None, Some(dev.id().as_str()), true));
}

/// A key is written only when the signatures prove it: a broken package
/// unpacks as before, its id from its folder.
#[test]
fn a_package_that_fails_its_check_unpacks_without_a_key() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let mut pkg = store_package(&dev, &store);
    // The signed id no longer names the developer's key; the zip is untouched.
    use sha2::Digest;
    let at = pkg.windows(16).position(|w| w == &sha2::Sha256::digest(&dev.spki)[..16]).unwrap();
    pkg[at] ^= 1;
    assert_eq!(crx::verify(&pkg, &crx::Expect::default()).unwrap_err(), crx::Reject::NoDeveloperProof);
    let e = import(&l.file("w.crx", &pkg)).unwrap();
    let root = load_path(&e.id).unwrap();
    assert!(manifest_edit::read_manifest(&root).unwrap().get("key").is_none());
    assert_eq!((e.source, l.side(&e.id).crx_id), (None, None));
}

#[test]
fn a_zip_or_a_folder_shows_its_source_from_its_files() {
    let l = Lib::new();
    let keplr = "dmkamcknogkgcdfhhbddcghachkejeap";
    let vc = verified_contents(keplr, "1.2.3");
    let z = import(&l.file(
        "k.zip",
        &zip(&[("manifest.json", MANIFEST.as_bytes()), ("_metadata/verified_contents.json", vc.as_bytes())]),
    ))
    .unwrap();
    assert_eq!(z.source, Some(SourceRef::webstore(keplr)));
    let side = l.side(&z.id);
    assert_eq!((side.how, side.store_item.map(|i| i.version)), (Some(How::VerifiedContents), Some("1.2.3".to_string())));

    let folder = l.root.path.join("phantom");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("manifest.json"), format!("{{\"key\": \"{PHANTOM_KEY}\", \"name\": \"P\", \"version\": \"1\"}}")).unwrap();
    let f = import(&folder).unwrap();
    assert_eq!((f.source, l.side(&f.id).how), (Some(SourceRef::webstore(PHANTOM_ID)), Some(How::ManifestKey)));
    // The same key again would load as the same extension.
    let err = import_as(&folder, true).unwrap_err();
    assert_eq!(refusal(&err)["separate"], false);
}

/// An older copy whose id comes from its folder: a store copy beside it gets
/// an id of its own, so it is offered, and made only when asked for.
#[test]
fn a_separate_copy_is_made_only_when_its_id_differs() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let vc = verified_contents(&dev.id(), "1.0.0");
    let old = import(&l.file(
        "old.zip",
        &zip(&[("manifest.json", MANIFEST.as_bytes()), ("_metadata/verified_contents.json", vc.as_bytes())]),
    ))
    .unwrap();
    let pkg = l.file("w.crx", &store_package(&dev, &store));
    let detail = refusal(&import(&pkg).unwrap_err());
    assert_eq!(detail, serde_json::json!({ "entry_id": old.id, "installed": "1.2.3", "separate": true }));

    let copy = import_as(&pkg, true).unwrap();
    assert_eq!(copy.source, old.source);
    let ids = [&old, &copy].map(|e| chrome_id::chrome_id(&load_path(&e.id).unwrap()).unwrap());
    assert_eq!(ids[1], dev.id());
    assert_ne!(ids[0], ids[1]);
    assert_eq!(list().unwrap().len(), 2);
}

#[test]
fn list_sees_only_extension_folders() {
    let l = Lib::new();
    let e = import(&l.file("w.zip", &zip(&[("manifest.json", MANIFEST.as_bytes())]))).unwrap();
    for stray in [".x.staging/tree", ".y.prev", "a.b"] {
        std::fs::create_dir_all(l.lib.join(stray)).unwrap();
        std::fs::write(l.lib.join(stray).join("manifest.json"), MANIFEST).unwrap();
    }
    std::fs::write(l.lib.join(".x.part"), b"Cr24").unwrap();
    std::fs::write(l.lib.join("orphan.source.json"), b"{}").unwrap();
    let got = list().unwrap();
    assert_eq!(got.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), [e.id.as_str()]);
}

#[test]
fn delete_takes_the_side_file_and_what_was_left_beside_it() {
    let l = Lib::new();
    let a = import(&l.file("a.zip", &zip(&[("manifest.json", MANIFEST.as_bytes())]))).unwrap();
    let b = import(&l.file("b.zip", &zip(&[("manifest.json", MANIFEST.as_bytes())]))).unwrap();
    std::fs::create_dir_all(l.lib.join(format!(".{}.staging/tree", a.id))).unwrap();
    std::fs::create_dir_all(l.lib.join(format!(".{}.prev", a.id))).unwrap();
    std::fs::write(l.lib.join(format!(".{}.part", a.id)), b"x").unwrap();
    delete(&a.id).unwrap();
    assert_eq!(l.names(), [b.id.clone(), format!("{}.source.json", b.id)]);
}

fn zipped_names(dir: &Path) -> Vec<String> {
    let out = dir.parent().unwrap().join(format!("{}.zip", uuid::Uuid::new_v4().simple()));
    zip_dir(dir, &out).unwrap();
    let z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
    let mut names: Vec<String> = z.file_names().map(str::to_string).collect();
    names.sort();
    let _ = std::fs::remove_file(out);
    names
}

#[test]
fn packages_and_the_digest_leave_out_metadata_and_added() {
    let dir = std::env::temp_dir().join(format!("shardx-ext-pack-{}", uuid::Uuid::new_v4().simple())).join("x");
    std::fs::create_dir_all(dir.join("js/_metadata")).unwrap();
    std::fs::write(dir.join("manifest.json"), MANIFEST).unwrap();
    std::fs::write(dir.join("js/bg.js"), b"1;").unwrap();
    std::fs::write(dir.join("js/_metadata/own.json"), b"{}").unwrap();
    let digest = files_digest(&dir).unwrap();

    std::fs::create_dir_all(dir.join("_metadata")).unwrap();
    std::fs::write(dir.join("_metadata/verified_contents.json"), b"[]").unwrap();
    std::fs::write(dir.join(".added"), b"@1").unwrap();
    assert_eq!(zipped_names(&dir), ["js/_metadata/own.json", "js/bg.js", "manifest.json"]);
    assert_eq!(files_digest(&dir).unwrap(), digest, "Chrome's cleanup and the launcher's marker do not count");

    std::fs::write(dir.join("js/bg.js"), b"12;").unwrap();
    let grown = files_digest(&dir).unwrap();
    assert_ne!(grown, digest);
    std::fs::write(dir.join("manifest.json"), MANIFEST.replace("1.2.3", "1.2.4")).unwrap();
    assert_ne!(files_digest(&dir).unwrap(), grown, "the version counts");
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

/// Moving `.added` out must not change the entry: its size is in the sync hash.
#[test]
fn the_size_is_the_same_before_and_after_added_moves() {
    let l = Lib::new();
    let e = import(&l.file("w.zip", &zip(&[("manifest.json", MANIFEST.as_bytes())]))).unwrap();
    std::fs::write(l.lib.join(&e.id).join(".added"), b"@1788452094").unwrap();
    let with = list().unwrap().remove(0);
    let _ = std::fs::remove_file(l.lib.join(&e.id).join(".added"));
    let without = list().unwrap().remove(0);
    assert_eq!((with.size_bytes, with.added_at), (without.size_bytes, without.added_at));
}

/// A store on 127.0.0.1 that answers every GET with `body`; how many it served.
async fn serve(body: Vec<u8>) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/service/update2/crx", listener.local_addr().unwrap());
    let served = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = served.clone();
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
            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = conn.write_all(head.as_bytes()).await;
            let _ = conn.write_all(&body).await;
        }
    });
    (base, served)
}

struct Served;

fn served_from(base: &str) -> Served {
    TEST_STORE.with(|c| *c.borrow_mut() = Some(base.to_string()));
    Served
}

impl Drop for Served {
    fn drop(&mut self) {
        TEST_STORE.with(|c| *c.borrow_mut() = None);
    }
}

#[tokio::test]
async fn a_store_link_installs_the_signed_package_once() {
    let l = Lib::new();
    let (dev, store) = (Key::new(), Key::new());
    let _store = stand_in(&store);
    let (base, served) = serve(store_package(&dev, &store)).await;
    let _from = served_from(&base);
    let link = format!("https://chromewebstore.google.com/detail/wallet/{}", dev.id());

    let e = import_url_as(&link, false).await.unwrap();
    assert_eq!(e.source, Some(SourceRef::webstore(&dev.id())));
    assert_eq!(l.side(&e.id).how, Some(How::Link));
    assert_eq!(chrome_id::chrome_id(&load_path(&e.id).unwrap()).unwrap(), dev.id());
    assert_eq!(l.names(), [e.id.clone(), format!("{}.source.json", e.id)], "no download left");

    // Asked again: refused before anything is downloaded.
    let detail = refusal(&import_url_as(&dev.id(), true).await.unwrap_err());
    assert_eq!((detail["entry_id"].as_str(), detail["separate"].as_bool()), (Some(e.id.as_str()), Some(false)));
    assert_eq!(served.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_store_link_takes_only_the_stores_package_for_that_id() {
    let l = Lib::new();
    let (dev, store, other) = (Key::new(), Key::new(), Key::new());
    let _store = stand_in(&store);
    let wanted = Key::new().id();
    let cases = [
        (store_package(&dev, &store), wanted.clone(), "not ".to_string() + &wanted),
        (crx3(&dev, None, &zip(&[("manifest.json", MANIFEST.as_bytes())])), dev.id(), "not signed by the Web Store".into()),
        (crx3(&dev, Some(&other), &zip(&[("manifest.json", MANIFEST.as_bytes())])), dev.id(), "not signed by the Web Store".into()),
        (zip(&[("manifest.json", MANIFEST.as_bytes())]), dev.id(), "did not send a CRX3".into()),
    ];
    for (body, id, why) in cases {
        let (base, _) = serve(body).await;
        let _from = served_from(&base);
        let err = import_url_as(&id, false).await.unwrap_err();
        assert!(format!("{err:#}").contains(&why), "{err:#}");
        assert!(l.names().is_empty(), "nothing kept: {:?}", l.names());
    }
}

/// A library id is a plain name: never a dot file, a path or a drive.
#[test]
fn an_id_is_a_plain_name() {
    for good in ["00c4349c38d24350aab21b3a29b8782f", "00c4349c-38d2-4350-aab2-1b3a29b8782f", "e1", "a_b"] {
        assert!(valid_id(good), "{good}");
    }
    for bad in ["", "D:", "C:x", "..", ".x", "a/b", "a\\b", "a b", "ä", &"a".repeat(65)] {
        assert!(!valid_id(bad), "{bad:?}");
    }
}

/// What Chrome reads (a BOM, comments) is listed; what nothing reads never
/// gets into the library, and nothing of it stays.
#[test]
fn a_manifest_chrome_reads_is_listed_and_one_nobody_reads_is_refused() {
    let l = Lib::new();
    let bom = format!("\u{feff}// shipped so\n{}", MANIFEST.replace("\"Wallet\"", "\"Wallet\" /* name */"));
    let e = import(&l.file("w.zip", &zip(&[("manifest.json", bom.as_bytes())]))).unwrap();
    assert_eq!((e.name.as_str(), e.version.as_str()), ("Wallet", "1.2.3"));
    assert_eq!(list().unwrap().len(), 1);

    let err = import(&l.file("bad.zip", &zip(&[("manifest.json", b"{ half a")]))).unwrap_err();
    assert!(format!("{err:#}").contains("cannot be read"), "{err:#}");
    assert_eq!(l.names(), [e.id.clone(), format!("{}.source.json", e.id)], "nothing of it kept");

    // One already there that stops reading is unlisted, never gone.
    std::fs::write(l.lib.join(&e.id).join("manifest.json"), b"{ half a").unwrap();
    assert!(list().unwrap().is_empty());
    assert!(unlisted(&l.lib, &e.id));
    assert!(!unlisted(&l.lib, "nothere"));
}

/// The Web Store's package carrying a `key` that is not its signer's gets the
/// signer's, as Chrome's unpacker does: its id is the store's.
#[test]
fn a_store_package_with_a_foreign_key_gets_its_signers() {
    let l = Lib::new();
    let (dev, store, foreign) = (Key::new(), Key::new(), Key::new());
    let _store = stand_in(&store);
    let m = format!("{{\n  \"key\": \"{}\",\n{}", base64::engine::general_purpose::STANDARD.encode(&foreign.spki), &MANIFEST[2..]);
    let pkg = crx3(&dev, Some(&store), &zip(&[("manifest.json", m.as_bytes())]));
    let e = import(&l.file("w.crx", &pkg)).unwrap();
    assert_eq!(chrome_id::chrome_id(&load_path(&e.id).unwrap()).unwrap(), dev.id());
    assert_eq!(e.source, Some(SourceRef::webstore(&dev.id())));
}

/// Unpacking is held to its byte and file limits whatever the archive says.
#[test]
fn unpacking_is_held_to_its_limits() {
    let l = Lib::new();
    let to = l.root.path.join("out");
    let one = |n: usize| {
        let names: Vec<String> = (0..n).map(|i| format!("f{i}")).collect();
        zip(&names.iter().map(|f| (f.as_str(), &b"12345"[..])).collect::<Vec<_>>())
    };
    unzip_within(&one(3), &to.join("a"), 15, 3).unwrap();
    let e = unzip_within(&one(4), &to.join("b"), 1 << 20, 3).unwrap_err();
    assert!(format!("{e:#}").contains("more than 3 files"), "{e:#}");
    let e = unzip_within(&one(3), &to.join("c"), 14, 10).unwrap_err();
    assert!(format!("{e:#}").contains("unpacks to more than"), "{e:#}");
}

/// An answer of the update check bigger than one is given up, not read whole.
#[tokio::test]
async fn an_oversized_answer_is_given_up() {
    let (base, _) = serve(vec![b'<'; SMALL_MAX + 1]).await;
    let e = get_small(&base, "test", std::time::Duration::from_secs(5)).await.unwrap_err();
    assert!(e.contains("too big"), "{e}");
    let (base, _) = serve(b"<gupdate/>".to_vec()).await;
    assert_eq!(get_small(&base, "test", std::time::Duration::from_secs(5)).await.unwrap(), b"<gupdate/>");
}
