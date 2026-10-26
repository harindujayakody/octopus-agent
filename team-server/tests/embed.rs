//! The server as a launcher test runs it: in-process, on a free port, reached
//! at plain `http://` and then switched to the team's own TLS, as a launcher does.

use shardbrowser_team_server::{Action, Grant, Scope, TestServer};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Connect, ask for the switch, shake hands with the key the server shows.
async fn wire(url: &str, key: &str) -> tokio_rustls::client::TlsStream<tokio::net::TcpStream> {
    let host = url.strip_prefix("http://").unwrap();
    let mut s = tokio::net::TcpStream::connect(host).await.unwrap();
    let ask = format!(
        "GET {} HTTP/1.1\r\nHost: {host}\r\nConnection: Upgrade\r\nUpgrade: {}\r\n\r\n",
        team_wire::PATH,
        team_wire::UPGRADE
    );
    s.write_all(ask.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        let mut b = [0u8; 1];
        assert_eq!(s.read(&mut b).await.unwrap(), 1, "closed during the switch");
        head.push(b[0]);
    }
    assert!(head.starts_with(b"HTTP/1.1 101"), "{}", String::from_utf8_lossy(&head));
    let pin = team_wire::Pin::to(team_wire::key_from_text(key).expect("the team's key"));
    let name = tokio_rustls::rustls::pki_types::ServerName::try_from("127.0.0.1").unwrap();
    tokio_rustls::TlsConnector::from(team_wire::client_config(pin)).connect(name, s).await.unwrap()
}

/// One request on its own connection inside the wire: status and body.
async fn http(url: &str, key: &str, method: &str, path: &str, token: &str, body: &str) -> (u16, String) {
    let host = url.strip_prefix("http://").unwrap();
    let mut s = wire(url, key).await;
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    if !token.is_empty() {
        req += &format!("Authorization: Bearer {token}\r\n");
    }
    req += &format!("Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    s.write_all(req.as_bytes()).await.unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw).await.unwrap();
    let (head, body) = raw.split_once("\r\n\r\n").unwrap();
    (head[9..12].parse().unwrap(), body.to_owned())
}

#[tokio::test]
async fn a_test_can_run_a_server_and_reach_it_over_plain_http() {
    let dir = std::env::temp_dir().join(format!("shardx-embed-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    let srv = TestServer::start(&dir).await.unwrap();
    assert!(srv.url.starts_with("http://127.0.0.1:"), "{}", srv.url);
    let key = srv.server.public_key();
    assert_eq!(http(&srv.url, &key, "GET", "/health", "", "").await.0, 200);

    let see = Grant { scope: Scope::Team, action: Action::See, allow: true };
    let vera = srv.add_member("Vera", &[see]).unwrap();
    let (code, me) = http(&srv.url, &key, "GET", "/me", &vera.token, "").await;
    assert_eq!(code, 200, "{me}");
    assert!(me.contains(srv.server.team_id()) && me.contains(&key), "{me}");
    let (code, p) = http(&srv.url, &key, "GET", "/permission", &vera.token, "").await;
    assert!(code == 200 && p.contains("\"permission\""), "{code} {p}");
    let (code, _) = http(&srv.url, &key, "POST", "/admin/folders", &srv.admin_token, r#"{"name":"Ads"}"#).await;
    assert_eq!(code, 201);

    // The data directory is the server: started again on it, it is the same
    // team, and the key launchers hold it to is the same one.
    let team = srv.server.team_id().to_owned();
    drop(srv);
    let again = TestServer::start(&dir).await.unwrap();
    assert_eq!(again.server.team_id(), team);
    assert_eq!(again.server.public_key(), key);
    assert_eq!(http(&again.url, &key, "GET", "/me", &vera.token, "").await.0, 200);
    drop(again);
    let _ = std::fs::remove_dir_all(&dir);
}
