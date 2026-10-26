//! Updates against a Web Store of the test's own: the check, Update, Link,
//! and what each leaves in the record, the library and the window.

use super::*;
use crate::space::local::extensions::chrome_id::chrome_id;
use crate::space::local::extensions::source::SourceLocal;
use crate::space::local::extensions::testkit::{crx3, manifest, stand_in, write_tree, zip, Key, StandIn, Tmp};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::sync::atomic::AtomicBool;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// What the test's store serves, and every request it got.
#[derive(Default)]
struct Shop {
    xml: Mutex<String>,
    blobs: Mutex<HashMap<String, Vec<u8>>>,
    /// (path and query, user agent)
    asked: Mutex<Vec<(String, String)>>,
    silent: AtomicBool,
    /// Packages that never come.
    hang: AtomicBool,
}

async fn open_shop() -> (Arc<Shop>, String) {
    let shop = Arc::new(Shop::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let s = shop.clone();
    tokio::spawn(async move {
        while let Ok((mut conn, _)) = listener.accept().await {
            let s = s.clone();
            tokio::spawn(async move {
                let (mut req, mut buf) = (Vec::new(), [0u8; 4096]);
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    match conn.read(&mut buf).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => req.extend_from_slice(&buf[..n]),
                    }
                }
                let head = String::from_utf8_lossy(&req).to_string();
                let target = head.split_whitespace().nth(1).unwrap_or("").to_string();
                let ua = head
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().starts_with("user-agent:").then(|| l[11..].trim().to_string()))
                    .unwrap_or_default();
                s.asked.lock().unwrap().push((target.clone(), ua));
                let hang = s.hang.load(Ordering::SeqCst) && target.starts_with("/crx/");
                if s.silent.load(Ordering::SeqCst) || hang {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    return;
                }
                let body = if target.starts_with("/service/update2/crx") {
                    Some(s.xml.lock().unwrap().clone().into_bytes())
                } else {
                    s.blobs.lock().unwrap().get(&target).cloned()
                };
                let status = if body.is_some() { "200 OK" } else { "404 Not Found" };
                let body = body.unwrap_or_default();
                let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = conn.write_all(head.as_bytes()).await;
                let _ = conn.write_all(&body).await;
            });
        }
    });
    (shop, origin)
}

/// Running browsers as a test says they are.
#[derive(Default)]
struct Fake {
    running: Mutex<HashMap<String, Vec<String>>>,
    paused: AtomicBool,
}

impl World for Fake {
    fn running_with(&self, lib_id: &str) -> Vec<String> {
        self.running.lock().unwrap().get(lib_id).cloned().unwrap_or_default()
    }
    fn untracked(&self) -> Vec<String> {
        Vec::new()
    }
    fn paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

fn sha(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn b64(der: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(der)
}

fn gupdate(apps: &[String]) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod">{}</gupdate>"#,
        apps.concat()
    )
}

const ALLOWED: &str = r#"_esbAllowlist="true""#;

/// A library, a record and a store of the test's own; `dev` makes the store item.
struct Rig {
    _tmp: Tmp,
    env: Env,
    shop: Arc<Shop>,
    told: Arc<Mutex<Vec<(String, Value)>>>,
    world: Arc<Fake>,
    dev: Key,
    st: Key,
    _store: StandIn,
}

impl Rig {
    async fn new() -> Rig {
        let (shop, origin) = open_shop().await;
        let tmp = Tmp::new("ext-updates");
        let lib = tmp.0.join("extensions");
        fs::create_dir_all(&lib).unwrap();
        let told = Arc::new(Mutex::new(Vec::new()));
        let heard = told.clone();
        let world = Arc::new(Fake::default());
        let (dev, st) = (Key::new(), Key::new());
        let _store = stand_in(&st);
        let env = Env {
            lib,
            book: tmp.0.join(BOOK),
            base: format!("{origin}/service/update2/crx"),
            blobs: Some(origin),
            engine: Some("156.0.8078.48".into()),
            world: world.clone(),
            ops: Arc::new(Ops::quick()),
            names: Arc::new(|id| format!("Profile {id}")),
            tell: Arc::new(move |e, p| heard.lock().unwrap().push((e.to_string(), p))),
            check_timeout: Duration::from_secs(5),
        };
        Rig { _tmp: tmp, env, shop, told, world, dev, st, _store }
    }

