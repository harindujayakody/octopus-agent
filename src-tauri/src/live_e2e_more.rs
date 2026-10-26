//! Failure modes on the live stack: server restart mid-session, a link cut
//! during an upload, double starts, close racing a revoke, delete while open,
//! clock skew, a session near 256 MB, and wrong / revoked / replaced tokens.
//! Run with SHARDX_LIVE_SET=F (and SHARDX_LIVE_SKEW=<skew.dylib> for the clock
//! cases; build it from `tools/skew.c`, which says how).

use super::*;
use crate::space::client::Method;
use harness::Relay;

const MB: u64 = 1024 * 1024;

fn e2s<E: std::fmt::Display>(e: E) -> String {
    format!("harness: {e}")
}

fn outcomes(events: &Value) -> Vec<String> {
    events
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|e| e["event"] == json!("team-session"))
                .map(|e| e["payload"]["outcome"].as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Main browser processes (not helpers) started on `udd`.
fn browsers_on(udd: &Path) -> Vec<u32> {
    let ps = std::process::Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mark = format!("--user-data-dir={}", udd.display());
    ps.lines()
        .filter(|l| l.contains(&mark) && !l.contains("--type=") && !l.contains("--reap"))
        .filter_map(|l| l.trim().split_whitespace().next().and_then(|p| p.parse().ok()))
        .collect()
}

fn log_lines(w: &World, role: &str, pat: &[&str]) -> Vec<String> {
    std::fs::read_to_string(w.logs.join(format!("{role}.log")))
        .unwrap_or_default()
        .lines()
        .filter(|l| pat.iter().any(|p| l.contains(p)))
        .map(String::from)
        .collect()
}

fn ws_of(l: &Value) -> R<String> {
    l["ws"].as_str().map(String::from).ok_or_else(|| format!("harness: no CDP address in {l}"))
}

async fn rev_of(w: &World, id: &str) -> R<u64> {
    Ok(w.row(id).await?["session_rev"].as_u64().unwrap_or(0))
}

/// Any request at the server, with any token and device.
async fn raw(w: &World, method: Method, path: &str, token: &str, device: &str, body: Option<Vec<u8>>) -> (u16, Value) {
    match w.raw_client(token, device).raw(method, path, body).await {
        Ok((st, b)) => (st, serde_json::from_slice(&b).unwrap_or(Value::Null)),
        Err(e) => (0, json!(e.to_string())),
    }
}

/// A PUT with a chunked body of `total` bytes, written by hand inside the wire; the status line back.
async fn raw_chunked_put(w: &World, path: &str, token: &str, device: &str, total: u64) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let port = w.server.port;
    let Ok(mut s) = w.raw_client(token, device).wire_stream().await else { return "connect failed".into() };
    let head = format!(
        "PUT {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nX-Device-Id: {device}\r\n\
         Content-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    );
    if s.write_all(head.as_bytes()).await.is_err() {
        return "head not sent".into();
    }
    let piece = vec![7u8; MB as usize];
    let mut sent = 0u64;
    let mut broke = None;
    while sent < total {
        let n = (total - sent).min(MB) as usize;
        let mut c = format!("{n:x}\r\n").into_bytes();
        c.extend_from_slice(&piece[..n]);
        c.extend_from_slice(b"\r\n");
        if let Err(e) = s.write_all(&c).await {
            broke = Some(format!("write broke at {} MB: {e}", sent / MB));
            break;
        }
        sent += n as u64;
    }
    if broke.is_none() {
        let _ = s.write_all(b"0\r\n\r\n").await;
    }
    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(Duration::from_secs(30), s.read(&mut buf)).await.ok().and_then(|r| r.ok()).unwrap_or(0);
    let text = String::from_utf8_lossy(&buf[..n]).to_string();
    let status = text.lines().next().unwrap_or("").to_string();
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
    format!("{status} {body} (sent {} MB{})", sent / MB, broke.map(|b| format!("; {b}")).unwrap_or_default())
}

/// A PUT that declares `len` bytes and sends none of them, inside the wire: the status line back.
async fn raw_declared_put(w: &World, path: &str, token: &str, device: &str, len: u64) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let port = w.server.port;
    let Ok(mut s) = w.raw_client(token, device).wire_stream().await else { return "connect failed".into() };
    let head = format!(
        "PUT {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nX-Device-Id: {device}\r\n\
         Content-Type: application/octet-stream\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n"
    );
    if s.write_all(head.as_bytes()).await.is_err() {
        return "head not sent".into();
    }
    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(Duration::from_secs(10), s.read(&mut buf)).await.ok().and_then(|r| r.ok()).unwrap_or(0);
    let text = String::from_utf8_lossy(&buf[..n]).to_string();
    let status = text.lines().next().unwrap_or("(no answer)").to_string();
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
    format!("{status} {body}")
}

/// Bodies on the server that no blob points at: an upload that never finished, not yet collected.
fn orphan_bodies(w: &World) -> String {
    let db = w.server.data.join("team.sqlite");
    let Ok(c) = rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return "db not opened".into() };
    let q = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(-1);
    let bodies = q("SELECT COUNT(*) FROM bodies b WHERE NOT EXISTS (SELECT 1 FROM blobs h WHERE h.body = b.id)");
    let chunks = q("SELECT COUNT(*) FROM chunks c WHERE NOT EXISTS (SELECT 1 FROM blobs h WHERE h.body = c.body)");
    let all = q("SELECT COUNT(*) FROM bodies");
    format!("orphan bodies={bodies} orphan chunks={chunks} (bodies in all={all})")
}

const OPEN_DB: &str = "await new Promise((res, rej) => { const r = indexedDB.open('big', 1); \
    r.onupgradeneeded = () => r.result.createObjectStore('b'); r.onsuccess = () => res(r.result); \
    r.onerror = () => rej(String(r.error)); })";

/// `n` blobs of 4 MB of random bytes into the site's IndexedDB, keys from `from`.
async fn fill_idb(ws: &str, base: &str, n: u64, from: u64) -> R<Value> {
    let mut cdp = Cdp::connect(ws).await?;
    let sid = cdp.open(&format!("{base}/")).await?;
    cdp.wait = Duration::from_secs(600);
    let js = format!(
        "(async () => {{ const db = {OPEN_DB}; const size = 4 * 1024 * 1024; \
         for (let i = 0; i < {n}; i++) {{ const a = new Uint8Array(size); \
           for (let o = 0; o < size; o += 65536) crypto.getRandomValues(a.subarray(o, o + 65536)); \
           await new Promise((res, rej) => {{ const tx = db.transaction('b', 'readwrite'); \
             tx.objectStore('b').put(new Blob([a]), 'k' + ({from} + i)); tx.oncomplete = res; \
             tx.onerror = () => rej(String(tx.error)); tx.onabort = () => rej(String(tx.error)); }}); }} \
         db.close(); return {n} * 4; }})()"
    );
    cdp.eval(&sid, &js, true).await
}

/// What the site's IndexedDB holds: blobs, bytes, and whether the last one reads back whole.
async fn read_idb(ws: &str, base: &str) -> R<Value> {
    let mut cdp = Cdp::connect(ws).await?;
    let sid = cdp.open(&format!("{base}/")).await?;
    cdp.wait = Duration::from_secs(120);
    let js = format!(
        "(async () => {{ const db = {OPEN_DB}; \
         const all = await new Promise((res, rej) => {{ const q = db.transaction('b').objectStore('b').getAll(); \
           q.onsuccess = () => res(q.result); q.onerror = () => rej(String(q.error)); }}); \
         let bytes = 0; for (const b of all) bytes += b.size; let readable = 0; let error = null; \
         if (all.length) {{ try {{ readable = (await all[all.length - 1].arrayBuffer()).byteLength; }} catch (e) {{ error = String(e); }} }} \
         db.close(); return JSON.stringify({{ n: all.length, bytes, readable, error }}); }})()"
    );
    let v = cdp.eval(&sid, &js, true).await?;
    Ok(serde_json::from_str(v.as_str().unwrap_or("null")).unwrap_or(Value::Null))
}

/// The profile's localStorage keys and the cookie pairs on the test site, as the browser at `ws` has them.
async fn look(w: &mut World, ws: &str) -> R<(Value, Vec<String>)> {
    let base = w.site_url("");
    let read = w.read_browser(ws, &base).await?;
    let cookies: Vec<String> = serde_json::from_value(read["cookies"].clone()).unwrap_or_default();
    Ok((read["page"]["ls"].clone(), cookies))
}

