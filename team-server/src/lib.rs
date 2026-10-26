//! Octopus Agent team server — self-hosted.
//!
//! One team per server. The admin binds a launcher to it with the admin JWT,
//! creates member tokens and says what each member may do; members work in the
//! team's own space, which starts empty and holds only what has been moved or
//! made in it.
//!
//! The server decides who sees what on its own, at once, whoever else is
//! online — so it holds the keys. Profiles, proxies, sessions and items are
//! sealed at rest with the server's key, kept in `server.key` beside the
//! database and readable only by the account the server runs as: a copy of the
//! database alone opens nothing. Whoever runs the server can read the team's
//! data; that is the owner, on their own machine.
//!
//! The binary reads its [`Config`] from the environment; a test embeds one
//! with [`TestServer`].

mod api;
mod auth;
mod live;
mod model;
mod store;
mod vault;
mod view;

use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use axum::body::Body;
use axum::http::{header, HeaderMap, HeaderValue, Method, Request, Response, StatusCode};
use axum::Router;
use hyper::server::conn::http1;
use hyper::upgrade::OnUpgrade;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::service::TowerToHyperService;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, watch, Semaphore};
use tokio::task::JoinSet;
use tokio_rustls::TlsAcceptor;

pub use team_model::{Action, Grant, Scope};

/// Days a deleted team item waits in the trash unless told otherwise.
pub const DEFAULT_TRASH_DAYS: u64 = 30;
/// How often the trash is checked for what has run out of days.
const TRASH_SWEEP_EVERY: Duration = Duration::from_secs(60 * 60);
/// How often leases that ran out are told: how late a list may say a crashed launcher still has a profile open.
const LEASE_REAP_EVERY: Duration = Duration::from_secs(10);

/// The admin token is printed once and kept nowhere, so a short life would
/// lock the owner out of their own server.
const ADMIN_BOOTSTRAP_TTL_SECS: u64 = 365 * 24 * 60 * 60;

const META_ADMIN_SECRET: &str = "admin_secret";
const META_SIGNING_KEY: &str = "permission_key_pem";
const META_TEAM_ID: &str = "team_id";

/// How long a request head may take, idle keep-alive included; then the
/// connection is closed, so nobody holds a socket by sending nothing.
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// Connections served at once; past it new ones wait in the kernel's queue.
const MAX_CONNECTIONS: usize = 256;

/// Where a server keeps its data, and how it starts.
#[derive(Debug, Clone)]
pub struct Config {
    /// Holds `team.sqlite` and `server.key`, made owner-only when missing.
    /// Back up both, together: the database without its key is unreadable.
    pub data_dir: PathBuf,
    /// The team's name, read on the first run only; None or blank is "Team".
    pub team_name: Option<String>,
    /// Days a deleted team item waits in the trash before it is purged.
    pub trash_days: u64,
    /// Where launchers reach the server, for the invite the first run prints;
    /// None prints the admin token alone.
    pub url: Option<PublicUrl>,
}

impl Config {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Config { data_dir: data_dir.into(), team_name: None, trash_days: DEFAULT_TRASH_DAYS, url: None }
    }
}

/// The server's address as an invite starts with it: `<url>#<token>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicUrl {
    /// `http://host:port`, or what the owner gave; no trailing slash.
    pub url: String,
    /// The host in it when only this machine knows it by that (127.0.0.1,
    /// 0.0.0.0): the line under the invite says to put the real address there.
    pub stand_in: Option<String>,
    /// Given by the owner: member invites the launcher makes start with it too.
    pub given: bool,
}

impl PublicUrl {
    /// `public` when given (`SHARDBROWSER_TEAM_PUBLIC_URL`), else plain http to `bind`.
    pub fn new(public: Option<&str>, bind: &str) -> Result<PublicUrl> {
        if let Some(p) = public.map(str::trim).filter(|p| !p.is_empty()) {
            if p.contains(|c: char| c == '#' || c.is_whitespace()) {
                bail!("a public URL has no '#' and no spaces in it: {p:?}");
            }
            let p = p.trim_end_matches('/');
            let url = if p.contains("://") { p.to_owned() } else { format!("http://{p}") };
            return Ok(PublicUrl { url, stand_in: None, given: true });
        }
        let bind = bind.trim();
        let host = bind.rsplit_once(':').map_or(bind, |(h, _)| h);
        let own = match bind.parse::<std::net::SocketAddr>() {
            Ok(a) => a.ip().is_unspecified() || a.ip().is_loopback(),
            Err(_) => host.eq_ignore_ascii_case("localhost"),
        };
        Ok(PublicUrl { url: format!("http://{bind}"), stand_in: own.then(|| host.to_owned()), given: false })
    }
}

/// A team server opened on its data directory, ready to serve.
#[derive(Clone)]
pub struct Server {
    state: api::AppState,
    db_path: PathBuf,
}

/// A member just made. No `Debug`: the token exists only here.
pub struct NewMember {
    pub id: String,
    pub token: String,
}