    fn sid(&self) -> String {
        self.dev.id()
    }

    /// A library extension of `files`, linked to this rig's item as `how`; its id.
    fn add(&self, files: &[(&str, &[u8])], how: Option<How>) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        write_tree(&self.env.lib.join(&id), files);
        let side = SourceLocal {
            source: how.map(|_| SourceRef::webstore(&self.sid())),
            how,
            added_at: Some("@1700000000".into()),
            recovered: true,
            ..SourceLocal::default()
        };
        source::write(&self.env.lib, &id, &side).unwrap();
        id
    }

    /// The store offers `files` as `version` of this rig's item; its package.
    fn offer(&self, version: &str, files: &[(&str, &[u8])], attrs: &str) -> Vec<u8> {
        let pkg = crx3(&self.dev, Some(&self.st), &zip(files));
        self.offer_pkg(version, &pkg, &sha(&pkg), pkg.len(), attrs);
        pkg
    }

    fn offer_pkg(&self, version: &str, pkg: &[u8], hash: &str, size: usize, attrs: &str) {
        let path = format!("/crx/{}_{}.crx", self.sid(), version.replace('.', "_"));
        self.shop.blobs.lock().unwrap().insert(path.clone(), pkg.to_vec());
        self.says(&[format!(
            r#"<app appid="{}" status="ok"><updatecheck {attrs} codebase="https://store.test{path}" hash_sha256="{hash}" size="{size}" status="ok" version="{version}"/></app>"#,
            self.sid()
        )]);
    }

    fn says(&self, apps: &[String]) {
        *self.shop.xml.lock().unwrap() = gupdate(apps);
    }

    fn says_nothing_new(&self) {
        self.says(&[format!(r#"<app appid="{}" status="ok"><updatecheck {ALLOWED} status="noupdate"/></app>"#, self.sid())]);
    }

    fn version(&self, id: &str) -> String {
        manifest_edit::read_manifest(&manifest_root(&self.env.lib.join(id))).unwrap()["version"].as_str().unwrap().to_string()
    }

    fn view(&self, id: &str) -> ExtensionUpdate {
        one(&self.env, id).unwrap()
    }

    fn item(&self, id: &str) -> Item {
        load(&self.env.book).items.get(&key(id)).cloned().unwrap_or_default()
    }

    /// Requests whose path starts with `prefix`.
    fn asked(&self, prefix: &str) -> Vec<(String, String)> {
        self.shop.asked.lock().unwrap().iter().filter(|(p, _)| p.starts_with(prefix)).cloned().collect()
    }

    fn told(&self, event: &str) -> Vec<Value> {
        self.told.lock().unwrap().iter().filter(|(e, _)| e == event).map(|(_, p)| p.clone()).collect()
    }

    /// What lies beside the live folders that is not a side file.
    fn leftovers(&self, id: &str) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(&self.env.lib)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(&format!(".{id}.")) && !n.starts_with(&format!(".{id}.prev")))
            .collect();
        v.sort();
        v
    }
}

fn m(version: &str) -> Vec<u8> {
    manifest(version, json!({})).into_bytes()
}

fn m_with(version: &str, extra: Value) -> Vec<u8> {
    manifest(version, extra).into_bytes()
}

#[tokio::test]
async fn nothing_linked_nothing_asked() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], None);
    assert_eq!(check(&r.env).await, Ok(News::default()));
    assert!(r.shop.asked.lock().unwrap().is_empty(), "no request without a linked extension");
    assert!(load(&r.env.book).last_check_at > 0);
    assert_eq!(r.view(&id).state, State::Unlinked);
}