/// Whatever device has `id` open closes it, so a failed scenario does not leak into the next.
async fn settle(w: &mut World, ids: &[String]) {
    for id in ids.iter().filter(|i| !i.is_empty()) {
        for dev in [w.a.as_mut(), Some(&mut w.b), w.c.as_mut(), w.d.as_mut()].into_iter().flatten() {
            let open = dev.call("open_list", json!({})).await.unwrap_or(Value::Null);
            let here = open.as_array().is_some_and(|a| a.iter().any(|o| o["profile_id"] == json!(id)));
            if here {
                eprintln!("[live]   (settle: {} closes {id})", dev.name);
                let _ = dev.call("stop", json!({ "id": id, "secs": 600 })).await;
            }
        }
    }
}

async fn set_grants(w: &mut World, member: &str, grants: Vec<Value>) -> R<Value> {
    w.admin.call("admin_set_grants", json!({ "member": member, "grants": grants })).await
}

/// Until `dev`'s list shows `right` on `id` as `want`; how long it took.
async fn wait_right(dev: &mut Dev, id: &str, right: &str, want: bool, secs: u64) -> Option<Duration> {
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(secs) {
        if World::rights_of(dev, id).await.ok().is_some_and(|r| r[right] == json!(want)) {
            return Some(t0.elapsed());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    None
}

fn b_grants() -> Vec<Value> {
    grant(folder_scope("Shop"), &["see", "start", "cookies"])
}

// =====================================================================

/// F9: a personal profile started twice at once (two quick clicks, or the local API twice).
async fn f9(w: &mut World) -> R {
    let (engine, fp, logs) = (w.engine.clone(), w.fp.clone(), w.logs.clone());
    let how = harness::Spawn { engine: &engine, fp: &fp, logs: &logs };
    let mut e = Dev::spawn("Device E", "e", w.out.join("devices/e"), &how).await?;
    let r = f9_on(w, &mut e).await;
    w.e = Some(e);
    r
}

async fn f9_on(w: &mut World, e: &mut Dev) -> R {
    let p = e.call("create_profile", json!({ "name": "Double click", "folder": "" })).await?;
    let id = p["id"].as_str().unwrap_or_default().to_string();
    let udd = e.data().join("user-data").join(&id);
    let r = e.call("launch_twice", json!({ "id": id, "gap_ms": 0 })).await?;
    w.report.note(format!("E (personal) started {id} twice at once: {}", short(&r)));
    let oks = [&r["first"], &r["second"]].iter().filter(|x| x["ok"] == json!(true)).count();
    tokio::time::sleep(Duration::from_secs(4)).await;
    let main = browsers_on(&udd);
    let running = e.call("running", json!({})).await?;
    let tracked: Vec<Value> = running.as_array().cloned().unwrap_or_default().into_iter().filter(|x| x.to_string().contains(&id)).collect();
    w.report.note(format!("4 s later: browser main processes on its folder {main:?}; launcher tracks {}", short(&json!(tracked))));
    w.report.check(oks == 1, format!("exactly one of the two starts succeeds (got {oks})"));
    w.report.check(main.len() == 1, format!("exactly one browser runs on the profile's folder (got {})", main.len()));
    w.report.check(!tracked.is_empty() && main.iter().all(|p| tracked.iter().any(|t| t.to_string().contains(&p.to_string()))), "the browser that runs is the one the launcher tracks (Stop reaches it)");
    let stop = e.call("stop", json!({ "id": id })).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let left = browsers_on(&udd);
    w.report.note(format!("Stop: {}; browsers left on the folder: {left:?}", match &stop { Ok(v) => short(v), Err(e) => e.clone() }));
    w.report.check(left.is_empty(), "after Stop no browser is left on the profile");
    for pid in left {
        unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    }
    Ok(())
}

/// F8a: joining by IP with a wrong token, a forged admin token, a wrong port.
async fn f8a(w: &mut World) -> R {
    let mut e = w.e.take().ok_or("harness: no device E")?;
    let r = f8a_on(w, &mut e).await;
    w.e = Some(e);
    r
}

async fn f8a_on(w: &mut World, e: &mut Dev) -> R {
    let url = w.server.url();
    let cases = [
        ("a member token the server never issued", format!("{url}#stm_{}", "Q".repeat(43)), "the server does not know this token"),
        ("a forged admin token (eyJ…)", format!("{url}#eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.AAAA"), "the server does not know this token"),
    ];
    for (what, invite, want) in cases {
        let r = e.call("join", json!({ "invite": invite })).await;
        match &r {
            Err(t) => w.report.check(t == want, format!("join with {what}: refused \"{t}\"")),
            Ok(v) => w.report.check(false, format!("join with {what} went through: {}", short(v))),
        };
    }
    let dead = harness::free_port();
    let r = e.call("join", json!({ "invite": format!("http://127.0.0.1:{dead}#stm_{}", "Q".repeat(43)) })).await;
    w.report.note(format!("join to a port nobody listens on: {r:?}"));
    w.report.check(r.as_ref().is_err_and(|t| t.contains("did not answer")), "a dead address is told as not answering");
    let (st, v) = raw(w, Method::GET, "/permission", &format!("stm_{}", "Q".repeat(43)), "raw", None).await;
    w.report.check(st == 401, format!("GET /permission with an unknown token: {st} {v}"));
    let state = e.call("state", json!({})).await?;
    w.report.check(state["space"]["space"]["kind"] == json!("personal") && state["space"]["teams"].as_array().is_none_or(|t| t.is_empty()), format!("E stays personal, no team kept: {}", short(&state["space"])));
    Ok(())
}

/// F3: two quick starts of a team profile on B.
async fn f3(w: &mut World) -> R {
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let rev0 = rev_of(w, &id).await?;
    let r = w.b.call("launch_twice", json!({ "id": id, "gap_ms": 0 })).await?;
    w.report.note(format!("B started P twice at once: {}", short(&r)));
    let (ok, bad): (Vec<&Value>, Vec<&Value>) = [&r["first"], &r["second"]].into_iter().partition(|x| x["ok"] == json!(true));
    w.report.check(ok.len() == 1, format!("exactly one start succeeds (got {})", ok.len()));
    let err = bad.first().and_then(|b| b["error"].as_str()).unwrap_or("").to_string();
    w.report.check(
        err == crate::space::open::BUSY || err.contains("already running"),
        format!("the other is refused as busy: \"{err}\""),
    );
    let udd = w.copy_dir(&w.b, &id).join("udd");
    tokio::time::sleep(Duration::from_secs(2)).await;
    let main = browsers_on(&udd);
    w.report.check(main.len() == 1, format!("one browser on B's copy: {main:?}"));
    let row = w.row(&id).await?;
    w.report.check(row["open_on"]["device_name"] == json!("Device B"), format!("server lease: open_on={}", row["open_on"]["device_name"]));
    let open = w.b.call("open_list", json!({})).await?;
    w.report.check(open.as_array().map_or(0, |a| a.iter().filter(|o| o["profile_id"] == json!(id)).count()) == 1, format!("B holds one open session for P: {}", short(&open)));
    let again = w.b.call("launch", json!({ "id": id })).await;
    w.report.note(format!("a third start while it runs: {}", match &again { Ok(v) => short(v), Err(e) => e.clone() }));
    w.report.check(again.is_err(), "a third start while it runs is refused");
    if let Some(ws) = ok.first().and_then(|o| o["ws"].as_str()) {
        let base = w.site_url("");
        w.set_in_browser(ws, &base, "f3", "double").await?;
    }
    let stop = w.b.call("stop", json!({ "id": id })).await?;
    let row = w.row(&id).await?;
    w.report.check(outcomes(&stop["events"]) == vec!["saved"], format!("closed and saved: {:?}", outcomes(&stop["events"])));
    w.report.check(row["session_rev"].as_u64() == Some(rev0 + 1) && row["open_on"].is_null(), format!("session_rev {rev0} -> {}, open_on={}", row["session_rev"], row["open_on"]));
    w.report.check(!w.copy_dir(&w.b, &id).exists() && browsers_on(&udd).is_empty(), "no copy and no browser left on B");
    Ok(())
}

/// F4: Start taken from B while P is open, then the same racing B's own close.
async fn f4(w: &mut World) -> R {
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    let mb = w.member_b.clone();
    // (a) taken while open
    let rev0 = rev_of(w, &id).await?;
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "f4a", "open").await?;
    let since = w.b.call("now", json!({})).await?.as_u64().unwrap_or(0);
    let t0 = Instant::now();
    set_grants(w, &mb, grant(folder_scope("Shop"), &["see", "cookies"])).await?;
    let c = w.b.call("wait_closed", json!({ "id": id, "since": since, "secs": 90 })).await;
    let took = t0.elapsed();
    let out = c.as_ref().map(|c| outcomes(&c["events"])).unwrap_or_default();
    w.report.check(c.is_ok() && out == vec!["saved"], format!("(a) Start taken while open: B closed it {took:?} later, outcome {out:?}"));
    let row = w.row(&id).await?;
    w.report.check(row["session_rev"].as_u64() == Some(rev0 + 1) && row["open_on"].is_null(), format!("(a) uploaded under the lease though Start was gone: session_rev {rev0} -> {}, open_on={}", row["session_rev"], row["open_on"]));
    // (b) the revoke racing B's own Stop
    set_grants(w, &mb, b_grants()).await?;
    let back = wait_right(&mut w.b, &id, "start", true, 30).await;
    w.report.note(format!("B's Start back after {back:?}"));
    let rev1 = rev_of(w, &id).await?;
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "f4b", "race").await?;
    let take = grant(folder_scope("Shop"), &["see", "cookies"]);
    let (stop, g) = tokio::join!(
        w.b.call("stop", json!({ "id": id })),
        w.admin.call("admin_set_grants", json!({ "member": mb, "grants": take }))
    );
    w.report.note(format!("(b) B's Stop: {}; admin's revoke: {}", match &stop { Ok(v) => format!("{:?} in {} ms", outcomes(&v["events"]), v["closed_ms"]), Err(e) => e.clone() }, match &g { Ok(_) => "ok".into(), Err(e) => e.clone() }));
    tokio::time::sleep(Duration::from_secs(1)).await;
    let row = w.row(&id).await?;
    w.report.check(stop.as_ref().is_ok_and(|s| outcomes(&s["events"]) == vec!["saved"]), "(b) the racing close still saves");
    w.report.check(row["session_rev"].as_u64() == Some(rev1 + 1) && row["open_on"].is_null(), format!("(b) session_rev {rev1} -> {}, lease freed: open_on={}", row["session_rev"], row["open_on"]));
    w.report.check(!w.copy_dir(&w.b, &id).exists(), "(b) B's copy wiped");
    // A reads what both closes sent.
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let (ls, cookies) = look(w, &ws).await?;
    w.a().call("stop", json!({ "id": id })).await?;
    w.report.check(ls["ls_f4a"] == json!("open") && ls["ls_f4b"] == json!("race"), format!("A sees both of B's sessions: ls={} cookies={cookies:?}", short(&ls)));
    set_grants(w, &mb, b_grants()).await?;
    wait_right(&mut w.b, &id, "start", true, 30).await;
    Ok(())
}