impl Server {
    /// Open the data directory, making what is missing. A first run writes
    /// the admin token to `out`, the only time it is shown.
    pub fn open(cfg: &Config, out: &mut impl Write) -> Result<Server> {
        make_data_dir(&cfg.data_dir)?;
        let db_path = cfg.data_dir.join("team.sqlite");
        let vault = vault::Vault::open_or_create(&cfg.data_dir.join("server.key"))?;
        let store = Arc::new(store::Store::open(&db_path, vault)?);
        let keys = bootstrap(&store, &db_path, cfg.team_name.as_deref(), cfg.url.as_ref(), out)?;
        let state = api::AppState {
            store,
            key: Arc::new(keys.key),
            admin_secret: keys.admin_secret.into(),
            team: keys.team.into(),
            hub: live::Hub::new(),
            trash_ttl_secs: cfg.trash_days.saturating_mul(24 * 60 * 60),
            session_max: api::BLOB_MAX,
            package_max: api::PACKAGE_MAX,
            public_url: cfg.url.as_ref().filter(|u| u.given).map(|u| u.url.as_str().into()),
        };
        Ok(Server { state, db_path })
    }

    /// The whole HTTP API, routes and gates as served.
    pub fn router(&self) -> Router {
        api::router(self.state.clone())
    }

    pub fn team_id(&self) -> &str {
        &self.state.team
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// The key launchers check permissions with, as `/me` hands it out.
    pub fn public_key(&self) -> String {
        self.state.key.public_b64()
    }

    /// A fresh admin token, good for `ttl_secs`.
    pub fn admin_token(&self, ttl_secs: u64) -> Result<String> {
        auth::mint_admin(&self.state.admin_secret, ttl_secs)
    }

    /// Print a fresh admin invite, for an owner who lost the first one.
    /// Earlier admin tokens keep working: a new secret would log the owner out.
    pub fn print_invite(&self, url: &PublicUrl, out: &mut impl Write) -> Result<()> {
        let token = self.admin_token(ADMIN_BOOTSTRAP_TTL_SECS)?;
        let name = self.state.store.meta_get(store::META_TEAM_NAME)?;
        let name = name.as_deref().unwrap_or(api::DEFAULT_TEAM_NAME);
        show_new_invite(out, name, url, &token).context("print the invite")
    }

    /// A new member with these rules. Later changes go through
    /// `PUT /admin/members/:id/grants`, so their live channel hears them.
    pub fn add_member(&self, name: &str, grants: &[Grant]) -> Result<NewMember> {
        let token = auth::new_member_token();
        let id = uuid::Uuid::new_v4().to_string();
        self.state.store.add_member(&id, name, &auth::token_hash(&token))?;
        self.state.store.set_grants(&id, grants)?;
        Ok(NewMember { id, token })
    }

    /// Serve on `listener` until `shutdown`, sweeping the trash and freeing
    /// lapsed leases meanwhile; the requests in flight then answer.
    pub async fn serve(self, listener: TcpListener, shutdown: impl Future<Output = ()>) -> Result<()> {
        let st = self.state;
        // Devices kept their profiles open while it was down: theirs to renew first.
        if let Err(e) = st.store.leases_resume(api::LEASE_TTL_SECS) {
            tracing::warn!("leases: {e:#}");
        }
        // What ran out of days while the server was down goes now, then hourly.
        sweep_trash(&st).await;
        let mut chores = JoinSet::new();
        let sweeper = st.clone();
        chores.spawn(async move {
            let start = tokio::time::Instant::now() + TRASH_SWEEP_EVERY;
            let mut every = tokio::time::interval_at(start, TRASH_SWEEP_EVERY);
            loop {
                every.tick().await;
                sweep_trash(&sweeper).await;
            }
        });
        let reaper = st.clone();
        chores.spawn(async move {
            let mut every = tokio::time::interval(LEASE_REAP_EVERY);
            loop {
                every.tick().await;
                if let Err(e) = api::reap_leases(&reaper).await {
                    tracing::warn!("leases: {e:#}");
                }
            }
        });
        // The live sockets do not hold a stop up: a connection is done once
        // it has been upgraded, so they go when the process does.
        let limits = Limits { header_timeout: HEADER_TIMEOUT, max_connections: MAX_CONNECTIONS };
        let tls = wire_tls(&st.key)?;
        let served = serve(listener, api::router(st), tls, limits, shutdown).await;
        chores.abort_all();
        served
    }
}

/// A server on `127.0.0.1:0` over `data_dir`, for a test to reach by plain
/// http at `url`; stopped when dropped. Needs a tokio runtime.
pub struct TestServer {
    /// `http://127.0.0.1:<port>`, no trailing slash.
    pub url: String,
    /// An admin token, good for a day.
    pub admin_token: String,
    pub server: Server,
    task: tokio::task::JoinHandle<()>,
}

impl TestServer {
    pub async fn start(data_dir: impl AsRef<Path>) -> Result<TestServer> {
        TestServer::start_with(Config::new(data_dir.as_ref())).await
    }

    /// The same, set up as the test says.
    pub async fn start_with(cfg: Config) -> Result<TestServer> {
        let server = Server::open(&cfg, &mut std::io::sink())?;
        let listener = TcpListener::bind("127.0.0.1:0").await.context("listen on 127.0.0.1:0")?;
        let url = format!("http://{}", listener.local_addr()?);
        let admin_token = server.admin_token(24 * 60 * 60)?;
        let run = server.clone();
        let task = tokio::spawn(async move {
            if let Err(e) = run.serve(listener, std::future::pending()).await {
                tracing::warn!("test server: {e:#}");
            }
        });
        Ok(TestServer { url, admin_token, server, task })
    }