/// One GET with the launcher's own UA and the engine's version; a new version
/// is news once.
#[tokio::test]
async fn the_check_finds_a_version_and_tells_of_it_once() {
    let mut r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    assert_eq!(r.view(&id).state, State::Unchecked);
    let pkg = r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);

    let news = check(&r.env).await.unwrap();
    assert_eq!(news.fresh, [Fresh { id: id.clone(), name: "Wallet".into(), version: "1.1".into() }]);
    let asked = r.asked("/service/update2/crx");
    assert_eq!(asked.len(), 1);
    let (url, ua) = &asked[0];
    assert_eq!(ua, &update2::user_agent());
    assert!(url.contains("prodversion=156.0.8078.48"), "{url}");
    assert!(url.contains(&format!("x=id%3D{}%26v%3D1.0%26uc", r.sid())), "{url}");
    assert!(r.asked("/crx/").is_empty(), "a check downloads nothing");

    let u = r.view(&id);
    assert_eq!((u.state, u.latest.as_deref(), u.size), (State::Available, Some("1.1"), Some(pkg.len() as u64)));
    assert_eq!(u.allowlisted, Some(true));
    let seen = u.first_seen.unwrap();
    assert!(r.told("store-changed").contains(&json!("extension-updates")));

    assert_eq!(check(&r.env).await.unwrap(), News::default(), "told once");
    assert_eq!(r.view(&id).first_seen, Some(seen), "the same version keeps its first sighting");

    // An engine of the person's own: the bundle's version stands in.
    r.env.engine = None;
    check(&r.env).await.unwrap();
    let last = r.asked("/service/update2/crx").pop().unwrap().0;
    assert!(last.contains(&format!("prodversion={}", crate::runtime::CHROMIUM_VERSION)), "{last}");
}

/// Design п.4: found, downloaded, staged, swapped in at the same path, and
/// Chrome still gives it the same id; its date stays.
#[tokio::test]
async fn an_update_lands_where_the_old_one_was_with_its_id() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m_with("1.0", json!({ "key": b64(&r.dev.spki) }))), ("bg.js", b"1;")], Some(How::Link));
    let before = chrome_id(&manifest_root(&r.env.lib.join(&id))).unwrap();
    assert_eq!(before, r.sid());
    r.offer("1.1", &[("manifest.json", &m("1.1")), ("bg.js", b"2;")], ALLOWED);
    check(&r.env).await.unwrap();

    let done = update(&r.env, &id, false).await.unwrap();
    assert_eq!(done, Done::Applied { from: "1.0".into(), to: "1.1".into() });
    assert_eq!(r.version(&id), "1.1");
    assert_eq!(fs::read(r.env.lib.join(&id).join("bg.js")).unwrap(), b"2;");
    assert_eq!(chrome_id(&manifest_root(&r.env.lib.join(&id))).unwrap(), before, "the key went back in");
    assert_eq!(source::read(&r.env.lib, &id).unwrap().added_at.as_deref(), Some("@1700000000"));
    assert!(r.leftovers(&id).is_empty(), "{:?}", r.leftovers(&id));

    // Asked again before the download, then the package with the launcher's UA.
    assert_eq!(r.asked("/service/update2/crx").len(), 2);
    let blobs = r.asked("/crx/");
    assert_eq!(blobs.len(), 1);
    assert_eq!(blobs[0].1, update2::user_agent());

    let u = r.view(&id);
    assert_eq!((u.state, u.installed.as_str(), u.latest.as_deref()), (State::Current, "1.1", None));
    let phases: Vec<String> = r.told("extension-update:progress").iter().map(|p| p["phase"].as_str().unwrap().to_string()).collect();
    for phase in ["download", "verify", "unpack", "apply"] {
        assert!(phases.iter().any(|p| p == phase), "{phase} in {phases:?}");
    }
    assert!(r.told("store-changed").contains(&json!("extensions")));
}

