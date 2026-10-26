//! Who holds an extension: a swap waits for every holder, a launch waits a
//! swap out, and neither misses the other.

use super::*;
use crate::space::local::extensions::swap::{quiet, Order};
use crate::space::local::extensions::testkit::{manifest, write_tree, zip, Tmp};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};

/// Running browsers as a test says they are.
#[derive(Default)]
struct Fake {
    running: Mutex<HashMap<String, Vec<String>>>,
    untracked: Mutex<Vec<String>>,
    paused: AtomicBool,
}

impl World for Fake {
    fn running_with(&self, lib_id: &str) -> Vec<String> {
        self.running.lock().unwrap().get(lib_id).cloned().unwrap_or_default()
    }
    fn untracked(&self) -> Vec<String> {
        self.untracked.lock().unwrap().clone()
    }
    fn paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

/// The launcher's own tracker, and nothing else of the launcher.
struct Tracked;

impl World for Tracked {
    fn running_with(&self, lib_id: &str) -> Vec<String> {
        crate::process::Tracker::shared().users_of(lib_id)
    }
    fn untracked(&self) -> Vec<String> {
        Vec::new()
    }
    fn paused(&self) -> bool {
        false
    }
}

fn fake() -> Arc<dyn World> {
    Arc::new(Fake::default())
}

/// Ids nobody else's test uses: the registry is the process's own.
fn uid(tag: &str) -> String {
    format!("{tag}-{}", uuid::Uuid::new_v4().simple())
}

struct Lib {
    tmp: Tmp,
    lib: PathBuf,
}

fn lib() -> Lib {
    let tmp = Tmp::new("ext-usage");
    let lib = tmp.0.join("extensions");
    std::fs::create_dir_all(&lib).unwrap();
    Lib { tmp, lib }
}

/// A 1.0 extension `id` with 1.1 staged and approved.
fn ready(l: &Lib, id: &str) {
    write_tree(&l.lib.join(id), &[("manifest.json", manifest("1.0", json!({})).as_bytes()), ("a.js", b"1")]);
    let pkg = l.tmp.0.join(format!("{id}.zip"));
    std::fs::write(&pkg, zip(&[("manifest.json", manifest("1.1", json!({})).as_bytes()), ("a.js", b"2")])).unwrap();
    assert!(swap::stage_file(&l.lib, id, &pkg, &Order::sync(1, None), &Ops::quick(), &quiet()).unwrap().ready());
}

fn version(l: &Lib, id: &str) -> String {
    let m: serde_json::Value = serde_json::from_slice(&std::fs::read(l.lib.join(id).join("manifest.json")).unwrap()).unwrap();
    m["version"].as_str().unwrap().to_string()
}

const WAIT: Duration = Duration::from_secs(10);

type PairOp = Box<dyn Fn(&Path, &Path) -> std::io::Result<()> + Send + Sync>;

/// Design п.9: a browser started with it holds it; once it closes, the update goes in.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn a_running_profile_defers_the_swap_and_its_close_lets_it_in() {
    // Whatever the closing browser's bookkeeping writes lands in the test's own root.
    let _root = crate::store::test_root("ext-usage-run");
    let l = lib();
    let id = uid("held");
    ready(&l, &id);
    let profile = uid("p");
    let udd = l.tmp.0.join("udd");
    std::fs::create_dir_all(&udd).unwrap();
    let child = tokio::process::Command::new("sleep").arg("30").spawn().unwrap();
    let tracker = crate::process::Tracker::shared();
    tracker.track(profile.clone(), child, udd, crate::process::ExitHook::Local, vec![id.clone()]);

    let out = try_apply(&Tracked, &l.lib, &id, &Ops::quick()).unwrap();
    assert_eq!(out, Outcome::Deferred { profiles: vec![profile.clone()] });
    assert_eq!(version(&l, &id), "1.0");