    /// A new member with these rules: their id and token.
    pub fn add_member(&self, name: &str, grants: &[Grant]) -> Result<NewMember> {
        self.server.add_member(name, grants)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// The data directory, owner-only when we make it. One already there keeps its
/// mode: that is somebody's choice, and the files in it are private anyway.
fn make_data_dir(dir: &Path) -> Result<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut b, 0o700);
    b.create(dir).with_context(|| format!("make {}", dir.display()))?;
    #[cfg(windows)]
    owner_only(dir)?;
    Ok(())
}

/// Windows has no mode SQLite copies to its -wal and -shm files, so the folder
/// itself is left to this account, SYSTEM and Administrators, made or not.
#[cfg(windows)]
fn owner_only(dir: &Path) -> Result<()> {
    use std::process::Command;
    let who = Command::new("whoami").args(["/user", "/fo", "csv", "/nh"]).output().context("run whoami")?;
    let sid = sid_of(&String::from_utf8_lossy(&who.stdout)).context("whoami named no account")?;
    let out = Command::new("icacls").args(owner_only_args(dir, &sid)).output().context("run icacls")?;
    if !out.status.success() {
        bail!("restrict {} to this account: {}", dir.display(), String::from_utf8_lossy(&out.stdout).trim());
    }
    Ok(())
}

/// icacls: nothing inherited from above, full control for the account, SYSTEM
/// and Administrators, passed down to everything inside.
#[cfg_attr(not(windows), allow(dead_code))]
fn owner_only_args(dir: &Path, sid: &str) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec![dir.into(), "/inheritance:r".into(), "/grant:r".into()];
    for who in [sid, "S-1-5-18", "S-1-5-32-544"] {
        args.push(format!("*{who}:(OI)(CI)F").into());
    }
    args
}

/// The SID from `whoami /user /fo csv /nh`: `"host\name","S-1-5-21-…"`.
#[cfg_attr(not(windows), allow(dead_code))]
fn sid_of(csv: &str) -> Option<String> {
    let last = csv.trim().rsplit(',').next()?.trim().trim_matches('"');
    last.starts_with("S-1-").then(|| last.to_owned())
}

/// Purge the trash of what has run out of days; a failure is logged and retried next time.
async fn sweep_trash(st: &api::AppState) {
    match api::sweep_trash(st).await {
        Ok(0) => {}
        Ok(n) => tracing::info!("trash: purged {n} item(s) past their days"),
        Err(e) => tracing::warn!("trash: {e:#}"),
    }
}

/// The team's name on the first run: unset or blank is the default.
fn first_team_name(raw: Option<&str>) -> Result<String> {
    match raw.map(str::trim) {
        None | Some("") => Ok(api::DEFAULT_TEAM_NAME.into()),
        Some(v) => match api::team_name_arg(v) {
            Some(name) => Ok(name.into()),
            None => bail!("a team name is at most 64 characters"),
        },
    }
}

/// What the server runs with.
struct Keys {
    admin_secret: String,
    key: auth::PermissionKey,
    team: String,
}

/// Load this server's secrets, or make them; no admin secret yet means first run.
/// The token is printed before anything is saved, and all new rows are saved in
/// one go, so a start that fails in between leaves nothing and the next prints afresh.
fn bootstrap(
    store: &store::Store,
    db_path: &Path,
    team_name: Option<&str>,
    url: Option<&PublicUrl>,
    out: &mut impl Write,
) -> Result<Keys> {
    let mut new: Vec<(&str, String)> = Vec::new();
    // Checked before a token is shown: a bad name stops the start with nothing kept.
    let name = match store.meta_get(store::META_TEAM_NAME)? {
        Some(n) => n,
        None => {
            let n = first_team_name(team_name)?;
            new.push((store::META_TEAM_NAME, n.clone()));
            n
        }
    };
    let key = match store.meta_get(META_SIGNING_KEY)? {
        Some(pem) => auth::PermissionKey::from_pem(&pem)?,
        None => {
            let k = auth::PermissionKey::generate();
            new.push((META_SIGNING_KEY, k.to_pem()?));
            k
        }
    };
    let team = match store.meta_get(META_TEAM_ID)? {
        Some(t) => t,
        None => {
            let t = uuid::Uuid::new_v4().to_string();
            new.push((META_TEAM_ID, t.clone()));
            t
        }
    };
    let admin_secret = match store.meta_get(META_ADMIN_SECRET)? {
        Some(s) => s,
        None => {
            let s = auth::new_admin_secret();
            let token = auth::mint_admin(&s, ADMIN_BOOTSTRAP_TTL_SECS)?;
            show_first_run(out, &team, &name, &token, &key, db_path, url)
                .context("print the admin token")?;
            new.push((META_ADMIN_SECRET, s.clone()));
            s
        }
    };
    let rows: Vec<(&str, &str)> = new.iter().map(|(k, v)| (*k, v.as_str())).collect();
    store.meta_set_all(&rows)?;
    Ok(Keys { admin_secret, key, team })
}