#[tokio::test]
async fn a_package_unlike_what_the_store_said_is_refused() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    let pkg = crx3(&r.dev, Some(&r.st), &zip(&[("manifest.json", &m("1.1"))]));

    r.offer_pkg("1.1", &pkg, &"0".repeat(64), pkg.len(), ALLOWED);
    let e = update(&r.env, &id, false).await.unwrap_err();
    assert!(format!("{e:#}").contains("hash"), "{e:#}");
    assert_eq!(r.version(&id), "1.0");
    assert!(r.leftovers(&id).is_empty(), "{:?}", r.leftovers(&id));
    let u = r.view(&id);
    assert_eq!(u.state, State::Failed);
    assert!(u.error.unwrap().contains("hash"));

    r.offer_pkg("1.1", &pkg, &sha(&pkg), pkg.len() - 1, ALLOWED);
    let e = update(&r.env, &id, false).await.unwrap_err();
    assert!(format!("{e:#}").contains("bytes"), "{e:#}");
    assert_eq!(r.version(&id), "1.0");
    assert!(r.leftovers(&id).is_empty());
}

/// A check that gets no answer keeps what the last one found.
#[tokio::test]
async fn a_silent_store_times_out_and_an_offline_one_changes_nothing() {
    let mut r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    check(&r.env).await.unwrap();
    let known = r.item(&id);
    assert_eq!(known.status, Status::Available);

    let checked = load(&r.env.book).last_check_at;
    r.shop.silent.store(true, Ordering::SeqCst);
    r.env.check_timeout = Duration::from_millis(300);
    let t = Instant::now();
    let e = check(&r.env).await.unwrap_err();
    assert!(t.elapsed() < Duration::from_secs(3), "{:?}", t.elapsed());
    assert!(e.contains("in time"), "{e}");
    assert_eq!(r.view(&id).state, State::Available);
    assert_eq!(r.item(&id).latest, known.latest);

    // Nobody listens there.
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    r.env.base = format!("http://127.0.0.1:{port}/service/update2/crx");
    let e = check(&r.env).await.unwrap_err();
    assert!(e.contains("could not reach"), "{e}");
    let u = r.view(&id);
    assert_eq!((u.state, u.latest.as_deref()), (State::Available, Some("1.1")));
    assert_eq!(load(&r.env.book).last_error.as_deref(), Some(e.as_str()));
    assert_eq!(load(&r.env.book).last_check_at, checked, "unanswered: not a check, so the next comes soon");
}

/// The store withdrew the version between the check and Update.
#[tokio::test]
async fn a_version_no_longer_offered_is_not_installed() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    check(&r.env).await.unwrap();

    r.says_nothing_new();
    assert_eq!(update(&r.env, &id, false).await.unwrap(), Done::NotServed);
    assert!(r.asked("/crx/").is_empty());
    assert_eq!(r.view(&id).state, State::Available, "the badge holds until the next check");
    assert_eq!(r.version(&id), "1.0");

    // A stage of it waiting for a profile goes at the next check.
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    r.world.running.lock().unwrap().insert(id.clone(), vec!["p1".into()]);
    assert!(matches!(update(&r.env, &id, false).await.unwrap(), Done::Waiting { .. }));
    r.says_nothing_new();
    check(&r.env).await.unwrap();
    assert!(swap::staged(&r.env.lib, &id).is_none());
    assert_eq!(r.view(&id).state, State::Current);
}

/// Design п.9 seen from the check: a running profile makes it wait, and it
/// goes in once that profile is gone.
#[tokio::test]
async fn a_running_profile_makes_the_update_wait() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    r.world.running.lock().unwrap().insert(id.clone(), vec!["p1".into()]);

    let done = update(&r.env, &id, false).await.unwrap();
    assert_eq!(done, Done::Waiting { waiting_on: vec![Holder { id: "p1".into(), name: "Profile p1".into() }] });
    let u = r.view(&id);
    assert_eq!((u.state, u.latest.as_deref()), (State::Waiting, Some("1.1")));
    assert_eq!(u.waiting_on, [Holder { id: "p1".into(), name: "Profile p1".into() }]);
    assert!(u.ready_since.is_some());

    // The launcher busy: waiting, on nobody in particular.
    r.world.running.lock().unwrap().clear();
    r.world.paused.store(true, Ordering::SeqCst);
    assert_eq!((r.view(&id).state, r.view(&id).waiting_on.len()), (State::Waiting, 0));
    r.world.paused.store(false, Ordering::SeqCst);
    assert_eq!(r.view(&id).state, State::Ready);

    retry_waiting(&r.env, "test");
    assert_eq!(r.version(&id), "1.1");
    assert_eq!(r.view(&id).state, State::Current);
}