    assert!(tracker.kill(&profile).await.unwrap());
    tokio::time::timeout(Duration::from_secs(20), async {
        while tracker.is_running(&profile) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the entry goes once the browser is gone");
    let done = retry(&Tracked, &l.lib, &Ops::quick());
    assert!(matches!(done.as_slice(), [(i, Ok(Outcome::Applied(_)))] if *i == id), "{done:?}");
    assert_eq!(version(&l, &id), "1.1");
}

#[test]
fn a_profile_without_it_does_not_hold_it() {
    let l = lib();
    let id = uid("free");
    ready(&l, &id);
    let world = Fake::default();
    world.running.lock().unwrap().insert(uid("other"), vec!["p1".into()]);
    assert!(matches!(try_apply(&world, &l.lib, &id, &Ops::quick()).unwrap(), Outcome::Applied(_)));
    assert_eq!(version(&l, &id), "1.1");
}

/// A browser the launcher does not track may run any extension.
#[test]
fn a_browser_nobody_tracks_holds_every_extension() {
    let l = lib();
    let id = uid("any");
    ready(&l, &id);
    let world = Fake::default();
    world.untracked.lock().unwrap().push("p9".into());
    assert_eq!(try_apply(&world, &l.lib, &id, &Ops::quick()).unwrap(), Outcome::Deferred { profiles: vec!["p9".into()] });
    // Its own launch on the way says what it holds: here, nothing.
    let _starting = enter("p9", &[]).unwrap();
    assert!(matches!(try_apply(&world, &l.lib, &id, &Ops::quick()).unwrap(), Outcome::Applied(_)));
}

/// The launcher finds such a browser by the profile's lock.
#[cfg(unix)]
#[test]
fn the_launcher_finds_untracked_browsers_by_their_lock() {
    let _root = crate::store::test_root("ext-usage-lock");
    let udd = crate::store::user_data_root().unwrap();
    let held = uid("locked");
    std::fs::create_dir_all(udd.join(&held)).unwrap();
    std::fs::create_dir_all(udd.join(uid("idle"))).unwrap();
    let host = crate::reset::this_host().expect("this machine's name");
    std::os::unix::fs::symlink(format!("{host}-{}", std::process::id()), udd.join(&held).join("SingletonLock")).unwrap();
    assert_eq!(System.untracked(), [held]);
}

#[test]
fn nothing_is_swapped_while_the_launcher_is_busy() {
    let l = lib();
    let id = uid("paused");
    ready(&l, &id);
    let world = Fake::default();
    world.paused.store(true, Ordering::SeqCst);
    assert_eq!(try_apply(&world, &l.lib, &id, &Ops::quick()).unwrap(), Outcome::Deferred { profiles: vec![] });
    assert_eq!(try_apply(&Fake::default(), &lib().lib, &id, &Ops::quick()).unwrap(), Outcome::Nothing, "nothing staged there");
}

/// Design п.9: a launch during the swap waits for it and starts with the new version whole.
#[tokio::test(flavor = "multi_thread")]
async fn a_launch_during_a_swap_waits_for_it() {
    let l = lib();
    let id = uid("wait");
    ready(&l, &id);
    let real = Ops::real();
    let slow = Ops {
        exchange: Box::new(move |a, b| {
            std::thread::sleep(Duration::from_millis(300));
            (real.exchange)(a, b)
        }),
        ..Ops::quick()
    };
    let (lib2, id2) = (l.lib.clone(), id.clone());
    let swapper = std::thread::spawn(move || try_apply(&Fake::default(), &lib2, &id2, &slow));
    while !seen(&id).1 {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let t = Instant::now();
    let hold = begin_launch_in(fake(), Arc::new(Ops::quick()), l.lib.clone(), "pw", std::slice::from_ref(&id), WAIT).await.unwrap();
    assert!(t.elapsed() >= Duration::from_millis(100), "it waited");
    assert_eq!(version(&l, &id), "1.1");
    assert!(matches!(swapper.join().unwrap(), Ok(Outcome::Applied(_))));
    assert_eq!(seen(&id).0, ["pw"]);
    drop(hold);
    assert!(seen(&id).0.is_empty());
}

/// Design п.9: launch and swap at once, many times: the swap never runs while
/// a launch with that extension is registered, and a swap that defers names it.
#[tokio::test(flavor = "multi_thread")]
async fn a_launch_and_a_swap_never_overlap() {
    for i in 0..40 {
        let l = lib();
        let id = uid("race");
        ready(&l, &id);
        let profile = format!("race-p{i}");
        let overlapped = Arc::new(AtomicBool::new(false));
        let watch = |inner: PairOp| {
            let (o, idc) = (overlapped.clone(), id.clone());
            Box::new(move |a: &Path, b: &Path| {
                if !seen(&idc).0.is_empty() {
                    o.store(true, Ordering::SeqCst);
                }
                std::thread::sleep(Duration::from_millis(2));
                inner(a, b)
            }) as PairOp
        };
        let real = Ops::real();
        let ops = Ops { exchange: watch(real.exchange), rename: watch(real.rename), ..Ops::quick() };
        let (lib2, id2) = (l.lib.clone(), id.clone());
        let swapper = std::thread::spawn(move || try_apply(&Fake::default(), &lib2, &id2, &ops));
        let hold = begin_launch_in(fake(), Arc::new(Ops::quick()), l.lib.clone(), &profile, std::slice::from_ref(&id), WAIT).await.unwrap();
        let out = swapper.join().unwrap().unwrap();
        assert!(!overlapped.load(Ordering::SeqCst), "round {i}: swapped under a registered launch");
        match out {
            Outcome::Deferred { profiles } if profiles == [profile.clone()] => {
                assert_eq!(version(&l, &id), "1.0");
                assert!(swap::staged(&l.lib, &id).is_some_and(|n| n.ready()), "kept for later");
            }
            // It went in, by this swap or by the launch itself first.
            Outcome::Applied(_) | Outcome::Nothing | Outcome::Deferred { .. } => assert_eq!(version(&l, &id), "1.1"),
        }
        drop(hold);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_launch_gives_up_only_after_its_wait() {
    let l = lib();
    let id = uid("long");
    let _alone = exclusive(&id, Duration::ZERO).unwrap();
    let t = Instant::now();
    let wait = Duration::from_millis(150);
    let err = begin_launch_in(fake(), Arc::new(Ops::quick()), l.lib.clone(), "pt", std::slice::from_ref(&id), wait).await.err().unwrap();
    assert!(err.to_string().contains(EXT_UPDATING), "{err:#}");
    assert!(t.elapsed() >= wait);
    // A profile without that extension is not held up.
    begin_launch_in(fake(), Arc::new(Ops::quick()), l.lib.clone(), "pu", &[uid("other")], wait).await.unwrap();
}

/// Design §3.3.5: before a launch, an approved update nobody holds goes in.
#[tokio::test(flavor = "multi_thread")]
async fn an_approved_update_goes_in_before_the_launch() {
    let l = lib();
    let id = uid("pre");
    ready(&l, &id);
    let _pa = begin_launch_in(fake(), Arc::new(Ops::quick()), l.lib.clone(), "pa", std::slice::from_ref(&id), WAIT).await.unwrap();
    assert_eq!(version(&l, &id), "1.1");

    // Held by a running profile: this one starts with the version there.
    let id2 = uid("pre");
    ready(&l, &id2);
    let busy = Fake::default();
    busy.running.lock().unwrap().insert(id2.clone(), vec!["other".into()]);
    let _pb = begin_launch_in(Arc::new(busy), Arc::new(Ops::quick()), l.lib.clone(), "pb", std::slice::from_ref(&id2), WAIT).await.unwrap();
    assert_eq!(version(&l, &id2), "1.0");
    // And while it holds it, a swap defers to it.
    let out = try_apply(&Fake::default(), &l.lib, &id2, &Ops::quick()).unwrap();
    assert_eq!(out, Outcome::Deferred { profiles: vec!["pb".into()] });
}

/// The whole launch with a stand-in engine: an approved update goes in first,
/// the browser is tracked with its library extensions, and the next update
/// waits for it to close.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
#[allow(clippy::await_holding_lock)] // the test's turn, held to its end
async fn a_launched_browser_holds_its_extensions_until_it_closes() {
    use std::os::unix::fs::PermissionsExt;
    let _serial = crate::migrate::serial();
    let root = crate::store::test_root("ext-usage-launch").with_config();
    let lib = crate::store::extensions_dir().unwrap();
    let l = Lib { tmp: Tmp::new("ext-usage-pkgs"), lib: lib.clone() };
    let id = uid("lx");
    ready(&l, &id);
    let profile = uid("pl");
    let body = json!({ "_meta": { "id": profile, "rev": 1, "extensions": [id] }, "name": "Held" });
    std::fs::write(crate::store::profiles_dir().unwrap().join(format!("{profile}.json")), body.to_string()).unwrap();
    let engine = root.path.join("engine.sh");
    std::fs::write(&engine, "#!/bin/sh\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o755)).unwrap();

    crate::launch::launch_with(engine, &profile, false).await.unwrap();
    assert_eq!(version(&l, &id), "1.1", "the approved update went in before the browser started");
    let tracker = crate::process::Tracker::shared();
    assert_eq!(tracker.users_of(&id), std::slice::from_ref(&profile));
    assert!(seen(&id).0.is_empty(), "the launch's own hold ends once the browser is tracked");

    // The next one waits for that browser.
    let pkg = l.tmp.0.join("next.zip");
    std::fs::write(&pkg, zip(&[("manifest.json", manifest("1.2", json!({})).as_bytes()), ("a.js", b"3")])).unwrap();
    assert!(swap::stage_file(&lib, &id, &pkg, &Order::sync(2, None), &Ops::quick(), &quiet()).unwrap().ready());
    assert_eq!(try_apply(&Tracked, &lib, &id, &Ops::quick()).unwrap(), Outcome::Deferred { profiles: vec![profile.clone()] });

    assert!(tracker.kill(&profile).await.unwrap());
    tokio::time::timeout(Duration::from_secs(20), async {
        while tracker.is_running(&profile) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the browser closes");
    assert!(matches!(retry(&Tracked, &lib, &Ops::quick()).as_slice(), [(_, Ok(Outcome::Applied(_)))]));
    assert_eq!(version(&l, &id), "1.2");
}

/// The start settles the library in the background: a launch waits for it,
/// and only for its own library.
#[tokio::test]
async fn a_launch_waits_for_the_start_to_settle_the_library() {
    let _root = crate::store::test_root("ext-settle");
    let lib = crate::store::extensions_dir().unwrap();
    let other = Tmp::new("ext-settle-other");
    let settling = settling(&lib);
    assert!(!settled(&lib) && settled(&other.0));
    assert!(!until_settled(&lib, Duration::from_millis(50)).await);

    let ids = vec![format!("s{}", uuid::Uuid::new_v4().simple())];
    let launch = begin_launch("p-settle", &ids);
    tokio::pin!(launch);
    assert!(tokio::time::timeout(Duration::from_millis(150), &mut launch).await.is_err(), "it waits");
    drop(settling);
    let hold = tokio::time::timeout(Duration::from_secs(5), launch).await.expect("then it goes").unwrap();
    assert_eq!(seen(&ids[0]).0, ["p-settle"]);
    drop(hold);
    assert!(settled(&lib));
}
