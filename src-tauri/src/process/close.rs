//! How Stop asks a browser to quit so its cookies are written out. An engine that offers the
//! bus quit: that, then CDP, then SIGINT or WM_CLOSE. An older one, unix: SIGINT, which also
//! ends one with no window (#121), then CDP. Windows: the bus close, then CDP, then WM_CLOSE.

use std::future::Future;
use std::path::Path;
use std::time::Duration;

/// One way of asking a browser to quit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Route {
    /// `{"quit":true}` over the launcher's bus, to an engine that offers it: the Quit with no
    /// "Leave site?" prompt, to a browser with or without a window, on every OS.
    Quit,
    /// `{"close":true}` over the launcher's bus: the engine's own Quit, which that prompt holds.
    Bus,
    /// CDP `Browser.close` on this browser socket; skips a "Leave site?" prompt.
    Cdp(String),
    /// SIGINT on unix; WM_CLOSE to its windows on Windows, which a windowless one never gets.
    Os,
}

/// Best first. With the bus quit offered: it, CDP (no "Leave site?" holds either), the OS's ask.
/// Otherwise unix: SIGINT, CDP; Windows or no pid: the bus close, CDP, its windows.
pub(super) fn routes(quit: bool, bus: bool, cdp: Option<String>, pid: bool, windows: bool) -> Vec<Route> {
    let cdp = cdp.map(Route::Cdp);
    let os = pid.then_some(Route::Os);
    if quit {
        // SIGINT last: a prompt holds it, and a second signal kills unsaved.
        return [Some(Route::Quit), cdp, os].into_iter().flatten().collect();
    }
    if pid && !windows {
        return [os, cdp].into_iter().flatten().collect();
    }
    [bus.then_some(Route::Bus), cdp, os].into_iter().flatten().collect()
}

/// The routes of one Stop, and the one that took the ask.
pub(super) struct Closing {
    routes: Vec<Route>,
    took: Option<usize>,
}

impl Closing {
    pub(super) fn new(routes: Vec<Route>) -> Closing {
        Closing { routes, took: None }
    }

    /// The first route that takes the ask; false when none did.
    pub(super) async fn ask<F, Fut>(&mut self, deliver: F) -> bool
    where
        F: FnMut(Route) -> Fut,
        Fut: Future<Output = bool>,
    {
        self.try_from(0, deliver).await
    }

    /// Still up past QUIT_WAIT: the routes after the one that took the ask, or all
    /// of them when none did.
    pub(super) async fn again<F, Fut>(&mut self, deliver: F) -> bool
    where
        F: FnMut(Route) -> Fut,
        Fut: Future<Output = bool>,
    {
        let from = self.took.map_or(0, |i| i + 1);
        self.try_from(from, deliver).await
    }

    async fn try_from<F, Fut>(&mut self, from: usize, mut deliver: F) -> bool
    where
        F: FnMut(Route) -> Fut,
        Fut: Future<Output = bool>,
    {
        for (i, r) in self.routes.iter().enumerate().skip(from) {
            if deliver(r.clone()).await {
                self.took = Some(i);
                return true;
            }
        }
        false
    }

    pub(super) fn took(&self) -> Option<&Route> {
        self.took.map(|i| &self.routes[i])
    }
}

/// Stop's steps for the browser at `pid`: asked; past QUIT_WAIT asked the ways not
/// tried yet (SIGTERM on unix when none is left); past END_WAIT more the caller kills it.
pub(super) struct Stop {
    pid: Option<u32>,
    profile: Option<String>,
    closing: Closing,
}

impl Stop {
    /// `profile` reaches its bus member, `cdp` its browser socket; with no `pid` only those two do.
    pub(super) fn new(pid: Option<u32>, profile: Option<&str>, cdp: Option<String>) -> Stop {
        let bus = profile.zip(crate::bus_now());
        let quit = bus.as_ref().is_some_and(|(p, b)| b.quits(p));
        let routes = routes(quit, bus.is_some(), cdp, pid.is_some(), cfg!(windows));
        Stop { pid, profile: profile.map(str::to_string), closing: Closing::new(routes) }
    }

    pub(super) fn pid(&self) -> Option<u32> {
        self.pid
    }