/// New access is shown before it is granted; a yes lets the staged package in
/// without a second download, and never one downloaded by the same call.
#[tokio::test]
async fn grown_access_waits_for_a_yes() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m_with("1.1", json!({ "permissions": ["tabs"] })))], ALLOWED);

    let Done::Confirm { update: u } = update(&r.env, &id, true).await.unwrap() else { panic!("asked first") };
    assert_eq!(u.state, State::Confirm);
    let c = u.confirm.unwrap();
    assert_eq!(c.reason, Reason::Permissions);
    assert_eq!(c.grown, [Grant { kind: manifest_edit::GrantKind::Permission, value: "tabs".into() }]);
    assert_eq!(r.version(&id), "1.0");
    assert!(swap::waiting(&r.env.lib).is_empty(), "never in by itself");

    let done = update(&r.env, &id, true).await.unwrap();
    assert_eq!(done, Done::Applied { from: "1.0".into(), to: "1.1".into() });
    assert_eq!(r.asked("/crx/").len(), 1, "the staged package was taken");
}

#[tokio::test]
async fn an_older_engine_keeps_the_update_aside() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m_with("1.1", json!({ "minimum_chrome_version": "200" })))], ALLOWED);
    assert_eq!(update(&r.env, &id, false).await.unwrap(), Done::NeedsEngine { version: "200".into() });
    let u = r.view(&id);
    assert_eq!((u.state, u.needs_engine.as_deref()), (State::NeedsEngine, Some("200")));
    assert_eq!(update(&r.env, &id, true).await.unwrap(), Done::NeedsEngine { version: "200".into() });
    assert_eq!(r.asked("/crx/").len(), 1, "not downloaded again");
    assert_eq!(r.version(&id), "1.0");
}

/// A flag is news once and stops Update; it shows whatever the state.
#[tokio::test]
async fn a_flagged_extension_is_not_updated() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], r#"_esbAllowlist="false" _malware="true""#);
    let news = check(&r.env).await.unwrap();
    assert_eq!(news.flagged, [Flagged { id: id.clone(), name: "Wallet".into(), flags: vec![Flag::Malware] }]);
    assert!(check(&r.env).await.unwrap().flagged.is_empty(), "told once");
    let u = r.view(&id);
    assert_eq!((u.state, u.flags.as_slice(), u.allowlisted), (State::Available, &[Flag::Malware][..], Some(false)));
    assert_eq!(format!("{:#}", update(&r.env, &id, false).await.unwrap_err()), FLAGGED);
    assert!(r.asked("/crx/").is_empty());
}

#[tokio::test]
async fn a_skipped_version_hides_until_the_next() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    check(&r.env).await.unwrap();
    skip(&r.env, &id, "1.1").unwrap();
    let u = r.view(&id);
    assert_eq!((u.state, u.skipped.as_deref()), (State::Current, Some("1.1")));
    assert!(check(&r.env).await.unwrap().fresh.is_empty());

    r.offer("1.2", &[("manifest.json", &m("1.2"))], ALLOWED);
    assert_eq!(check(&r.env).await.unwrap().fresh.len(), 1);
    assert_eq!(r.view(&id).state, State::Available);
}