/// Printed rather than logged: this has to be readable whatever RUST_LOG says,
/// and it is the only time the token exists.
fn show_first_run(
    out: &mut impl Write,
    team: &str,
    name: &str,
    token: &str,
    key: &auth::PermissionKey,
    db_path: &Path,
    url: Option<&PublicUrl>,
) -> std::io::Result<()> {
    writeln!(out)?;
    writeln!(out, "  A new team server. This is shown once and never again.")?;
    writeln!(out)?;
    writeln!(out, "  team:        {name}")?;
    writeln!(out, "  team id:     {team}")?;
    if let Some(url) = url {
        show_invite(out, url, token)?;
    }
    writeln!(out, "  admin token: {token}")?;
    writeln!(out, "  public key:  {}", key.public_b64())?;
    writeln!(out)?;
    writeln!(out, "  Paste the invite into Octopus Agent to join as the team's admin; keep it secret.")?;
    writeln!(out, "  Lost it? `octopus-agent-team-server --print-invite` prints a new one.")?;
    writeln!(out, "  To lock out every admin token, clear `admin_secret` from the meta table")?;
    writeln!(out, "  of {} and restart.", db_path.display())?;
    writeln!(out, "  The public key is what every launcher checks permissions with, and this")?;
    writeln!(out, "  server by: the traffic is encrypted, no certificate or domain is needed.")?;
    writeln!(out)?;
    out.flush()
}

fn show_new_invite(out: &mut impl Write, name: &str, url: &PublicUrl, token: &str) -> std::io::Result<()> {
    writeln!(out)?;
    writeln!(out, "  A new admin invite for this team server. Keep it secret.")?;
    writeln!(out)?;
    writeln!(out, "  team:        {name}")?;
    show_invite(out, url, token)?;
    writeln!(out, "  admin token: {token}")?;
    writeln!(out)?;
    writeln!(out, "  Paste the invite into Octopus Agent to join as the team's admin.")?;
    writeln!(out, "  Invites printed before keep working until they expire.")?;
    writeln!(out)?;
    out.flush()
}

/// The invite line, and under it what to put in place of a host only this machine knows.
fn show_invite(out: &mut impl Write, url: &PublicUrl, token: &str) -> std::io::Result<()> {
    writeln!(out, "  invite:      {}#{token}", url.url)?;
    if let Some(host) = &url.stand_in {
        writeln!(out, "  hint:        replace {host} with this machine's address, or set SHARDBROWSER_TEAM_PUBLIC_URL")?;
    }
    Ok(())
}

/// What a connection is held to.
#[derive(Clone, Copy)]
struct Limits {
    header_timeout: Duration,
    max_connections: usize,
}

/// The TLS the API is served inside: the team's own key, as launchers hold it.
fn wire_tls(key: &auth::PermissionKey) -> Result<TlsAcceptor> {
    let (cfg, _) = team_wire::server_config(&key.to_pkcs8_der()?).context("the wire's TLS")?;
    Ok(TlsAcceptor::from(cfg))
}