    pub(super) async fn ask(&mut self) -> bool {
        let (pid, profile) = (self.pid, self.profile.as_deref());
        let took = self.closing.ask(|r| deliver(r, pid, profile)).await;
        if let Some(r) = self.closing.took().filter(|r| cfg!(windows) || **r != Route::Os) {
            eprintln!("[tracker] pid {pid:?} asked to close by {}", name(r));
        }
        took
    }

    pub(super) async fn end(&mut self) {
        let (pid, profile) = (self.pid, self.profile.as_deref());
        if self.closing.again(|r| deliver(r, pid, profile)).await {
            if let Some(r) = self.closing.took() {
                eprintln!("[tracker] pid {pid:?} still up, asked again by {}", name(r));
            }
        } else if let Some(p) = pid.filter(|_| !cfg!(windows)) {
            super::end_session(p);
        }
    }
}

fn name(r: &Route) -> &'static str {
    match r {
        Route::Quit => "the bus quit",
        Route::Bus => "the bus",
        Route::Cdp(_) => "CDP Browser.close",
        Route::Os => if cfg!(windows) { "WM_CLOSE" } else { "SIGINT" },
    }
}

async fn deliver(route: Route, pid: Option<u32>, profile: Option<&str>) -> bool {
    match route {
        Route::Quit => profile.zip(crate::bus_now()).is_some_and(|(p, bus)| bus.quit(p)),
        Route::Bus => profile.zip(crate::bus_now()).is_some_and(|(p, bus)| bus.close(p)),
        Route::Cdp(ws) => by_cdp(&ws).await,
        Route::Os => pid.is_some_and(super::request_close),
    }
}

/// WM_CLOSE to the browser windows of `pid`, as their close button sends it. Hidden ones
/// too: taskkill without /F skips those, and a service session shows none.
#[cfg(windows)]
pub(super) fn close_windows(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindow, GetWindowThreadProcessId, PostMessageW, GW_OWNER, WM_CLOSE,
    };
    struct Find {
        pid: u32,
        posted: usize,
    }
    unsafe extern "system" fn each(h: HWND, l: LPARAM) -> BOOL {
        // SAFETY: `l` is the Find below, alive for the whole EnumWindows call.
        let f = unsafe { &mut *(l as *mut Find) };
        let mut owner = 0u32;
        // SAFETY: a window handle EnumWindows gave, and plain out-parameters.
        unsafe {
            GetWindowThreadProcessId(h, &mut owner);
            // A frame is unowned; a bubble or a menu has an owner and goes with its frame.
            if owner == f.pid && GetWindow(h, GW_OWNER).is_null() {
                let mut name = [0u16; 32];
                let n = GetClassNameW(h, name.as_mut_ptr(), name.len() as i32).max(0) as usize;
                if name[..n] == *"Chrome_WidgetWin_1".encode_utf16().collect::<Vec<u16>>() && PostMessageW(h, WM_CLOSE, 0, 0) != 0 {
                    f.posted += 1;
                }
            }
        }
        1
    }
    let mut f = Find { pid, posted: 0 };
    // SAFETY: the callback reads `f` only during this call.
    unsafe { EnumWindows(Some(each), &mut f as *mut Find as LPARAM) };
    f.posted > 0
}

/// The browser socket a browser started with a debugging port wrote into `udd`.
pub(super) fn cdp_in(udd: &Path) -> Option<String> {
    let text = std::fs::read_to_string(udd.join("DevToolsActivePort")).ok()?;
    let mut lines = text.lines();
    let port = lines.next()?.trim().parse::<u16>().ok()?;
    let path = lines.next()?.trim();
    path.starts_with("/devtools/browser/").then(|| format!("ws://127.0.0.1:{port}{path}"))
}