/// A failed try is skipped with its version; a newer one is offered again.
#[tokio::test]
async fn skipping_a_failed_version_clears_the_failure() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    let pkg = crx3(&r.dev, Some(&r.st), &zip(&[("manifest.json", &m("1.1"))]));
    r.offer_pkg("1.1", &pkg, &"0".repeat(64), pkg.len(), ALLOWED);
    update(&r.env, &id, false).await.unwrap_err();
    assert_eq!(r.view(&id).state, State::Failed);

    // Another version leaves the failure as it is.
    skip(&r.env, &id, "1.0.5").unwrap();
    assert_eq!(r.view(&id).state, State::Failed);
    skip(&r.env, &id, "1.1").unwrap();
    let u = r.view(&id);
    assert_eq!((u.state, u.error.as_deref(), u.skipped.as_deref()), (State::Current, None, Some("1.1")));

    r.offer("1.2", &[("manifest.json", &m("1.2"))], ALLOWED);
    check(&r.env).await.unwrap();
    assert_eq!(r.view(&id).state, State::Available);
}

#[tokio::test]
async fn cancel_drops_what_is_staged() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    r.world.running.lock().unwrap().insert(id.clone(), vec!["p1".into()]);
    update(&r.env, &id, false).await.unwrap();
    assert_eq!(r.view(&id).state, State::Waiting);
    cancel(&r.env, &id).unwrap();
    assert!(r.leftovers(&id).is_empty(), "{:?}", r.leftovers(&id));
    let u = r.view(&id);
    assert_eq!((u.state, u.ready_since), (State::Available, None));
}

/// Two checks at once ask once; the second takes the first one's answer.
#[tokio::test]
async fn a_check_under_way_is_waited_for_not_repeated() {
    let r = Rig::new().await;
    r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    let (a, b) = tokio::join!(check(&r.env), check(&r.env));
    assert_eq!(a, b);
    assert_eq!(r.asked("/service/update2/crx").len(), 1);
}