/// Serve until `shutdown`, then let the requests in flight answer. Unlike
/// axum::serve, a connection that sends no head in time is closed.
async fn serve(
    listener: TcpListener,
    app: Router,
    tls: TlsAcceptor,
    limits: Limits,
    shutdown: impl Future<Output = ()>,
) -> Result<()> {
    let slots = Arc::new(Semaphore::new(limits.max_connections));
    let (stop, stopping) = watch::channel(());
    let mut conns = JoinSet::new();
    tokio::pin!(shutdown);
    loop {
        // A slot first: at the cap, new connections wait in the kernel's queue.
        let slot = tokio::select! {
            _ = &mut shutdown => break,
            s = slots.clone().acquire_owned() => s.context("connection slots")?,
        };
        let tcp = tokio::select! {
            _ = &mut shutdown => break,
            r = listener.accept() => match r {
                Ok((tcp, _)) => tcp,
                Err(e) => {
                    // Out of descriptors, or a connection gone while queued:
                    // wait a moment rather than spin.
                    tracing::warn!("accept: {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            },
        };
        let (app, tls, stopping) = (app.clone(), tls.clone(), stopping.clone());
        conns.spawn(async move {
            let _slot = slot;
            serve_connection(tcp, app, tls, limits, stopping).await;
        });
        // Finished connections are reaped as we go, so the set stays small.
        while conns.try_join_next().is_some() {}
    }
    drop(listener);
    let _ = stop.send(());
    while conns.join_next().await.is_some() {}
    Ok(())
}

/// One connection: plain http until it asks to switch, then the API inside TLS on it.
async fn serve_connection(tcp: TcpStream, app: Router, tls: TlsAcceptor, limits: Limits, mut stopping: watch::Receiver<()>) {
    let (tx, rx) = oneshot::channel();
    let tx = std::sync::Mutex::new(Some(tx));
    let gate = hyper::service::service_fn(move |req| {
        let res = in_the_clear(req, &tx);
        async move { Ok::<_, std::convert::Infallible>(res) }
    });
    let conn = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(limits.header_timeout)
        .serve_connection(TokioIo::new(tcp), gate)
        .with_upgrades();
    // Stopped meanwhile: nothing has been asked on it yet, so it goes with us.
    if until_stopped(conn, &mut stopping).await {
        return;
    }
    let Ok(upgrade) = { rx }.try_recv() else { return };
    let opened = tokio::time::timeout(limits.header_timeout, async {
        let raw = upgrade.await.map_err(std::io::Error::other)?;
        tls.accept(TokioIo::new(raw)).await
    });
    let io = match opened.await {
        Ok(Ok(io)) => io,
        Ok(Err(e)) => return tracing::debug!("wire: {e}"),
        Err(_) => return tracing::debug!("wire: no handshake in time"),
    };
    let conn = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(limits.header_timeout)
        .serve_connection(TokioIo::new(io), TowerToHyperService::new(app))
        .with_upgrades();
    until_stopped(conn, &mut stopping).await;
}

/// A connection served until it ends, or shut down gracefully once the server
/// stops. True when the stop came first.
async fn until_stopped<I, S, B>(conn: http1::UpgradeableConnection<I, S>, stopping: &mut watch::Receiver<()>) -> bool
where
    S: hyper::service::HttpService<hyper::body::Incoming, ResBody = B>,
    S::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
    I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
    B: hyper::body::Body + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    tokio::pin!(conn);
    let (done, stopped) = tokio::select! {
        r = conn.as_mut() => (r, false),
        _ = stopping.changed() => {
            conn.as_mut().graceful_shutdown();
            (conn.await, true)
        }
    };
    if let Err(e) = done {
        tracing::debug!("connection: {e}");
    }
    stopped
}

/// What is answered before the switch: `/health` in a word, the switch itself, and
/// to anything else a refusal an older launcher shows as it is.
fn in_the_clear(mut req: Request<hyper::body::Incoming>, tx: &std::sync::Mutex<Option<oneshot::Sender<OnUpgrade>>>) -> Response<Body> {
    let path = req.uri().path();
    if path == team_wire::HEALTH && req.method() == Method::GET {
        return plain(StatusCode::OK, serde_json::json!({ "status": "ok" }));
    }
    if path == team_wire::PATH && asks_to_switch(req.headers()) {
        if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(hyper::upgrade::on(&mut req));
        }
        let mut res = Response::new(Body::empty());
        *res.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
        res.headers_mut().insert(header::UPGRADE, HeaderValue::from_static(team_wire::UPGRADE));
        res.headers_mut().insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
        return res;
    }
    let body = serde_json::json!({
        "error": "this team server encrypts its traffic: update Octopus Agent to connect",
        "code": team_wire::PLAIN_REFUSED,
    });
    let mut res = plain(StatusCode::UPGRADE_REQUIRED, body);
    res.headers_mut().insert(header::UPGRADE, HeaderValue::from_static(team_wire::UPGRADE));
    res
}

fn asks_to_switch(h: &HeaderMap) -> bool {
    let has = |name, token: &str| {
        h.get_all(name)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(','))
            .any(|t| t.trim().eq_ignore_ascii_case(token))
    };
    has(header::UPGRADE, team_wire::UPGRADE) && has(header::CONNECTION, "upgrade")
}