/// CDP `Browser.close`. Taken when it answers, or drops the socket as it quits; an error answer is a no.
async fn by_cdp(ws: &str) -> bool {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    const WAIT: Duration = Duration::from_secs(2);
    let Ok(Ok((mut socket, _))) = tokio::time::timeout(WAIT, tokio_tungstenite::connect_async(ws)).await else {
        return false;
    };
    let ask = r#"{"id":1,"method":"Browser.close"}"#;
    if socket.send(Message::Text(ask.into())).await.is_err() {
        return false;
    }
    let answer = async {
        while let Some(m) = socket.next().await {
            let Ok(m) = m else { return true };
            let Message::Text(t) = m else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) else { continue };
            if v["id"] == 1 {
                return v.get("error").is_none();
            }
        }
        true
    };
    tokio::time::timeout(WAIT, answer).await.unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const WS: &str = "ws://127.0.0.1:9/devtools/browser/x";

    #[test]
    fn windows_asks_the_bus_then_cdp_then_its_windows() {
        let cdp = || Some(WS.to_string());
        assert_eq!(routes(false, true, cdp(), true, true), [Route::Bus, Route::Cdp(WS.into()), Route::Os]);
        assert_eq!(routes(false, false, cdp(), true, true), [Route::Cdp(WS.into()), Route::Os]);
        assert_eq!(routes(false, true, None, true, true), [Route::Bus, Route::Os]);
        assert_eq!(routes(false, false, None, true, true), [Route::Os]);
    }

    #[test]
    fn unix_asks_with_sigint_and_then_cdp_alone() {
        // SIGINT reaches a browser with no window too, and a second signal would kill it unsaved;
        // the bus close asks what SIGINT asked. CDP closes past a "Leave site?" prompt.
        assert_eq!(routes(false, true, Some(WS.to_string()), true, false), [Route::Os, Route::Cdp(WS.into())]);
        assert_eq!(routes(false, true, None, true, false), [Route::Os]);
        assert_eq!(routes(false, false, None, true, false), [Route::Os]);
    }

    #[test]
    fn a_browser_with_no_pid_is_asked_by_its_profile_alone() {
        for windows in [true, false] {
            assert_eq!(routes(false, true, Some(WS.to_string()), false, windows), [Route::Bus, Route::Cdp(WS.into())]);
            assert_eq!(routes(true, true, Some(WS.to_string()), false, windows), [Route::Quit, Route::Cdp(WS.into())]);
            assert_eq!(routes(false, false, None, false, windows), Vec::<Route>::new());
        }
    }

    /// The bus quit first on every OS: no "Leave site?" holds it and it reaches a windowless
    /// browser. CDP next, which skips that prompt too; the OS's ask last.
    #[test]
    fn the_bus_quit_leads_where_the_engine_offers_it() {
        let cdp = || Some(WS.to_string());
        for windows in [true, false] {
            assert_eq!(routes(true, true, cdp(), true, windows), [Route::Quit, Route::Cdp(WS.into()), Route::Os]);
            assert_eq!(routes(true, true, None, true, windows), [Route::Quit, Route::Os]);
        }
    }

    #[tokio::test]
    async fn past_the_bus_quit_cdp_comes_before_the_signal() {
        // Unix: the quit took the ask, the browser is still up past QUIT_WAIT: CDP, no signal.
        let all = routes(true, true, Some(WS.into()), true, false);
        let (tried, deliver) = fake(&all);
        let mut c = Closing::new(all.clone());
        assert!(c.ask(deliver.clone()).await);
        assert_eq!(c.took(), Some(&Route::Quit));
        assert!(c.again(deliver).await);
        assert_eq!(c.took(), Some(&Route::Cdp(WS.into())));
        assert_eq!(*tried.lock().unwrap(), [Route::Quit, Route::Cdp(WS.into())]);

        // CDP is not answering: SIGINT in the same step, the only signal before the kill.
        let (tried, deliver) = fake(&[Route::Quit, Route::Os]);
        let mut c = Closing::new(all.clone());
        assert!(c.ask(deliver.clone()).await);
        assert!(c.again(deliver.clone()).await);
        assert!(!c.again(deliver).await);
        assert_eq!(*tried.lock().unwrap(), [Route::Quit, Route::Cdp(WS.into()), Route::Os]);

        // The engine left the bus between Stop's look and its ask: CDP at once, not 5 s later.
        let (tried, deliver) = fake(&[Route::Os, Route::Cdp(WS.into())]);
        let mut c = Closing::new(all);
        assert!(c.ask(deliver).await);
        assert_eq!(*tried.lock().unwrap(), [Route::Quit, Route::Cdp(WS.into())]);

        // No CDP (a launch from the UI): SIGINT past the quit, as before it.
        let all = routes(true, true, None, true, false);
        let (tried, deliver) = fake(&all);
        let mut c = Closing::new(all);
        assert!(c.ask(deliver.clone()).await);
        assert!(c.again(deliver).await);
        assert_eq!(*tried.lock().unwrap(), [Route::Quit, Route::Os]);

        // Windows: the same, CDP and then its windows.
        let all = routes(true, true, Some(WS.into()), true, true);
        let (tried, deliver) = fake(&all);
        let mut c = Closing::new(all);
        assert!(c.ask(deliver.clone()).await);
        assert!(c.again(deliver.clone()).await);
        assert!(c.again(deliver).await);
        assert_eq!(*tried.lock().unwrap(), [Route::Quit, Route::Cdp(WS.into()), Route::Os]);
    }

    /// A fake delivery: records each route tried, takes only those in `takes`.
    fn fake(takes: &[Route]) -> (Arc<Mutex<Vec<Route>>>, impl FnMut(Route) -> std::future::Ready<bool> + Clone) {
        let tried = Arc::new(Mutex::new(Vec::new()));
        let (log, takes) = (tried.clone(), takes.to_vec());
        (tried, move |r: Route| {
            log.lock().unwrap().push(r.clone());
            std::future::ready(takes.contains(&r))
        })
    }

    #[tokio::test]
    async fn the_ask_falls_through_to_the_next_route_and_the_later_step_tries_the_rest() {
        let all = routes(false, true, Some(WS.into()), true, true);
        // The bus is up but nobody is on it: CDP takes the ask, WM_CLOSE is kept for later.
        let (tried, deliver) = fake(&[Route::Cdp(WS.into()), Route::Os]);
        let mut c = Closing::new(all.clone());
        assert!(c.ask(deliver.clone()).await);
        assert_eq!(c.took(), Some(&Route::Cdp(WS.into())));
        assert_eq!(*tried.lock().unwrap(), [Route::Bus, Route::Cdp(WS.into())]);
        assert!(c.again(deliver.clone()).await);
        assert_eq!(c.took(), Some(&Route::Os));
        // Nothing left after its windows: the caller forces it.
        assert!(!c.again(deliver).await);
        assert_eq!(tried.lock().unwrap().len(), 3);

        // The bus took it, and a "Leave site?" prompt held the Quit: CDP is next, it skips the prompt.
        let (tried, deliver) = fake(&all);
        let mut c = Closing::new(all.clone());
        assert!(c.ask(deliver.clone()).await);
        assert!(c.again(deliver).await);
        assert_eq!(*tried.lock().unwrap(), [Route::Bus, Route::Cdp(WS.into())]);
    }

    #[tokio::test]
    async fn a_browser_no_route_reached_is_asked_every_way_again_later() {
        let all = routes(false, true, None, true, true);
        let (tried, deliver) = fake(&[]);
        let mut c = Closing::new(all);
        assert!(!c.ask(deliver.clone()).await);
        assert_eq!(c.took(), None);
        assert!(!c.again(deliver).await);
        assert_eq!(*tried.lock().unwrap(), [Route::Bus, Route::Os, Route::Bus, Route::Os]);
    }

    /// Unix: a browser a page holds past SIGINT is closed over CDP, and SIGTERM is not sent.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_held_browser_is_closed_over_cdp_past_quit_wait() {
        let udd = std::env::temp_dir().join(format!("shardx-held-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&udd).unwrap();
        let (ws, served) = devtools(r#"{"id":1,"result":{}}"#).await;
        let (port, path) = ws.trim_start_matches("ws://").split_once(':').unwrap().1.split_once('/').unwrap();
        std::fs::write(udd.join("DevToolsActivePort"), format!("{port}\n/{path}\n")).unwrap();
        let got = udd.join("signals");
        let script = format!(
            "trap 'echo INT >> {g}' INT; trap 'echo TERM >> {g}' TERM; while :; do sleep 0.05; done",
            g = got.display()
        );
        let mut child = tokio::process::Command::new("sh").args(["-c", &script]).spawn().unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let (ack, answer) = tokio::sync::oneshot::channel();
        tx.try_send(ack).unwrap();
        let watch = super::super::watch_child("p-held", &udd, &mut child, &mut rx);
        let (_, answer) = tokio::time::timeout(Duration::from_secs(20), async { tokio::join!(watch, answer) })
            .await
            .expect("taken the hard way 3 s after the second ask");
        assert!(answer.unwrap());
        let asked: serde_json::Value = serde_json::from_str(&served.await.unwrap()).unwrap();
        assert_eq!(asked["method"], "Browser.close");
        assert_eq!(std::fs::read_to_string(&got).unwrap(), "INT\n", "SIGTERM was sent as well");
        drop(tx);
        std::fs::remove_dir_all(&udd).unwrap();
    }

    /// The lock is held but names no pid that can be read (on Windows: its command lines could
    /// not be read): Stop still reaches the browser over CDP and says so, and signals nothing.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_lock_holder_with_no_pid_is_still_asked_over_cdp() {
        use std::os::unix::fs::symlink;
        let udd = std::env::temp_dir().join(format!("shardx-nopid-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&udd).unwrap();
        let out = std::process::Command::new("sh")
            .args(["-c", "set -m; sleep 60 </dev/null >/dev/null 2>&1 & echo $!"])
            .output()
            .unwrap();
        let holder: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        let lock = udd.join("SingletonLock");
        symlink(format!("{}-{holder}", crate::reset::this_host().unwrap()), &lock).unwrap();
        // Written an hour before that process began: its pid is not taken for the browser's.
        let path = std::ffi::CString::new(lock.as_os_str().as_encoded_bytes()).unwrap();
        let then = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() - 3600;
        let tv = libc::timeval { tv_sec: then as _, tv_usec: 0 };
        // SAFETY: a NUL-terminated path and two times.
        assert_eq!(unsafe { libc::lutimes(path.as_ptr(), [tv, tv].as_ptr()) }, 0);
        assert!(crate::reset::lock_is_live(&udd));
        assert_eq!(super::super::lock_holder_pid(&udd), None);

        let (ws, served) = devtools(r#"{"id":1,"result":{}}"#).await;
        let (port, path) = ws.trim_start_matches("ws://").split_once(':').unwrap().1.split_once('/').unwrap();
        std::fs::write(udd.join("DevToolsActivePort"), format!("{port}\n/{path}\n")).unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let mut watch = std::pin::pin!(super::super::watch_lock("p-nopid", &udd, &mut rx));
        let press = async {
            let (ack, answer) = tokio::sync::oneshot::channel();
            tx.try_send(ack).unwrap();
            assert!(answer.await.unwrap(), "Stop said it reached nothing");
            let asked: serde_json::Value = serde_json::from_str(&served.await.unwrap()).unwrap();
            assert_eq!(asked["method"], "Browser.close");
        };
        tokio::select! {
            _ = watch.as_mut() => panic!("the watch ended with the lock still held"),
            _ = press => {}
        }
        // SAFETY: signal 0 delivers nothing.
        assert_eq!(unsafe { libc::kill(holder as libc::pid_t, 0) }, 0, "the process on the lock was signalled");
        // SAFETY: the test's own stray process.
        unsafe { libc::kill(holder as libc::pid_t, libc::SIGKILL) };
        tokio::time::timeout(Duration::from_secs(10), watch).await.expect("the watch ends once the lock is free");
        std::fs::remove_dir_all(&udd).unwrap();
    }

    #[test]
    fn the_debugging_socket_is_read_from_the_profile_folder() {
        let udd = std::env::temp_dir().join(format!("shardx-cdp-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&udd).unwrap();
        assert_eq!(cdp_in(&udd), None);
        let file = udd.join("DevToolsActivePort");
        std::fs::write(&file, "53122\n/devtools/browser/0b1c\n").unwrap();
        assert_eq!(cdp_in(&udd).as_deref(), Some("ws://127.0.0.1:53122/devtools/browser/0b1c"));
        for bad in ["", "x\n/devtools/browser/a\n", "1\n", "1\n/devtools/page/a\n"] {
            std::fs::write(&file, bad).unwrap();
            assert_eq!(cdp_in(&udd), None, "{bad:?}");
        }
        std::fs::remove_dir_all(&udd).unwrap();
    }

    /// A devtools socket that answers Browser.close with `reply`, and what it was sent.
    async fn devtools(reply: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws = format!("ws://{}/devtools/browser/test", listener.local_addr().unwrap());
        let served = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            let Some(Ok(Message::Text(asked))) = socket.next().await else { panic!("no ask") };
            let _ = socket.send(Message::Text(reply.into())).await;
            asked
        });
        (ws, served)
    }

    #[tokio::test]
    async fn browser_close_goes_over_the_debugging_socket() {
        let (ws, served) = devtools(r#"{"id":1,"result":{}}"#).await;
        assert!(by_cdp(&ws).await);
        let asked: serde_json::Value = serde_json::from_str(&served.await.unwrap()).unwrap();
        assert_eq!(asked["method"], "Browser.close");

        let (ws, _served) = devtools(r#"{"id":1,"error":{"code":-32000,"message":"no"}}"#).await;
        assert!(!by_cdp(&ws).await, "an error answer is a refusal");
        // Nothing listening there: the next route is tried.
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(!by_cdp(&format!("ws://127.0.0.1:{port}/devtools/browser/x")).await);
    }

    #[tokio::test]
    async fn the_bus_closes_only_that_profiles_browser() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let bus = crate::sync_bus::Bus::start("tok".into()).await.unwrap();
        let mut members = Vec::new();
        for profile in ["p1", "p2"] {
            let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", bus.port)).await.unwrap();
            let hello = format!("{{\"hello\":\"g-{profile}\",\"token\":\"tok\",\"profile\":\"{profile}\"}}\n");
            tcp.write_all(hello.as_bytes()).await.unwrap();
            members.push(BufReader::new(tcp).lines());
        }
        for _ in 0..200 {
            if bus.group_of("p1").is_some() && bus.group_of("p2").is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!bus.close("p3"), "not on the bus");
        assert!(bus.close("p1"));
        let line = tokio::time::timeout(Duration::from_secs(5), members[0].next_line()).await.unwrap().unwrap();
        assert_eq!(line.as_deref(), Some(r#"{"close":true}"#));
        let other = tokio::time::timeout(Duration::from_millis(300), members[1].next_line()).await;
        assert!(other.is_err(), "p2 was told something: {other:?}");
    }

    type Member = tokio::io::Lines<tokio::io::BufReader<tokio::net::TcpStream>>;

    /// A browser on `bus` as `profile`, greeting as the engine does; `quit` as a new engine says.
    async fn member(bus: &crate::sync_bus::Bus, profile: &str, quit: bool) -> Member {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", bus.port)).await.unwrap();
        let mut hello = serde_json::json!({"hello": "default", "token": bus.token, "profile": profile});
        if quit {
            hello["quit"] = true.into();
        }
        tcp.write_all(format!("{hello}\n").as_bytes()).await.unwrap();
        for _ in 0..200 {
            if bus.group_of(profile).is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        BufReader::new(tcp).lines()
    }

    async fn next_line(m: &mut Member, wait: Duration) -> Option<String> {
        tokio::time::timeout(wait, m.next_line()).await.ok().and_then(|l| l.unwrap())
    }

    #[tokio::test]
    async fn the_bus_quit_goes_only_to_an_engine_that_offers_it() {
        let bus = crate::sync_bus::Bus::start("tok".into()).await.unwrap();
        let mut new = member(&bus, "p-new", true).await;
        let mut old = member(&bus, "p-old", false).await;
        assert!(bus.quits("p-new"));
        assert!(!bus.quits("p-old"), "an engine that did not say so");
        assert!(!bus.quits("p-gone"));
        assert!(!bus.quit("p-old"));
        assert!(!bus.quit("p-gone"));
        assert!(bus.quit("p-new"));
        assert_eq!(next_line(&mut new, Duration::from_secs(5)).await.as_deref(), Some(r#"{"quit":true}"#));
        assert_eq!(next_line(&mut old, Duration::from_millis(300)).await, None, "the old engine was sent the quit");
        // The old engine still gets the close it always got.
        assert!(bus.close("p-old"));
        assert_eq!(next_line(&mut old, Duration::from_secs(5)).await.as_deref(), Some(r#"{"close":true}"#));
    }

    /// A browser on `bus` as `profile` in `group`, as an engine greets.
    async fn in_group(bus: &crate::sync_bus::Bus, group: &str, profile: &str) -> Member {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", bus.port)).await.unwrap();
        let hello = serde_json::json!({"hello": group, "token": bus.token, "profile": profile});
        tcp.write_all(format!("{hello}\n").as_bytes()).await.unwrap();
        for _ in 0..200 {
            if bus.status(group).members.iter().any(|m| m.profile == profile) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        BufReader::new(tcp).lines()
    }

    async fn say(m: &mut Member, line: &str) {
        use tokio::io::AsyncWriteExt;
        m.get_mut().get_mut().write_all(format!("{line}\n").as_bytes()).await.unwrap();
    }

    /// A member cannot send another an instruction: every lone browser is in "default", so a
    /// `{"quit":true}` passed on would stop them all. Its actions still reach the group.
    #[tokio::test]
    async fn a_member_passes_on_actions_and_nothing_else() {
        let bus = crate::sync_bus::Bus::start("tok".into()).await.unwrap();
        let mut a = in_group(&bus, "default", "p-a").await;
        let mut b = in_group(&bus, "default", "p-b").await;
        for line in [r#"{"quit":true}"#, r#"{"close":true}"#, r#"{"bounds":{"x":0,"y":0,"w":9,"h":9}}"#] {
            say(&mut a, line).await;
        }
        say(&mut a, r#"{"t":"mouse","n":1}"#).await;
        assert_eq!(next_line(&mut b, Duration::from_secs(5)).await.as_deref(), Some(r#"{"t":"mouse","n":1}"#));
        assert_eq!(next_line(&mut b, Duration::from_millis(300)).await, None);
        assert_eq!(next_line(&mut a, Duration::from_millis(100)).await, None, "echoed to the sender");
    }

    /// A browser that changes group greets again on a new connection. The old one closing after
    /// that leaves it where it went, with the helper's offer.
    #[tokio::test]
    async fn a_browser_that_greets_again_keeps_its_new_group_and_its_offer() {
        let bus = crate::sync_bus::Bus::start("tok".into()).await.unwrap();
        let old = in_group(&bus, "default", "p-r").await;
        let mut new = in_group(&bus, "g-new", "p-r").await;
        say(&mut new, r#"{"helper":{"fields":[{"kind":"email"}]}}"#).await;
        for _ in 0..200 {
            if bus.helper_fields("p-r").is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        drop(old);
        for _ in 0..200 {
            if bus.status("default").members.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(bus.status("default").members.is_empty());
        assert_eq!(bus.group_of("p-r").as_deref(), Some("g-new"));
        assert!(bus.helper_fields("p-r").is_some(), "the old connection took the offer with it");
        drop(new);
        for _ in 0..200 {
            if bus.helper_fields("p-r").is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(bus.helper_fields("p-r").is_none(), "the offer outlived the browser");
    }

    /// The whole ask as Stop makes it, over the launcher's own bus: an engine that offers the
    /// quit gets it and nothing else; an older one gets the close.
    #[tokio::test]
    async fn stop_asks_over_the_bus_with_what_the_engine_knows() {
        let bus = crate::bus().await.unwrap();
        let mut new = member(&bus, "p-stop-new", true).await;
        let mut s = Stop::new(None, Some("p-stop-new"), None);
        assert_eq!(s.closing.routes, [Route::Quit]);
        assert!(s.ask().await);
        assert_eq!(next_line(&mut new, Duration::from_secs(5)).await.as_deref(), Some(r#"{"quit":true}"#));
        assert_eq!(next_line(&mut new, Duration::from_millis(300)).await, None, "asked twice");

        let mut old = member(&bus, "p-stop-old", false).await;
        let mut s = Stop::new(None, Some("p-stop-old"), None);
        assert_eq!(s.closing.routes, [Route::Bus]);
        assert!(s.ask().await);
        assert_eq!(next_line(&mut old, Duration::from_secs(5)).await.as_deref(), Some(r#"{"close":true}"#));
    }
}