#[tokio::test]
async fn link_refuses_an_unknown_id_and_another_key() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], None);
    r.says(&[format!(r#"<app appid="{}" status="error-unknownApplication"/>"#, r.sid())]);
    assert_eq!(format!("{:#}", link(&r.env, &id, &r.sid(), false).await.unwrap_err()), NOT_IN_STORE);
    assert_eq!(format!("{:#}", link(&r.env, &id, "https://chromewebstore.google.com.evil.com/detail/x/abc", false).await.unwrap_err()), NOT_A_LINK);

    let other = Key::new();
    let keyed = r.add(&[("manifest.json", &m_with("1.0", json!({ "key": b64(&other.spki) })))], None);
    let e = format!("{:#}", link(&r.env, &keyed, &format!("https://chromewebstore.google.com/detail/wallet/{}", r.sid()), false).await.unwrap_err());
    assert!(e.contains("different extension") && e.contains(&other.id()), "{e}");
    // Its own key's id links it, without asking the store.
    let before = r.asked("").len();
    assert!(matches!(link(&r.env, &keyed, &other.id(), false).await.unwrap(), Linked::Linked { .. }));
    assert_eq!(r.asked("").len(), before);
    assert_eq!(source::read(&r.env.lib, &keyed).unwrap().how, Some(How::ManifestKey));
}

/// Linking by hand weighs the store's files against the installed ones.
#[tokio::test]
async fn link_goes_by_the_files() {
    let r = Rig::new().await;
    let mine: &[(&str, &[u8])] = &[("manifest.json", &m("1.0")), ("a.js", b"a1"), ("b.js", b"b1"), ("c.js", b"c1"), ("d.js", b"d1")];

    // Nothing in common: another extension.
    let id = r.add(mine, None);
    r.offer("1.1", &[("manifest.json", &m_with("1.1", json!({ "name": "Other" }))), ("x.js", b"x")], ALLOWED);
    let e = format!("{:#}", link(&r.env, &id, &r.sid(), false).await.unwrap_err());
    assert!(e.starts_with(DIFFERENT), "{e}");
    assert!(source::read(&r.env.lib, &id).unwrap().source.is_none());
    assert!(r.leftovers(&id).is_empty(), "{:?}", r.leftovers(&id));

    // A quarter in common under another name: the person decides.
    r.offer("1.1", &[("manifest.json", &m_with("1.1", json!({ "name": "Other" }))), ("a.js", b"a1"), ("b.js", b"b2")], ALLOWED);
    let Linked::Confirm { names, installed, store, overlap, kin, allowlisted, flags } = link(&r.env, &id, &r.sid(), false).await.unwrap() else {
        panic!("asked first")
    };
    assert_eq!((names.old.as_str(), names.new.as_str(), installed.as_str(), store.as_str()), ("Wallet", "Other", "1.0", "1.1"));
    assert_eq!((overlap, kin, allowlisted, flags), (0.25, Kinship::Unsure, Some(true), vec![]));
    assert!(source::read(&r.env.lib, &id).unwrap().source.is_none());
    assert!(r.leftovers(&id).is_empty());

    // Yes: linked, and the newer version in hand is kept for Update.
    let Linked::Linked { source: src, update: Some(u), .. } = link(&r.env, &id, &r.sid(), true).await.unwrap() else { panic!("linked") };
    assert_eq!(src, SourceRef::webstore(&r.sid()));
    assert_eq!(source::read(&r.env.lib, &id).unwrap().how, Some(How::User));
    assert_eq!((u.state, u.latest.as_deref()), (State::Ready, Some("1.1")));
    assert_eq!(r.version(&id), "1.0", "linking is not updating");
    let downloads = r.asked("/crx/").len();
    assert_eq!(update(&r.env, &id, false).await.unwrap(), Done::Applied { from: "1.0".into(), to: "1.1".into() });
    assert_eq!(r.asked("/crx/").len(), downloads, "no second download");
}

/// Names and shared files are easy to copy: what the files say is always shown first.
#[tokio::test]
async fn link_by_the_files_always_asks_first() {
    let r = Rig::new().await;
    let files: &[(&str, &[u8])] = &[("manifest.json", &m("1.0")), ("a.js", b"a"), ("b.js", b"b")];
    let id = r.add(files, None);
    r.offer("1.0", files, ALLOWED);
    let Linked::Confirm { kin, overlap, allowlisted, .. } = link(&r.env, &id, &r.sid(), false).await.unwrap() else { panic!("asked first") };
    assert_eq!((kin, overlap, allowlisted), (Kinship::Same, 1.0, Some(true)));
    assert!(source::read(&r.env.lib, &id).unwrap().source.is_none() && r.leftovers(&id).is_empty());
    let Linked::Linked { update: Some(u), .. } = link(&r.env, &id, &r.sid(), true).await.unwrap() else { panic!("linked") };
    assert_eq!(u.state, State::Current);
    assert!(r.leftovers(&id).is_empty(), "nothing staged for the same version");
    assert!(r.told("store-changed").contains(&json!("extensions")), "the entry now has a source");

    // What the store says of the item is in the question.
    let id = r.add(files, None);
    r.offer("1.0", files, r#"_esbAllowlist="false" _malware="true""#);
    let Linked::Confirm { allowlisted, flags, .. } = link(&r.env, &id, &r.sid(), false).await.unwrap() else { panic!("asked first") };
    assert_eq!((allowlisted, flags), (Some(false), vec![Flag::Malware]));
}

#[test]
fn a_deleted_extensions_line_goes() {
    let t = Tmp::new("ext-updates-book");
    let book = t.0.join(BOOK);
    let mut b = Book::default();
    b.items.insert(key("a"), Item { latest: Some("1.1".into()), ..Item::default() });
    b.items.insert(key("b"), Item::default());
    save(&book, &b).unwrap();
    forget(&book, "a");
    assert_eq!(load(&book).items.keys().collect::<Vec<_>>(), ["lib:b"]);

    // Through the library's own delete.
    let root = crate::store::test_root("ext-updates-delete");
    let lib = crate::store::extensions_dir().unwrap();
    write_tree(&lib.join("gone"), &[("manifest.json", &m("1.0"))]);
    let book = root.path.join(BOOK);
    save(&book, &b).unwrap();
    super::super::delete("b").unwrap();
    assert!(!load(&book).items.contains_key("lib:b"));
}

/// Cancel stops a download under way; nothing of it stays.
#[tokio::test]
async fn cancel_stops_a_download() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    r.shop.hang.store(true, Ordering::SeqCst);
    let stop = async {
        while running(&r.env.lib, &id).flatten().is_none_or(|p| p.phase != Step::Download) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(r.view(&id).state, State::Downloading);
        assert_eq!(format!("{:#}", update(&r.env, &id, false).await.unwrap_err()), BUSY, "one at a time");
        cancel(&r.env, &id).unwrap();
    };
    let (done, ()) = tokio::join!(update(&r.env, &id, false), stop);
    assert_eq!(format!("{:#}", done.unwrap_err()), CANCELLED);
    assert!(r.leftovers(&id).is_empty(), "{:?}", r.leftovers(&id));
    let u = r.view(&id);
    assert_eq!((u.state, u.error), (State::Available, None), "a cancel is not a failure");
    assert_eq!(r.version(&id), "1.0");
}

/// A flag that comes after the yes: the waiting version goes and never goes
/// in; a store that then forgets the item keeps the flag shown.
#[tokio::test]
async fn a_flag_after_the_yes_keeps_the_waiting_version_out() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    r.world.running.lock().unwrap().insert(id.clone(), vec!["p1".into()]);
    assert!(matches!(update(&r.env, &id, false).await.unwrap(), Done::Waiting { .. }));

    r.offer("1.1", &[("manifest.json", &m("1.1"))], r#"_esbAllowlist="true" _malware="true""#);
    check(&r.env).await.unwrap();
    assert!(swap::staged(&r.env.lib, &id).is_none(), "dropped");
    r.world.running.lock().unwrap().clear();
    retry_waiting(&r.env, "test");
    assert_eq!(r.version(&id), "1.0");

    // Taken down: the flag stays.
    r.says(&[format!(r#"<app appid="{}" status="error-unknownApplication"/>"#, r.sid())]);
    check(&r.env).await.unwrap();
    assert_eq!((r.item(&id).flags, r.view(&id).flags), (vec![Flag::Malware], vec![Flag::Malware]));
}

/// A flag the record knows keeps a waiting version out, whoever let it in.
#[tokio::test]
async fn a_waiting_version_of_a_flagged_item_is_not_put_in() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    r.offer("1.1", &[("manifest.json", &m("1.1"))], ALLOWED);
    r.world.running.lock().unwrap().insert(id.clone(), vec!["p1".into()]);
    assert!(matches!(update(&r.env, &id, false).await.unwrap(), Done::Waiting { .. }));
    let mut b = load(&r.env.book);
    b.items.get_mut(&key(&id)).unwrap().flags = vec![Flag::PolicyViolation];
    save(&r.env.book, &b).unwrap();
    r.world.running.lock().unwrap().clear();
    retry_waiting(&r.env, "test");
    assert_eq!(r.version(&id), "1.0");
    assert!(swap::waiting(&r.env.lib).is_empty());
}

/// The package must be the version update2 named, as Chrome's installer checks.
#[tokio::test]
async fn a_package_of_another_version_than_named_is_refused() {
    let r = Rig::new().await;
    let id = r.add(&[("manifest.json", &m("1.0"))], Some(How::Link));
    let pkg = crx3(&r.dev, Some(&r.st), &zip(&[("manifest.json", &m("1.1"))]));
    r.offer_pkg("1.2", &pkg, &sha(&pkg), pkg.len(), ALLOWED);
    let e = format!("{:#}", update(&r.env, &id, false).await.unwrap_err());
    assert!(e.contains("named version 1.2 but sent 1.1"), "{e}");
    assert_eq!(r.version(&id), "1.0");
    assert!(r.leftovers(&id).is_empty(), "{:?}", r.leftovers(&id));
    assert_eq!(r.view(&id).state, State::Failed);
}