fn plain(status: StatusCode, body: serde_json::Value) -> Response<Body> {
    let mut res = Response::new(Body::from(body.to_string()));
    *res.status_mut() = status;
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use std::io::Read;

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("shardx-main-{name}-{}", std::process::id()))
    }

    #[cfg(unix)]
    #[test]
    fn a_data_directory_we_make_is_the_servers_alone() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("dir");
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("data");
        make_data_dir(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        // Already there: made again without complaint.
        make_data_dir(&dir).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn on_windows_the_data_directory_is_left_to_the_server_and_the_system() {
        let csv = "\"desktop-1\\\u{432}\u{435}\u{440}\u{430}\",\"S-1-5-21-1-2-3-1001\"\r\n";
        assert_eq!(sid_of(csv).as_deref(), Some("S-1-5-21-1-2-3-1001"));
        assert_eq!(sid_of("\"nt authority\\system\",\"S-1-5-18\"").as_deref(), Some("S-1-5-18"));
        assert_eq!(sid_of("ERROR: access denied"), None);
        let args: Vec<String> = owner_only_args(Path::new("C:\\team"), "S-1-5-21-9")
            .into_iter()
            .map(|a| a.into_string().unwrap())
            .collect();
        assert_eq!(
            args,
            [
                "C:\\team",
                "/inheritance:r",
                "/grant:r",
                "*S-1-5-21-9:(OI)(CI)F",
                "*S-1-5-18:(OI)(CI)F",
                "*S-1-5-32-544:(OI)(CI)F",
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_data_directory_on_windows_inherits_nothing_from_above() {
        let root = scratch("acl");
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("data");
        make_data_dir(&dir).unwrap();
        let out = std::process::Command::new("icacls").arg(&dir).output().unwrap();
        let acl = String::from_utf8_lossy(&out.stdout).to_string();
        assert!(!acl.contains("(I)"), "{acl}");
        assert!(!acl.contains("S-1-5-11") && !acl.to_lowercase().contains("authenticated users"), "{acl}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A stdout that has gone away.
    struct Gone;
    impl Write for Gone {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_first_run_that_could_not_show_the_token_saves_nothing() {
        let store = store::Store::open_memory().unwrap();
        let db = Path::new("team.sqlite");

        assert!(bootstrap(&store, db, None, None, &mut Gone).is_err());
        for key in [META_ADMIN_SECRET, META_SIGNING_KEY, META_TEAM_ID, store::META_TEAM_NAME] {
            assert!(store.meta_get(key).unwrap().is_none(), "{key} was kept");
        }

        // So the next start is a first run again, and the token it shows works.
        let mut shown = Vec::new();
        let first = bootstrap(&store, db, None, None, &mut shown).unwrap();
        let shown = String::from_utf8(shown).unwrap();
        let token = shown
            .lines()
            .find_map(|l| l.trim().strip_prefix("admin token:"))
            .expect("the token was shown")
            .trim();
        assert!(auth::is_admin(&first.admin_secret, token));
        assert!(shown.contains(&first.key.public_b64()));
        assert!(shown.contains(&first.team));

        // A restart shows nothing and keeps everything.
        let mut again = Vec::new();
        let second = bootstrap(&store, db, None, None, &mut again).unwrap();
        assert!(again.is_empty());
        assert_eq!(second.admin_secret, first.admin_secret);
        assert_eq!(second.team, first.team);
        assert_eq!(second.key.public_b64(), first.key.public_b64());
    }

    #[test]
    fn the_team_name_is_taken_on_the_first_run_and_kept() {
        let store = store::Store::open_memory().unwrap();
        let db = Path::new("team.sqlite");
        let name = |s: &store::Store| s.meta_get(store::META_TEAM_NAME).unwrap();

        // Too long: refused before any token is shown, and nothing is kept.
        let mut shown = Vec::new();
        assert!(bootstrap(&store, db, Some(&"x".repeat(65)), None, &mut shown).is_err());
        assert!(shown.is_empty());
        assert!(store.meta_get(META_ADMIN_SECRET).unwrap().is_none());

        let mut shown = Vec::new();
        bootstrap(&store, db, Some("  Ads crew "), None, &mut shown).unwrap();
        assert!(String::from_utf8(shown).unwrap().contains("Ads crew"));
        assert_eq!(name(&store).as_deref(), Some("Ads crew"));
        // Later starts keep it, whatever the environment says by then.
        bootstrap(&store, db, Some("Other"), None, &mut Vec::new()).unwrap();
        assert_eq!(name(&store).as_deref(), Some("Ads crew"));

        // Unset or blank is the default.
        for raw in [None, Some("   ")] {
            let s = store::Store::open_memory().unwrap();
            bootstrap(&s, db, raw, None, &mut Vec::new()).unwrap();
            assert_eq!(name(&s).as_deref(), Some(api::DEFAULT_TEAM_NAME));
        }
    }

    #[test]
    fn the_invite_starts_with_the_public_url_or_the_address_listened_on() {
        let url = |public: Option<&str>, bind: &str| PublicUrl::new(public, bind).unwrap();
        let p = |u: &str, host: Option<&str>| PublicUrl { url: u.into(), stand_in: host.map(Into::into), given: false };
        let given = |u: &str| PublicUrl { url: u.into(), stand_in: None, given: true };
        assert_eq!(url(None, "0.0.0.0:8787"), p("http://0.0.0.0:8787", Some("0.0.0.0")));
        assert_eq!(url(None, "127.0.0.1:8787"), p("http://127.0.0.1:8787", Some("127.0.0.1")));
        assert_eq!(url(None, "[::]:8787"), p("http://[::]:8787", Some("[::]")));
        assert_eq!(url(None, "localhost:8787"), p("http://localhost:8787", Some("localhost")));
        assert_eq!(url(None, "203.0.113.5:8787"), p("http://203.0.113.5:8787", None));
        // Given: taken as said, plain http when no scheme, never a hint.
        assert_eq!(url(Some(" 203.0.113.5:8787 "), "0.0.0.0:8787"), given("http://203.0.113.5:8787"));
        assert_eq!(url(Some("https://team.example.com/"), "0.0.0.0:8787"), given("https://team.example.com"));
        assert_eq!(url(Some("  "), "0.0.0.0:8787"), p("http://0.0.0.0:8787", Some("0.0.0.0")));
        for bad in ["http://x#y", "http://a b"] {
            assert!(PublicUrl::new(Some(bad), "0.0.0.0:8787").is_err(), "{bad}");
        }
    }

    /// The token on the invite line, and the line itself.
    fn invite_in(shown: &str) -> (String, String) {
        let line = shown.lines().find_map(|l| l.trim().strip_prefix("invite:")).expect("an invite was shown").trim();
        let (_, token) = line.split_once('#').unwrap();
        (line.to_owned(), token.to_owned())
    }

    #[test]
    fn a_first_run_prints_an_invite_to_paste_with_a_hint_for_a_local_address() {
        let db = Path::new("team.sqlite");
        let store = store::Store::open_memory().unwrap();
        let local = PublicUrl::new(None, "0.0.0.0:8787").unwrap();
        let mut shown = Vec::new();
        let keys = bootstrap(&store, db, None, Some(&local), &mut shown).unwrap();
        let shown = String::from_utf8(shown).unwrap();
        let (line, token) = invite_in(&shown);
        assert!(line.starts_with("http://0.0.0.0:8787#eyJ"), "{line}");
        assert!(auth::is_admin(&keys.admin_secret, &token));
        assert!(shown.contains(&format!("admin token: {token}")), "{shown}");
        assert!(shown.contains("replace 0.0.0.0 with this machine's address"), "{shown}");
        assert!(shown.contains("--print-invite"), "{shown}");

        // Told where it is reached: no hint.
        let store = store::Store::open_memory().unwrap();
        let given = PublicUrl::new(Some("http://203.0.113.5:8787"), "0.0.0.0:8787").unwrap();
        let mut shown = Vec::new();
        bootstrap(&store, db, None, Some(&given), &mut shown).unwrap();
        let shown = String::from_utf8(shown).unwrap();
        assert!(invite_in(&shown).0.starts_with("http://203.0.113.5:8787#eyJ"));
        assert!(!shown.contains("hint:"), "{shown}");
    }

    #[test]
    fn a_lost_invite_is_printed_again_with_a_fresh_admin_token() {
        let dir = scratch("invite");
        let _ = std::fs::remove_dir_all(&dir);
        let mut cfg = Config::new(&dir);
        cfg.team_name = Some("Ads crew".into());
        let mut first = Vec::new();
        let server = Server::open(&cfg, &mut first).unwrap();
        let url = PublicUrl::new(None, "127.0.0.1:8787").unwrap();

        let mut again = Vec::new();
        server.print_invite(&url, &mut again).unwrap();
        let again = String::from_utf8(again).unwrap();
        let (line, token) = invite_in(&again);
        assert!(line.starts_with("http://127.0.0.1:8787#eyJ"), "{line}");
        assert!(auth::is_admin(&server.state.admin_secret, &token));
        assert!(again.contains("Ads crew") && again.contains("replace 127.0.0.1"), "{again}");
        // Reopened, it is the same team and still prints nothing on its own.
        drop(server);
        let mut quiet = Vec::new();
        let reopened = Server::open(&cfg, &mut quiet).unwrap();
        assert!(quiet.is_empty());
        assert!(auth::is_admin(&reopened.state.admin_secret, &token));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_an_address_the_owner_gave_is_handed_on_for_member_invites() {
        let dir = scratch("public-url");
        let _ = std::fs::remove_dir_all(&dir);
        let mut cfg = Config::new(&dir);
        for (public, bind, handed) in [
            (Some("https://team.example.com"), "0.0.0.0:8787", Some("https://team.example.com")),
            // Listened on, not given: the admin's own address may be the better one.
            (None, "203.0.113.5:8787", None),
            (None, "0.0.0.0:8787", None),
        ] {
            cfg.url = Some(PublicUrl::new(public, bind).unwrap());
            let server = Server::open(&cfg, &mut std::io::sink()).unwrap();
            assert_eq!(server.state.public_url.as_deref(), handed, "{public:?} {bind}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Read until the server closes the connection; an error if it has not
    /// within a few seconds.
    fn until_closed(mut s: std::net::TcpStream) -> std::io::Result<Vec<u8>> {
        s.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut got = Vec::new();
        match s.read_to_end(&mut got) {
            Ok(_) => Ok(got),
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => Ok(got),
            Err(e) => Err(e),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_connection_that_never_finishes_its_head_is_closed_and_frees_its_slot() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().route("/health", get(|| async { "ok" }));
        let limits = Limits { header_timeout: Duration::from_millis(500), max_connections: 1 };
        tokio::spawn(serve(listener, app, some_tls().0, limits, std::future::pending()));

        // Plain blocking sockets, off the runtime, as a stranger would hold them.
        let (stalled, next) = tokio::task::spawn_blocking(move || {
            let mut stalled = std::net::TcpStream::connect(addr).unwrap();
            stalled.write_all(b"GET /health HTTP/1.1\r\nHost: x\r\n").unwrap();
            // The only slot is taken; this one waits in the queue for it.
            let mut next = std::net::TcpStream::connect(addr).unwrap();
            next.write_all(b"GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").unwrap();
            (until_closed(stalled), until_closed(next))
        })
        .await
        .unwrap();

        assert!(stalled.is_ok(), "the stalled connection was kept open: {stalled:?}");
        let reply = String::from_utf8(next.unwrap()).unwrap();
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
    }

    fn some_tls() -> (TlsAcceptor, team_wire::Key) {
        let key = auth::PermissionKey::generate();
        (wire_tls(&key).unwrap(), key.public_raw())
    }

    /// A server whose API answers "inside" at /health, and its key.
    async fn wired(limits: Limits) -> (std::net::SocketAddr, team_wire::Key) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().route("/health", get(|| async { "inside" }));
        let (tls, key) = some_tls();
        tokio::spawn(serve(listener, app, tls, limits, std::future::pending()));
        (addr, key)
    }

    /// Ask to switch, as a launcher does; the stream after the 101.
    async fn switched(addr: std::net::SocketAddr) -> TcpStream {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut s = TcpStream::connect(addr).await.unwrap();
        let ask = format!("GET /wire HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: {}\r\n\r\n", team_wire::UPGRADE);
        s.write_all(ask.as_bytes()).await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            let mut b = [0u8; 1];
            assert_eq!(s.read(&mut b).await.unwrap(), 1, "closed during the switch");
            head.push(b[0]);
        }
        assert!(head.starts_with(b"HTTP/1.1 101"), "{}", String::from_utf8_lossy(&head));
        s
    }

    async fn tls_to(addr: std::net::SocketAddr, pin: Arc<team_wire::Pin>) -> std::io::Result<tokio_rustls::client::TlsStream<TcpStream>> {
        let name = tokio_rustls::rustls::pki_types::ServerName::try_from("127.0.0.1").unwrap();
        tokio_rustls::TlsConnector::from(team_wire::client_config(pin)).connect(name, switched(addr).await).await
    }

    /// One request on `s`, the whole answer back.
    async fn exchange<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(s: &mut S, head: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        s.write_all(head.as_bytes()).await.unwrap();
        let mut got = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), s.read_to_end(&mut got)).await;
        String::from_utf8_lossy(&got).into_owned()
    }

    const LIMITS: Limits = Limits { header_timeout: Duration::from_secs(5), max_connections: 8 };

    #[tokio::test(flavor = "multi_thread")]
    async fn in_the_clear_only_health_answers_and_all_else_asks_for_an_update() {
        let (addr, _) = wired(LIMITS).await;
        let mut s = TcpStream::connect(addr).await.unwrap();
        let health = exchange(&mut s, "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await;
        assert!(health.starts_with("HTTP/1.1 200"), "{health}");
        assert!(health.ends_with(r#"{"status":"ok"}"#), "nothing but that it is up: {health}");

        let mut s = TcpStream::connect(addr).await.unwrap();
        let old = exchange(&mut s, "GET /profiles HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer stm_x\r\nConnection: close\r\n\r\n").await;
        assert!(old.starts_with("HTTP/1.1 426"), "{old}");
        assert!(old.to_ascii_lowercase().contains(&format!("upgrade: {}", team_wire::UPGRADE)), "{old}");
        assert!(old.contains(r#""code":"upgrade_required""#) && old.contains("update Octopus Agent"), "{old}");
        // A switch asked for wrongly is the same refusal, not a half-open link.
        let mut s = TcpStream::connect(addr).await.unwrap();
        let wrong = exchange(&mut s, "GET /wire HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade, close\r\n\r\n").await;
        assert!(wrong.starts_with("HTTP/1.1 426"), "{wrong}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_api_is_served_inside_the_tls_and_only_for_the_teams_key() {
        let (addr, key) = wired(LIMITS).await;
        let mut io = tls_to(addr, team_wire::Pin::to(key)).await.unwrap();
        let inside = exchange(&mut io, "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await;
        assert!(inside.starts_with("HTTP/1.1 200") && inside.ends_with("inside"), "{inside}");

        let (_, other) = some_tls();
        let pin = team_wire::Pin::to(other);
        assert!(tls_to(addr, pin.clone()).await.is_err());
        assert!(pin.saw_another());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_connection_inside_the_wire_does_not_hold_a_stop_up() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().route("/health", get(|| async { "inside" }));
        let (tls, key) = some_tls();
        let (stop, asked) = tokio::sync::oneshot::channel();
        let served = tokio::spawn(serve(listener, app, tls, LIMITS, async { let _ = asked.await; }));

        // Switched and shaken hands, held open with nothing asked on it.
        let mut io = tls_to(addr, team_wire::Pin::to(key)).await.unwrap();
        let _ = stop.send(());
        let ended = tokio::time::timeout(Duration::from_secs(5), served).await;
        assert!(ended.is_ok(), "the stop waited on a connection inside the wire");
        ended.unwrap().unwrap().unwrap();
        // The server is gone: the launcher's own link sees it close.
        let mut b = [0u8; 1];
        let read = tokio::time::timeout(Duration::from_secs(5), tokio::io::AsyncReadExt::read(&mut io, &mut b)).await;
        assert!(matches!(read, Ok(Ok(0)) | Ok(Err(_))), "{read:?}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_switch_with_no_handshake_after_it_is_closed_and_frees_its_slot() {
        let (addr, key) = wired(Limits { header_timeout: Duration::from_millis(500), max_connections: 1 }).await;
        let mut stalled = switched(addr).await;
        // The only slot is taken; this one waits in the queue for it.
        let next = tokio::spawn(async move {
            let mut io = tls_to(addr, team_wire::Pin::to(key)).await.unwrap();
            exchange(&mut io, "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await
        });
        let mut b = [0u8; 1];
        let closed = tokio::time::timeout(Duration::from_secs(5), tokio::io::AsyncReadExt::read(&mut stalled, &mut b)).await;
        assert!(matches!(closed, Ok(Ok(0)) | Ok(Err(_))), "the stalled switch was kept open: {closed:?}");
        assert!(next.await.unwrap().ends_with("inside"));
    }
}