/// F5: A deletes P while B has it open; then after B closes; restore from the team's trash.
async fn f5(w: &mut World) -> R {
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    let ma = w.member_a.clone();
    set_grants(w, &ma, grant(team_scope(), &["see", "create", "edit", "start", "cookies", "delete"])).await?;
    let got = wait_right(w.a(), &id, "delete", true, 30).await;
    w.report.note(format!("A has Delete after {got:?}"));
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "f5", "kept").await?;
    let ra = w.a().call("profile_delete", json!({ "id": id })).await;
    w.report.check(ra.as_ref().is_err_and(|e| e.contains("open on Device B")), format!("A's delete while B has it open is refused: {ra:?}"));
    let rd = w.admin.call("profile_delete", json!({ "id": id })).await;
    w.report.check(rd.is_err(), format!("the admin's delete is refused too: {rd:?}"));
    w.report.check(w.row(&id).await.is_ok(), "the profile is still on the server");
    let alive = w.b.call("open_list", json!({})).await?;
    w.report.check(alive.to_string().contains(&id), "B's session runs on");
    w.b.call("stop", json!({ "id": id })).await?;
    let rev_b = rev_of(w, &id).await?;
    let ra = w.a().call("profile_delete", json!({ "id": id })).await;
    w.report.check(ra.is_ok(), format!("A's delete once B closed: {ra:?}"));
    let t0 = Instant::now();
    let mut gone = None;
    while t0.elapsed() < Duration::from_secs(15) {
        let rows = w.b.call("profiles", json!({})).await?;
        if !World::ids(&rows).contains(&id) {
            gone = Some(t0.elapsed());
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    w.report.check(gone.is_some(), format!("gone from B's list {gone:?} after"));
    let rb = w.b.call("launch", json!({ "id": id })).await;
    w.report.check(rb.is_err(), format!("B's start of the deleted profile: {rb:?}"));
    let tok = w.admin_token.clone();
    let trash = w.server_get(&tok, "/trash").await?;
    w.report.check(trash.to_string().contains(&id), format!("in the team's trash on the server: {}", short(&trash)));
    // The launcher's own way back (team_trash_*): See where it was lists it, Delete there restores it.
    let in_list = |v: &Result<Value, String>| v.as_ref().is_ok_and(|v| v.as_array().is_some_and(|a| a.iter().any(|r| r["id"] == json!(id) && r["kind"] == json!("profile"))));
    let lb = w.b.call("trash_list", json!({})).await;
    w.report.check(in_list(&lb), format!("B (See on Shop) lists it in the team's trash: {}", lb.as_ref().map(short).unwrap_or_else(|e| e.clone())));
    let rb = w.b.call("trash_restore", json!({ "id": id, "kind": "profile" })).await;
    w.report.check(rb.is_err(), format!("B's restore (no Delete) is refused: {rb:?}"));
    let la = w.a().call("trash_list", json!({})).await;
    w.report.check(in_list(&la), format!("A lists it in the team's trash: {}", la.as_ref().map(short).unwrap_or_else(|e| e.clone())));
    let ra = w.a().call("trash_restore", json!({ "id": id, "kind": "profile" })).await;
    w.report.check(ra.as_ref().is_ok_and(|v| v["kind"] == json!("profile") && v["id"] == json!(id)), format!("A restores it from the launcher: {ra:?}"));
    let row = w.row(&id).await?;
    w.report.check(row["session_rev"].as_u64() == Some(rev_b), format!("restored with its session: session_rev {} (was {rev_b})", row["session_rev"]));
    let t0 = Instant::now();
    let mut back = None;
    while t0.elapsed() < Duration::from_secs(15) {
        let rows = w.b.call("profiles", json!({})).await?;
        if World::ids(&rows).contains(&id) {
            back = Some(t0.elapsed());
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    w.report.check(back.is_some(), format!("back in B's list {back:?} after"));
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let (ls, _) = look(w, &ws).await?;
    w.a().call("stop", json!({ "id": id })).await?;
    w.report.check(ls["ls_f5"] == json!("kept"), format!("B's last session came back with it: ls_f5={}", ls["ls_f5"]));
    Ok(())
}

/// F1: the server restarts (down 40 s, inside the 90 s lease) while A has P open.
async fn f1(w: &mut World) -> R {
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    let rev0 = rev_of(w, &id).await?;
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "f1", "restart").await?;
    let row0 = w.row(&id).await?;
    let e0 = row0["open_on"]["expires_at"].as_u64().unwrap_or(0);
    w.report.note(format!("before: open_on={} expires_at={e0}", row0["open_on"]["device_name"]));
    let a_log0 = log_lines(w, "a", &["lease not renewed"]).len();
    w.server.stop().await;
    let t_down = Instant::now();
    let rb = w.b.call("launch", json!({ "id": id })).await;
    w.report.note(format!("B's start while the server is down: {}", match &rb { Ok(v) => short(v), Err(e) => e.clone() }));
    w.report.check(rb.is_err(), "B cannot start it while the server is down");
    tokio::time::sleep(Duration::from_secs(40).saturating_sub(t_down.elapsed())).await;
    w.server.start().await?;
    w.report.note(format!("server back after {:?}", t_down.elapsed()));
    let row1 = w.row(&id).await?;
    let e1 = row1["open_on"]["expires_at"].as_u64().unwrap_or(0);
    w.report.check(row1["open_on"]["device_name"] == json!("Device A"), format!("the lease survived the restart: open_on={} expires_at={e1}", row1["open_on"]["device_name"]));
    let rb = w.b.call("launch", json!({ "id": id })).await;
    w.report.check(rb.as_ref().is_err_and(|e| e == "this profile is open on Device A: close it there first"), format!("B's start right after the restart: {rb:?}"));
    let t0 = Instant::now();
    let mut renewed = None;
    while t0.elapsed() < Duration::from_secs(75) {
        let e = w.row(&id).await?["open_on"]["expires_at"].as_u64().unwrap_or(0);
        if e > e1 {
            renewed = Some((t0.elapsed(), e));
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    w.report.check(renewed.is_some(), format!("A renewed its lease after the restart: {renewed:?}"));
    // The live channel came back: a grants change reaches B.
    let mb = w.member_b.clone();
    let t0 = Instant::now();
    set_grants(w, &mb, grant(folder_scope("Shop"), &["see", "start", "cookies", "edit"])).await?;
    let heard = wait_right(&mut w.b, &id, "edit", true, 90).await;
    w.report.check(heard.is_some_and(|d| d < Duration::from_secs(30)), format!("B heard a grants change made {:?} after the restart within {heard:?}", t_down.elapsed().saturating_sub(t0.elapsed())));
    set_grants(w, &mb, b_grants()).await?;
    let stop = w.a().call("stop", json!({ "id": id })).await?;
    let row = w.row(&id).await?;
    w.report.check(outcomes(&stop["events"]) == vec!["saved"] && row["session_rev"].as_u64() == Some(rev0 + 1) && row["open_on"].is_null(), format!("A's close after the restart saves: {:?}, session_rev {rev0} -> {}", outcomes(&stop["events"]), row["session_rev"]));
    let missed = log_lines(w, "a", &["lease not renewed"]);
    w.report.note(format!("A's log while down: {:?}", &missed[a_log0.min(missed.len())..]));
    Ok(())
}

/// F1b: the server is down longer than a lease (100 s) while A has P open.
async fn f1b(w: &mut World) -> R {
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "f1b", "a-work").await?;
    let since_a = w.a().call("now", json!({})).await?.as_u64().unwrap_or(0);
    w.server.stop().await;
    tokio::time::sleep(Duration::from_secs(100)).await;
    w.server.start().await?;
    let row = w.row(&id).await?;
    w.report.note(format!("server back after 100 s: open_on={}", row["open_on"]));
    let rb = w.b.call("launch", json!({ "id": id })).await;
    w.report.check(rb.is_err(), format!("B's start right after the restart, while A still has it open: {}", match &rb { Ok(_) => "STARTED (took the lease)".to_string(), Err(e) => format!("refused \"{e}\"") }));
    let c = w.a().call("wait_closed", json!({ "id": id, "since": since_a, "secs": 45 })).await;
    let out = c.as_ref().map(|c| outcomes(&c["events"])).unwrap_or_default();
    w.report.check(c.is_err(), format!("A's open profile stays open: {}", match &c { Ok(v) => format!("closed by the launcher {} ms after, outcome {out:?}", v["closed_ms"]), Err(_) => "still open".into() }));
    let warn = log_lines(w, "a", &["WARNING", "could not reach the team", "lease"]);
    w.report.note(format!("A's log: {:?}", warn.iter().rev().take(4).collect::<Vec<_>>()));
    if let Ok(l) = &rb {
        let ws = ws_of(l)?;
        let (ls, _) = look(w, &ws).await?;
        w.report.check(ls["ls_f1b"] == json!("a-work"), format!("A's work reached B: ls_f1b={}", ls["ls_f1b"]));
        w.b.call("stop", json!({ "id": id })).await?;
    }
    settle(w, &[id.clone()]).await;
    Ok(())
}

/// F7: a session of ~232 MB, then one past 256 MB, then the server's own limit.
async fn f7(w: &mut World) -> R {
    let base = w.site_url("");
    let p2 = w.a().call("create_profile", json!({ "name": "Big shop", "folder": "Shop" })).await?;
    w.p2 = p2["id"].as_str().unwrap_or_default().to_string();
    let id = w.p2.clone();
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let t = Instant::now();
    let wrote = fill_idb(&ws, &base, 58, 0).await?;
    w.report.note(format!("A wrote {wrote} MB of random blobs to the site's IndexedDB in {:?}", t.elapsed()));
    w.set_in_browser(&ws, &base, "big", "1").await?;
    let on_a = read_idb(&ws, &base).await?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let t = Instant::now();
    let stop = w.a().call("stop", json!({ "id": id, "secs": 900 })).await?;
    let took = t.elapsed();
    let row = w.row(&id).await?;
    let size = row["session_size"].as_u64().unwrap_or(0);
    let packed = log_lines(w, "a", &["session packed"]).last().cloned().unwrap_or_default();
    w.report.note(format!("A's close (pack + upload) took {took:?}: {:?}; {packed}; IDB on A {on_a}", outcomes(&stop["events"])));
    w.report.check(row["session_rev"] == json!(1) && size > 200 * MB && size < 256 * MB, format!("server keeps it: session_rev={} size={} MB", row["session_rev"], size / MB));
    let t = Instant::now();
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let start_took = t.elapsed();
    let ws = ws_of(&l)?;
    let on_b = read_idb(&ws, &base).await?;
    let (ls, _) = look(w, &ws).await?;
    w.report.note(format!("B's start (download + unpack) took {start_took:?}; IDB on B {on_b}"));
    w.report.check(on_b["bytes"].as_u64() == Some(232 * MB) && on_b["readable"].as_u64() == Some(4 * MB) && ls["ls_big"] == json!("1"), "B has all 232 MB of it, readable");
    let t = Instant::now();
    let stop = w.b.call("stop", json!({ "id": id, "secs": 900 })).await?;
    w.report.note(format!("B's close took {:?}: {:?}", t.elapsed(), outcomes(&stop["events"])));
    w.report.check(rev_of(w, &id).await? == 2, "session_rev 2 after B's close");
    // Past the budget: 232 + 40 MB.
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    fill_idb(&ws, &base, 10, 58).await?;
    let warn0 = log_lines(w, "a", &["256 MB"]).len();
    let stop = w.a().call("stop", json!({ "id": id, "secs": 900 })).await?;
    let row = w.row(&id).await?;
    let warn = log_lines(w, "a", &["256 MB"]);
    w.report.note(format!("past 256 MB: {:?}; session_rev={} size={} KB; warning: {:?}", outcomes(&stop["events"]), row["session_rev"], row["session_size"].as_u64().unwrap_or(0) / 1024, &warn[warn0.min(warn.len())..]));
    w.report.check(row["session_rev"] == json!(3) && warn.len() > warn0, "a session past 256 MB is still saved, the bulky site storage left out, and the person is told");
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let on_b = read_idb(&ws, &base).await?;
    let (ls, _) = look(w, &ws).await?;
    w.b.call("stop", json!({ "id": id, "secs": 900 })).await?;
    w.report.note(format!("what B gets now: IDB {on_b}; ls_big={}", ls["ls_big"]));
    let clean = on_b["error"].is_null() && (on_b["n"] == json!(0) || on_b["readable"].as_u64() == Some(4 * MB));
    w.report.check(clean && ls["ls_big"] == json!("1"), format!("after the over-budget save B's copy is whole: the site's IndexedDB all there or cleanly left out, its localStorage kept ({} MB, error {})", on_b["bytes"].as_u64().unwrap_or(0) / MB, on_b["error"]));
    // The server's own limit, raw: 256 MB + 1 byte, declared and chunked.
    let cur = rev_of(w, &id).await?;
    let tok = w.token_a.clone();
    let (st, v) = raw(w, Method::POST, &format!("/profiles/{id}/lease"), &tok, "raw-dev", None).await;
    w.report.note(format!("raw lease: {st} {}", short(&v)));
    let declared = raw_declared_put(w, &format!("/profiles/{id}/session?base_session_rev={cur}"), &tok, "raw-dev", 256 * MB + 1).await;
    w.report.check(declared.contains(" 413 "), format!("PUT declaring 256 MB + 1, refused before the body: {declared}"));
    let chunked = raw_chunked_put(w, &format!("/profiles/{id}/session?base_session_rev={cur}"), &tok, "raw-dev", 256 * MB + MB).await;
    w.report.check(chunked.contains(" 413 "), format!("PUT 257 MB chunked: {chunked}"));
    let (st, _) = raw(w, Method::DELETE, &format!("/profiles/{id}/lease"), &tok, "raw-dev", None).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    w.report.check(rev_of(w, &id).await? == cur, format!("session_rev unchanged; lease given back {st}; {}", orphan_bodies(w)));
    Ok(())
}

/// F2: device C reaches the server through a link that is cut 4 MB into the upload.
async fn f2(w: &mut World) -> R {
    let relay = Relay::start(w.server.port).await;
    w.report.note(format!("relay {} -> server {}", relay.url(), w.server.url()));
    let m = w.admin.call("admin_member_create", json!({ "name": "Member C" })).await?;
    w.member_c = m["member"]["id"].as_str().unwrap_or_default().into();
    let inv = m["invite"].as_str().unwrap_or_default().to_string();
    w.token_c = split_invite(&inv).map(|(_, t)| t).unwrap_or_default();
    w.invite_c = format!("{}#{}", relay.url(), w.token_c);
    let mc = w.member_c.clone();
    set_grants(w, &mc, b_grants()).await?;
    let (engine, fp, logs) = (w.engine.clone(), w.fp.clone(), w.logs.clone());
    let how = harness::Spawn { engine: &engine, fp: &fp, logs: &logs };
    let mut c = Dev::spawn("Device C", "c", w.out.join("devices/c"), &how).await?;
    w.relay = Some(relay);
    let r = f2_on(w, &mut c).await;
    w.c = Some(c);
    r
}

async fn f2_on(w: &mut World, c: &mut Dev) -> R {
    let st = c.call("join", json!({ "invite": w.invite_c })).await?;
    w.report.check(st["space"]["team_id"] == json!(w.team), format!("C joined through the relay: {}", short(&st["space"])));
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    wait_right(c, &id, "start", true, 30).await;
    let rev0 = rev_of(w, &id).await?;
    let l = c.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    fill_idb(&ws, &base, 8, 0).await?;
    w.set_in_browser(&ws, &base, "f2", "c-work").await?;
    let relay = w.relay.as_ref().unwrap();
    relay.cut_after(4 * MB, Duration::from_secs(20));
    let copy = w.copy_dir(c, &id);
    let t0 = Instant::now();
    // While the link is down: no half session on the server, the lease still C's, the copy kept.
    let during = async {
        tokio::time::sleep(Duration::from_secs(10)).await;
        (w.row(&id).await, copy.exists())
    };
    let (stop, (row_during, copy_during)) = tokio::join!(c.call("stop", json!({ "id": id, "secs": 180 })), during);
    let stop = stop?;
    let out = outcomes(&stop["events"]);
    w.report.note(format!("C's close with the link cut 4 MB into the upload: {out:?} after {:?}; relay: {:?}", t0.elapsed(), w.relay.as_ref().unwrap().st.log.lock().unwrap()));
    let row_during = row_during?;
    w.report.check(
        row_during["session_rev"].as_u64() == Some(rev0) && row_during["open_on"]["device_name"] == json!("Device C") && copy_during,
        format!("while the link was down: session_rev {rev0} -> {}, open_on={}, C's copy kept={copy_during}", row_during["session_rev"], row_during["open_on"]["device_name"]),
    );
    let row = w.row(&id).await?;
    w.report.check(out == vec!["saved"] && row["session_rev"].as_u64() == Some(rev0 + 1), format!("sent again once the link was back: {out:?}, session_rev {rev0} -> {}", row["session_rev"]));
    w.report.check(row["open_on"].is_null() && !copy.exists(), format!("lease given back ({}), copy wiped ({})", row["open_on"], copy.exists()));
    tokio::time::sleep(Duration::from_secs(3)).await;
    let orphans = orphan_bodies(w);
    w.report.check(orphans.starts_with("orphan bodies=0 orphan chunks=0"), format!("nothing half-written left on the server: {orphans}"));
    let warn = log_lines(w, "c", &["WARNING", "not sent", "lease not given back"]);
    w.report.note(format!("C's log: {warn:?}"));
    // How long the others are kept out.
    let t0 = Instant::now();
    let mut first_refusal = None;
    let mut started = None;
    while t0.elapsed() < Duration::from_secs(130) {
        match w.b.call("launch", json!({ "id": id })).await {
            Ok(l) => {
                started = Some((t0.elapsed(), l));
                break;
            }
            Err(e) => {
                first_refusal.get_or_insert(e);
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    w.report.note(format!("B's start: first refused \"{}\", started after {:?}", first_refusal.clone().unwrap_or_default(), started.as_ref().map(|s| s.0)));
    w.report.check(started.as_ref().is_some_and(|s| s.0 < Duration::from_secs(10)), "B can open it right after C's close went through");
    if let Some((_, l)) = started {
        let ws = ws_of(&l)?;
        let (ls, _) = look(w, &ws).await?;
        w.report.check(ls["ls_f2"] == json!("c-work"), format!("C's work survived the cut link: ls_f2={}", ls["ls_f2"]));
        w.b.call("stop", json!({ "id": id })).await?;
    }
    Ok(())
}

/// F10: a slow uplink (1 MB/s) and a ~160 MB session: C killed, then C quit.
async fn f10(w: &mut World) -> R {
    let mut c = w.c.take().ok_or("harness: no device C")?;
    let r = f10_on(w, &mut c).await;
    match r {
        Ok(Some(c)) => {
            w.c = Some(c);
            Ok(())
        }
        Ok(None) => Ok(()),
        Err(e) => {
            w.c = Some(c);
            Err(e)
        }
    }
}

async fn f10_on(w: &mut World, c: &mut Dev) -> R<Option<Dev>> {
    let id = w.p2.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    wait_right(c, &id, "start", true, 30).await;
    w.relay.as_ref().unwrap().throttle(MB);
    // (a) kill -9
    let l = c.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let browser = l["pid"].as_u64().unwrap_or(0) as u32;
    fill_idb(&ws, &base, 40, 100).await?;
    w.set_in_browser(&ws, &base, "f10a", "crash").await?;
    let rev0 = rev_of(w, &id).await?;
    let copy = w.copy_dir(c, &id);
    tokio::time::sleep(Duration::from_secs(2)).await;
    let pid = c.pid;
    unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
    let t0 = Instant::now();
    let mut gone = None;
    while t0.elapsed() < Duration::from_secs(40) {
        if gone.is_none() && !World::pids_alive(browser) {
            gone = Some(t0.elapsed());
        }
        let reaped = std::process::Command::new("pgrep").args(["-f", "--", "--reap"]).output().map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty()).unwrap_or(false);
        if gone.is_some() && t0.elapsed() > Duration::from_secs(22) && !reaped {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let row = w.row(&id).await?;
    let reaper = log_lines(w, "c", &["[reaper]"]);
    w.report.note(format!("(a) kill -9 of C (1 MB/s up, ~160 MB): browser gone {gone:?}; reaper: {:?}; session_rev {}", reaper.last(), row["session_rev"]));
    let kept = copy.join("open.json").exists();
    w.report.check(gone.is_some() && (kept || row["session_rev"].as_u64() == Some(rev0 + 1)), format!("(a) the reaper closed the browser and kept the copy it could not send in 20 s: kept={kept}"));
    // C's launcher again: its start sends what the reaper kept.
    let (engine, fp, logs) = (w.engine.clone(), w.fp.clone(), w.logs.clone());
    let how = harness::Spawn { engine: &engine, fp: &fp, logs: &logs };
    let mut c2 = Dev::spawn("Device C", "c", w.out.join("devices/c"), &how).await?;
    let t0 = Instant::now();
    let mut sent = None;
    while t0.elapsed() < Duration::from_secs(400) {
        let row = w.row(&id).await?;
        if row["session_rev"].as_u64() == Some(rev0 + 1) && row["open_on"].is_null() && !copy.exists() {
            sent = Some(t0.elapsed());
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    w.report.check(sent.is_some(), format!("(a) C's next start sent it over 1 MB/s, gave the lease back and wiped the copy: {sent:?}"));
    wait_right(&mut c2, &id, "start", true, 60).await;
    let l = c2.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let have = read_idb(&ws, &base).await?;
    let (ls, _) = look(w, &ws).await?;
    w.report.check(ls["ls_f10a"] == json!("crash"), format!("(a) the work done before the kill is there: ls_f10a={} IDB {have}", ls["ls_f10a"]));
    fill_idb(&ws, &base, 40, 200).await?;
    w.set_in_browser(&ws, &base, "f10b", "quit").await?;
    let rev1 = rev_of(w, &id).await?;
    w.report.note(format!("(b) C opened it again (IDB {have}), wrote 160 MB more, quits"));
    let t0 = Instant::now();
    c2.exit().await;
    let took = t0.elapsed();
    let row = w.row(&id).await?;
    let lines = log_lines(w, "c", &["not saved in time", "session packed", "WARNING"]);
    w.report.note(format!("(b) quit took {took:?}; C's log: {:?}", lines.iter().rev().take(3).collect::<Vec<_>>()));
    w.report.check(row["session_rev"].as_u64() == Some(rev1 + 1), format!("(b) the quit saved it: session_rev {rev1} -> {}", row["session_rev"]));
    w.relay.as_ref().unwrap().throttle(0);
    settle(w, &[id.clone()]).await;
    Ok(None)
}

/// F8c: a removed member's token, by IP.
async fn f8c(w: &mut World) -> R {
    let mc = w.member_c.clone();
    if let Some(c) = w.c.take() {
        c.exit().await;
    }
    w.admin.call("admin_member_delete", json!({ "member": mc })).await?;
    let tok = w.token_c.clone();
    let (st, v) = raw(w, Method::GET, "/permission", &tok, "raw", None).await;
    w.report.check(st == 401, format!("a removed member's token: GET /permission {st} {v}"));
    let mut e = w.e.take().ok_or("harness: no device E")?;
    let direct = format!("{}#{}", w.server.url(), tok);
    let r = e.call("join", json!({ "invite": direct })).await;
    w.e = Some(e);
    w.report.check(r.as_ref().is_err_and(|t| t == "the server does not know this token"), format!("joining with it: {r:?}"));
    Ok(())
}

/// F8b: B's token re-issued while B has P open; B pastes the new invite.
async fn f8b(w: &mut World) -> R {
    let id = w.p.clone();
    settle(w, &[id.clone()]).await;
    let base = w.site_url("");
    let mb = w.member_b.clone();
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "f8", "replaced").await?;
    w.report.note("B set f8 and keeps the browser 35 s (past the cookie store's commit)");
    tokio::time::sleep(Duration::from_secs(35)).await;
    let rev0 = rev_of(w, &id).await?;
    let since = w.b.call("now", json!({})).await?.as_u64().unwrap_or(0);
    let old = std::fs::read_to_string(w.b.root.join("config/local/teams.json")).unwrap_or_default();
    let old_token = serde_json::from_str::<Value>(&old).ok().and_then(|v| v["tokens"][&w.team].as_str().map(String::from)).unwrap_or_default();
    let re = w.admin.call("admin_member_reissue", json!({ "member": mb })).await?;
    let invite = re["invite"].as_str().unwrap_or_default().to_string();
    let c = w.b.call("wait_closed", json!({ "id": id, "since": since, "secs": 60 })).await;
    let out = c.as_ref().map(|c| outcomes(&c["events"])).unwrap_or_default();
    w.report.check(out == vec!["kept"], format!("B closed it on the re-issue, kept for the new invite: {out:?} ({})", c.as_ref().map(|c| c["closed_ms"].to_string()).unwrap_or_else(|e| e.clone())));
    let copy = w.copy_dir(&w.b, &id);
    w.report.check(copy.join("udd").is_dir(), format!("the copy waits on disk: {}", copy.display()));
    let st = w.b.call("state", json!({})).await?;
    let link = st["space"]["teams"].as_array().and_then(|t| t.first()).cloned().unwrap_or_default();
    w.report.check(link["needs_invite"] == json!(true) && st["space"]["space"]["kind"] == json!("personal"), format!("B waits for the new invite: needs_invite={} space={}", link["needs_invite"], st["space"]["space"]));
    if !old_token.is_empty() {
        let (s, v) = raw(w, Method::GET, "/permission", &old_token, "raw", None).await;
        w.report.check(s == 401 && v["code"] == json!("token_replaced"), format!("the old token by IP: {s} {v}"));
    } else {
        w.report.note("B's old token not read from its teams.json");
    }
    let row = w.row(&id).await?;
    w.report.note(format!("server meanwhile: open_on={} session_rev={}", row["open_on"]["device_name"], row["session_rev"]));
    let ra = w.a().call("launch", json!({ "id": id })).await;
    w.report.note(format!("A's start meanwhile: {}", match &ra { Ok(_) => "started".into(), Err(e) => e.clone() }));
    if ra.is_ok() {
        w.a().call("stop", json!({ "id": id })).await?;
    }
    let t0 = Instant::now();
    w.b.call("join", json!({ "invite": invite })).await?;
    let mut sent = None;
    while t0.elapsed() < Duration::from_secs(60) {
        let row = w.row(&id).await?;
        if row["session_rev"].as_u64() == Some(rev0 + 1) && row["open_on"].is_null() && !copy.exists() {
            sent = Some(t0.elapsed());
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    w.report.check(sent.is_some(), format!("the kept copy went up after the new invite: {sent:?} (session_rev now {})", w.row(&id).await?["session_rev"]));
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let (ls, cookies) = look(w, &ws).await?;
    w.a().call("stop", json!({ "id": id })).await?;
    w.report.check(ls["ls_f8"] == json!("replaced") && cookies.contains(&"srv_f8=replaced".to_string()), format!("A sees B's last session: ls_f8={} cookies={cookies:?}", ls["ls_f8"]));
    wait_right(&mut w.b, &id, "start", true, 30).await;
    Ok(())
}

/// F8d: A syncs its own space with its member token; the admin re-issues it; A pastes the new invite.
async fn f8d(w: &mut World) -> R {
    let team = w.team.clone();
    let ma = w.member_a.clone();
    w.a().call("switch", json!({ "team": "" })).await?;
    let c = w.a().call("sync_connect", json!({ "team": team })).await?;
    let st = w.a().call("sync_now", json!({})).await?;
    w.report.note(format!("A's sync: {} ; {}", short(&c["connection"]), short(&st["status"])));
    let re = w.admin.call("admin_member_reissue", json!({ "member": ma })).await?;
    let invite = re["invite"].as_str().unwrap_or_default().to_string();
    w.token_a = split_invite(&invite).map(|(_, t)| t).unwrap_or_default();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let r = w.a().call("sync_now", json!({})).await;
    w.report.note(format!("A's sync after the re-issue: {}", match &r { Ok(v) => short(&v["status"]), Err(e) => e.clone() }));
    w.a().call("join", json!({ "invite": invite })).await?;
    w.a().call("switch", json!({ "team": "" })).await?;
    let r = w.a().call("sync_now", json!({})).await;
    let state = w.a().call("sync_state", json!({})).await?;
    w.report.check(
        r.is_ok() && state["status"]["error"].is_null(),
        format!("after A pasted the new team invite, its sync works again: {} ; status {}", match &r { Ok(_) => "ok".into(), Err(e) => e.clone() }, short(&state["status"])),
    );
    let _ = w.a().call("sync_disconnect", json!({ "remove": false })).await;
    let c = w.a().call("sync_connect", json!({ "team": team })).await;
    let r = w.a().call("sync_now", json!({})).await;
    w.report.note(format!("disconnect + connect again: {} ; {}", match &c { Ok(_) => "connected".into(), Err(e) => e.clone() }, match &r { Ok(v) => short(&v["status"]), Err(e) => e.clone() }));
    let _ = w.a().call("sync_disconnect", json!({ "remove": false })).await;
    w.a().call("switch", json!({ "team": team })).await?;
    Ok(())
}

/// F6: clock skew. D's wall clock behind 1 h, ahead 850 s, ahead 1000 s; then the server's jumps 100 s.
async fn f6(w: &mut World) -> R {
    let Some(lib) = w.skew_lib.clone() else {
        w.report.check(false, "no SHARDX_LIVE_SKEW shim: clock cases not run");
        return Ok(());
    };
    let m = w.admin.call("admin_member_create", json!({ "name": "Member D" })).await?;
    w.member_d = m["member"]["id"].as_str().unwrap_or_default().into();
    let inv = m["invite"].as_str().unwrap_or_default().to_string();
    let md = w.member_d.clone();
    set_grants(w, &md, b_grants()).await?;
    let (engine, fp, logs) = (w.engine.clone(), w.fp.clone(), w.logs.clone());
    let how = harness::Spawn { engine: &engine, fp: &fp, logs: &logs };
    let env = vec![
        ("DYLD_INSERT_LIBRARIES".to_string(), lib.display().to_string()),
        ("SHARDX_SKEW_FILE".to_string(), w.d_skew.display().to_string()),
    ];
    let mut d = Dev::spawn_env("Device D", "d", w.out.join("devices/d"), &how, &env).await?;
    d.call("join", json!({ "invite": inv })).await?;
    let r = f6_on(w, &mut d).await;
    w.d = Some(d);
    r
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

async fn skew(path: &Path, secs: i64) {
    std::fs::write(path, secs.to_string()).unwrap();
    tokio::time::sleep(Duration::from_millis(600)).await;
}

async fn f6_on(w: &mut World, d: &mut Dev) -> R {
    let id = w.p.clone();
    let base = w.site_url("");
    let md = w.member_d.clone();
    settle(w, &[id.clone()]).await;
    wait_right(d, &id, "start", true, 30).await;
    // (a) behind by an hour
    skew(&w.d_skew, -3600).await;
    let wall = d.call("wall", json!({})).await?.as_u64().unwrap_or(0) as i64;
    w.report.note(format!("D's wall clock is {} s off", wall - now_secs() as i64));
    let rev0 = rev_of(w, &id).await?;
    let r = d.call("launch", json!({ "id": id })).await;
    match r {
        Ok(l) => {
            let ws = ws_of(&l)?;
            w.set_in_browser(&ws, &base, "d1", "behind").await?;
            let stop = d.call("stop", json!({ "id": id })).await?;
            let rev = rev_of(w, &id).await?;
            w.report.check(outcomes(&stop["events"]) == vec!["saved"] && rev == rev0 + 1, format!("(a) 1 h behind: starts and saves ({:?}, session_rev {rev0} -> {rev})", outcomes(&stop["events"])));
        }
        Err(e) => {
            w.report.check(false, format!("(a) 1 h behind: start refused \"{e}\""));
        }
    }
    // (b) ahead by 850 s: inside the 15 min permission, by more than 10 min
    skew(&w.d_skew, 850).await;
    set_grants(w, &md, grant(folder_scope("Shop"), &["see", "start", "cookies", "edit"])).await?;
    let got = wait_right(d, &id, "edit", true, 30).await;
    let t_perm = Instant::now();
    w.report.note(format!("(b) 850 s ahead: a fresh permission taken after {got:?}"));
    let l = d.call("launch", json!({ "id": id })).await;
    match &l {
        Ok(l) => {
            let ws = ws_of(l)?;
            w.set_in_browser(&ws, &base, "d2", "ahead").await?;
            let since = d.call("now", json!({})).await?.as_u64().unwrap_or(0);
            let c = d.call("wait_closed", json!({ "id": id, "since": since, "secs": 150 })).await;
            match &c {
                Ok(v) => w.report.check(false, format!("(b) D's open profile was closed by the launcher {:?} after the permission came ({:?})", t_perm.elapsed(), outcomes(&v["events"]))),
                Err(_) => w.report.check(true, "(b) D's open profile stays open for 150 s"),
            };
            let lines = log_lines(w, "d", &["WARNING", "permission", "clock"]);
            w.report.note(format!("D's log: {:?}", lines.iter().rev().take(4).collect::<Vec<_>>()));
            let again = d.call("launch", json!({ "id": id })).await;
            w.report.note(format!("D's start {:?} after the permission came: {}", t_perm.elapsed(), match &again { Ok(_) => "started".into(), Err(e) => e.clone() }));
            if again.is_ok() || c.is_err() {
                d.call("stop", json!({ "id": id })).await.ok();
            }
            let mut back = None;
            while t_perm.elapsed() < Duration::from_secs(330) {
                if World::rights_of(d, &id).await?["start"] == json!(true) && t_perm.elapsed() > Duration::from_secs(60) {
                    back = Some(t_perm.elapsed());
                    break;
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            let rights = World::rights_of(d, &id).await?;
            w.report.note(format!("(b) D's rights {:?} after the permission came: {rights}; Start back at {back:?}", t_perm.elapsed()));
        }
        Err(e) => {
            w.report.check(false, format!("(b) 850 s ahead: start refused \"{e}\""));
        }
    }
    settle(w, &[id.clone()]).await;
    // (c) ahead by 1000 s: past the whole permission
    skew(&w.d_skew, 1000).await;
    set_grants(w, &md, b_grants()).await?;
    tokio::time::sleep(Duration::from_secs(8)).await;
    let r = d.call("launch", json!({ "id": id })).await;
    let lines = log_lines(w, "d", &["clock", "permission"]);
    w.report.note(format!("(c) 1000 s ahead: start {}; D's log {:?}", match &r { Ok(_) => "started".into(), Err(e) => format!("refused \"{e}\"") }, lines.last()));
    w.report.check(r.as_ref().is_err_and(|e| e.contains("clock")), "(c) a start refused for a clock too far ahead says so");
    if r.is_ok() {
        d.call("stop", json!({ "id": id })).await.ok();
    }
    skew(&w.d_skew, 0).await;
    set_grants(w, &md, grant(folder_scope("Shop"), &["see", "start", "cookies", "edit"])).await?;
    let back = wait_right(d, &id, "start", true, 90).await;
    w.report.note(format!("clock right again: D's Start back after {back:?}"));
    // (d) the server's wall clock jumps 100 s while A has P open
    settle(w, &[id.clone()]).await;
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    w.set_in_browser(&ws, &base, "j1", "a-work").await?;
    let since_a = w.a().call("now", json!({})).await?.as_u64().unwrap_or(0);
    skew(&w.server_skew, 100).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let row = w.row(&id).await?;
    w.report.note(format!("(d) server clock +100 s: open_on={}", row["open_on"]["device_name"]));
    let rb = w.b.call("launch", json!({ "id": id })).await;
    w.report.check(rb.is_err(), format!("(d) B cannot take the profile A has open when the server's clock jumps: {}", match &rb { Ok(_) => "B STARTED it".into(), Err(e) => format!("refused \"{e}\"") }));
    if let Ok(l) = &rb {
        let c = w.a().call("wait_closed", json!({ "id": id, "since": since_a, "secs": 45 })).await;
        w.report.note(format!("(d) A's side: {}", match &c { Ok(v) => format!("closed, outcome {:?}", outcomes(&v["events"])), Err(e) => e.clone() }));
        let ws = ws_of(l)?;
        let (ls, _) = look(w, &ws).await?;
        w.report.note(format!("(d) B's copy has A's j1: {}", ls["ls_j1"]));
        w.b.call("stop", json!({ "id": id })).await.ok();
    }
    settle(w, &[id.clone()]).await;
    Ok(())
}


/// The entries under a copy's `Default/IndexedDB`, with their sizes.
fn idb_listing(udd: &Path) -> Vec<String> {
    fn size(p: &Path) -> u64 {
        match std::fs::metadata(p) {
            Ok(m) if m.is_dir() => std::fs::read_dir(p).map(|d| d.flatten().map(|e| size(&e.path())).sum()).unwrap_or(0),
            Ok(m) => m.len(),
            Err(_) => 0,
        }
    }
    let dir = udd.join("Default/IndexedDB");
    let mut v: Vec<String> = std::fs::read_dir(&dir)
        .map(|d| d.flatten().map(|e| format!("{} ({} KB)", e.file_name().to_string_lossy(), size(&e.path()) / 1024)).collect())
        .unwrap_or_default();
    v.sort();
    v
}

/// F7b: a session past 256 MB: what of the site's IndexedDB the other device gets.
async fn f7b(w: &mut World) -> R {
    let base = w.site_url("");
    let p = w.a().call("create_profile", json!({ "name": "Over budget", "folder": "Shop" })).await?;
    let id = p["id"].as_str().unwrap_or_default().to_string();
    let l = w.a().call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    fill_idb(&ws, &base, 65, 0).await?;
    w.set_in_browser(&ws, &base, "over", "1").await?;
    let on_a = read_idb(&ws, &base).await?;
    let a_copy = w.copy_dir(w.a.as_ref().unwrap(), &id).join("udd");
    tokio::time::sleep(Duration::from_secs(2)).await;
    w.report.note(format!("A: IDB {on_a}; A's copy Default/IndexedDB: {:?}", idb_listing(&a_copy)));
    let warn0 = log_lines(w, "a", &["256 MB"]).len();
    let stop = w.a().call("stop", json!({ "id": id, "secs": 900 })).await?;
    let row = w.row(&id).await?;
    let warn = log_lines(w, "a", &["256 MB"]);
    w.report.note(format!("A's close: {:?}; session {} KB; {:?}", outcomes(&stop["events"]), row["session_size"].as_u64().unwrap_or(0) / 1024, &warn[warn0.min(warn.len())..]));
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let b_copy = w.copy_dir(&w.b, &id).join("udd");
    let listing = idb_listing(&b_copy);
    let on_b = read_idb(&ws, &base).await?;
    let (ls, _) = look(w, &ws).await?;
    w.b.call("stop", json!({ "id": id })).await?;
    w.report.note(format!("B's copy Default/IndexedDB: {listing:?}; IDB on B {on_b}; ls_over={}", ls["ls_over"]));
    let clean = on_b["error"].is_null() && (on_b["n"] == json!(0) || on_b["bytes"].as_u64() == Some(260 * MB));
    w.report.check(clean, "the left-out site storage is either all there or cleanly absent on B (no records pointing at missing blob files)");
    // The server's own limit, raw: 256 MB + 1 byte, declared and chunked.
    let cur = rev_of(w, &id).await?;
    let tok = w.token_a.clone();
    let (st, v) = raw(w, Method::POST, &format!("/profiles/{id}/lease"), &tok, "raw-dev", None).await;
    w.report.note(format!("raw lease: {st} {}", short(&v)));
    let declared = raw_declared_put(w, &format!("/profiles/{id}/session?base_session_rev={cur}"), &tok, "raw-dev", 256 * MB + 1).await;
    w.report.check(declared.contains(" 413 "), format!("PUT declaring 256 MB + 1, refused before the body: {declared}"));
    let chunked = raw_chunked_put(w, &format!("/profiles/{id}/session?base_session_rev={cur}"), &tok, "raw-dev", 256 * MB + MB).await;
    w.report.check(chunked.contains(" 413 "), format!("PUT 257 MB chunked: {chunked}"));
    let exact = vec![2u8; 256 * MB as usize];
    let (st, v) = raw(w, Method::PUT, &format!("/profiles/{id}/session?base_session_rev={cur}"), &tok, "raw-dev", Some(exact)).await;
    w.report.note(format!("PUT exactly 256 MB: {st} {}", short(&v)));
    let (st, _) = raw(w, Method::DELETE, &format!("/profiles/{id}/lease"), &tok, "raw-dev", None).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    w.report.check(orphan_bodies(w).starts_with("orphan bodies=0"), format!("after the refused uploads: lease given back {st}; {}", orphan_bodies(w)));
    Ok(())
}

/// FQ: a slow uplink (1 MB/s): a launcher quits with a ~160 MB session open.
async fn fq(w: &mut World) -> R {
    if w.relay.is_none() {
        w.relay = Some(Relay::start(w.server.port).await);
    }
    let m = w.admin.call("admin_member_create", json!({ "name": "Member Q" })).await?;
    let mq = m["member"]["id"].as_str().unwrap_or_default().to_string();
    let inv = m["invite"].as_str().unwrap_or_default().to_string();
    let tok = split_invite(&inv).map(|(_, t)| t).unwrap_or_default();
    set_grants(w, &mq, b_grants()).await?;
    let (engine, fp, logs) = (w.engine.clone(), w.fp.clone(), w.logs.clone());
    let how = harness::Spawn { engine: &engine, fp: &fp, logs: &logs };
    let mut q = Dev::spawn("Device Q", "q", w.out.join("devices/q"), &how).await?;
    let relay_url = w.relay.as_ref().unwrap().url();
    q.call("join", json!({ "invite": format!("{relay_url}#{tok}") })).await?;
    let p = w.a().call("create_profile", json!({ "name": "Slow link", "folder": "Shop" })).await?;
    let id = p["id"].as_str().unwrap_or_default().to_string();
    let base = w.site_url("");
    wait_right(&mut q, &id, "start", true, 30).await;
    let l = q.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    fill_idb(&ws, &base, 40, 0).await?;
    w.set_in_browser(&ws, &base, "fq", "quit").await?;
    let rev0 = rev_of(w, &id).await?;
    w.relay.as_ref().unwrap().throttle(MB);
    let t0 = Instant::now();
    q.exit().await;
    let took = t0.elapsed();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let row = w.row(&id).await?;
    let lines = log_lines(w, "q", &["not saved in time", "session packed", "WARNING"]);
    w.report.note(format!("Q quit with ~160 MB open over 1 MB/s: took {took:?}; Q's log: {lines:?}; open_on now {}", row["open_on"]["device_name"]));
    let copy = w.out.join("devices/q/data/team-open").join(&w.team).join(&id);
    let saved = row["session_rev"].as_u64() == Some(rev0 + 1);
    let kept = copy.join("open.json").exists();
    w.report.check(saved || kept, format!("the quit saved it or kept the copy for the next start: session_rev {rev0} -> {}, copy kept={kept}", row["session_rev"]));
    if kept {
        let mut q = Dev::spawn("Device Q", "q", w.out.join("devices/q"), &how).await?;
        let t0 = Instant::now();
        let mut sent = None;
        while t0.elapsed() < Duration::from_secs(400) {
            let row = w.row(&id).await?;
            if row["session_rev"].as_u64() == Some(rev0 + 1) && row["open_on"].is_null() && !copy.exists() {
                sent = Some(t0.elapsed());
                break;
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        w.report.check(sent.is_some(), format!("Q's next start sent the kept copy over 1 MB/s: {sent:?}"));
        let _ = q.call("state", json!({})).await;
        q.exit().await;
    }
    w.relay.as_ref().unwrap().throttle(0);
    wait_right(&mut w.b, &id, "start", true, 30).await;
    let l = w.b.call("launch", json!({ "id": id })).await?;
    let ws = ws_of(&l)?;
    let on_b = read_idb(&ws, &base).await?;
    let (ls, _) = look(w, &ws).await?;
    w.b.call("stop", json!({ "id": id, "secs": 600 })).await?;
    w.report.check(ls["ls_fq"] == json!("quit") && on_b["bytes"].as_u64() == Some(160 * MB) && on_b["error"].is_null(), format!("B gets Q's work whole: ls_fq={} IDB {on_b}", ls["ls_fq"]));
    Ok(())
}

pub(super) async fn run_failures(w: &mut World) {
    let mut w = w;
    let only = std::env::var("SHARDX_LIVE_ONLY").unwrap_or_default();
    let want = |id: &str| only.is_empty() || only.split(',').any(|o| o == id);
    scenario!(w, "T1", "server up; admin joins; two member invites; A and B join (http by IP)", t1);
    scenario!(w, "T2", "grants: A team-wide, B See/Start/Cookies on Shop", t2);
    scenario!(w, "T3", "A creates P in Shop, opens, sets cookie + localStorage, closes", t3);
    if want("F9") { scenario!(w, "F9", "a personal profile started twice at once (device E)", f9); }
    if want("F8a") { scenario!(w, "F8a", "http by IP: a wrong member token, a forged admin token, a dead address", f8a); }
    if want("F3") { scenario!(w, "F3", "two quick starts of a team profile on B", f3); }
    if want("F4") { scenario!(w, "F4", "Start taken from B while open, and racing B's own close", f4); }
    if want("F5") { scenario!(w, "F5", "A deletes P while B has it open; after B closes; restore from the team's trash", f5); }
    if want("F1") { scenario!(w, "F1", "server restart (down 40 s) while A has P open: lease, renewal, live channel", f1); }
    if want("F1b") { scenario!(w, "F1b", "server down 100 s (past the 90 s lease) while A has P open", f1b); }
    if want("F7") { scenario!(w, "F7", "a ~232 MB session, one past 256 MB, and the server's own 256 MB limit", f7); }
    if want("F7b") { scenario!(w, "F7b", "a ~260 MB session: what the other device gets of the site's IndexedDB; the server's 256 MB limit raw", f7b); }
    if want("FQ") { scenario!(w, "FQ", "a slow uplink (1 MB/s): the launcher quits with a ~160 MB session open", fq); }
    if want("F2") { scenario!(w, "F2", "the link cut 4 MB into a session upload (device C via a relay)", f2); }
    if want("F10") && w.c.is_some() { scenario!(w, "F10", "a slow uplink (1 MB/s) and a ~160 MB session: kill -9, then quit", f10); }
    if want("F8c") && !w.member_c.is_empty() { scenario!(w, "F8c", "a removed member's token by IP", f8c); }
    if want("F8b") { scenario!(w, "F8b", "B's token re-issued while P is open; B pastes the new invite", f8b); }
    if want("F8d") { scenario!(w, "F8d", "A's personal sync after A's member token is re-issued and the new invite pasted", f8d); }
    if want("F6") { scenario!(w, "F6", "clock skew: device 1 h behind, 850 s ahead, 1000 s ahead; the server's clock jumps 100 s", f6); }
    let _ = e2s("");
}
