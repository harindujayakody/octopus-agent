//! The teams this launcher is connected to, and which space it works in.
//!
//! A space is where everything the launcher shows and makes lives. Personal is
//! this person's own; a team is a server someone runs for their team. Switching
//! moves the whole launcher at once — profiles, proxies, folders and the rest
//! come from the space that is chosen, and whatever is made is made there, so
//! nothing made while working for a team quietly lands in someone's own list.
//!
//! What is kept, in `teams.json` in this machine's local app data (it must not
//! roam to another PC) and readable only by this account: each team's address,
//! name and permission key, the member token for it, this device's id, and the
//! space last chosen. Only `space::client` talks to a team server.

use crate::space::client::{Code, TeamClient, TeamError};
use crate::store;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, RwLock};

mod machine;

/// A team this launcher has joined. The token is kept apart from this, in the
/// saved file only: nothing that is handed to the interface carries it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamLink {
    /// The server's own team id.
    pub id: String,
    pub name: String,
    /// The server's base address, e.g. `http://203.0.113.7:8787`.
    pub server: String,
    /// Joined as the team's admin: the team pages for members and rights show.
    #[serde(default)]
    pub admin: bool,
    /// Who this launcher is in the team; a permission for anyone else is refused.
    #[serde(default)]
    pub member_id: String,
    /// The public key every permission from this team is checked with.
    #[serde(default)]
    pub perm_key: String,
    /// The team withdrew this member: the token is gone and the team stays shut.
    #[serde(default)]
    pub revoked: bool,
    /// The admin re-issued the token: this one is gone, the new invite brings the team back.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub needs_invite: bool,
}

impl TeamLink {
    /// Not withdrawn, and not waiting for a new invite.
    fn usable(&self) -> bool {
        !self.revoked && !self.needs_invite
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Space {
    #[default]
    Personal,
    Team { team_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Saved {
    #[serde(default)]
    space: Space,
    #[serde(default)]
    teams: Vec<TeamLink>,
    /// Member token per team id.
    #[serde(default)]
    tokens: HashMap<String, String>,
    /// This device, as the server sees it — what a lease names, so another
    /// device can be told where a profile is already open.
    #[serde(default)]
    device_id: String,
    /// Per team id: the newest permission edition taken, so an older one
    /// replayed later is refused even after a restart.
    #[serde(default)]
    floors: HashMap<String, Floor>,
    /// The name the person gave this device; the OS's name when none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_name: Option<String>,
    /// The server holding the person's own space for sync, and the token for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sync: Option<SyncLink>,
    /// The computer `device_id` was made on, hashed: another one gets an id of its own.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    machine: String,
}

/// Where personal sync goes: a team server's `/me`, reached with the member's own token.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SyncLink {
    server: String,
    team_id: String,
    #[serde(default)]
    member_id: String,
    /// The token is the server's admin token: the person runs that server.
    #[serde(default)]
    admin: bool,
    token: String,
    /// The key the server proved itself with; empty until the first connection.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    key: String,
}

/// The sync connection as the interface may know it: no token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncPlace {
    pub server: String,
    pub team_id: String,
    pub own: bool,
}

/// The newest epoch a team's permission came with, and when that one was issued.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Floor {
    pub epoch: u64,
    pub iat: u64,
}

/// What the interface is told: the space, the teams, and this device's name.
#[derive(Debug, Clone, Serialize)]
pub struct SpaceState {
    pub space: Space,
    pub teams: Vec<TeamLink>,
    pub device_name: String,
    /// The space's edition: a write sent with an older one is refused as space_changed.
    pub epoch: u64,
    /// In a team: whether its lists came from the server, and when.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_status: Option<crate::space::cache::TeamStatus>,
}

/// The last read of `teams.json`, with the path it was read from.
fn cell() -> &'static RwLock<Option<(PathBuf, Saved)>> {
    static CELL: OnceLock<RwLock<Option<(PathBuf, Saved)>>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new(None))
}

/// Held from read to write, so two changes never undo each other.
fn edit_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn path() -> Result<PathBuf> {
    // A test without a config dir of its own would write the real one.
    #[cfg(test)]
    if !store::test_config_set() {
        bail!("a test touched teams.json without a config dir of its own");
    }
    Ok(store::local_root()?.join("teams.json"))
}

fn load() -> Result<Saved> {
    let p = path()?;
    let cached = cell().read().ok().and_then(|g| g.as_ref().filter(|(at, _)| *at == p).map(|(_, s)| s.clone()));
    if let Some(s) = cached {
        return Ok(s);
    }
    let mut saved: Saved = match std::fs::read(&p) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .with_context(|| format!("{} is not readable as team settings", p.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Saved::default(),
        Err(e) => return Err(e).with_context(|| format!("read {}", p.display())),
    };
    let mut changed = false;
    if saved.device_id.is_empty() {
        saved.device_id = uuid::Uuid::new_v4().to_string();
        changed = true;
    }
    // Copied from another computer: to a server this one is another device, or a lease could not tell them apart.
    if let Some(here) = machine::key().filter(|k| *k != saved.machine) {
        if !saved.machine.is_empty() {
            saved.device_id = uuid::Uuid::new_v4().to_string();
            saved.device_name = None;
        }
        saved.machine = here;
        changed = true;
    }
    if changed {
        save(&saved)?;
    }
    // A space that names a team no longer joined, or one this launcher cannot
    // reach now, falls back to personal rather than pointing at nothing.
    if let Space::Team { team_id } = &saved.space {
        if !saved.teams.iter().any(|t| &t.id == team_id && t.usable()) {
            saved.space = Space::Personal;
        }
    }
    if let Ok(mut g) = cell().write() {
        *g = Some((p, saved.clone()));
    }
    Ok(saved)
}

/// The saved state without writing anything: a missing device id is not made here.
fn peek() -> Result<Saved> {
    let p = path()?;
    let cached = cell().read().ok().and_then(|g| g.as_ref().filter(|(at, _)| *at == p).map(|(_, s)| s.clone()));
    if let Some(s) = cached {
        return Ok(s);
    }
    let mut saved: Saved = match std::fs::read(&p) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Saved::default()),
        Err(e) => return Err(e.into()),
    };
    if let Space::Team { team_id } = &saved.space {
        if !saved.teams.iter().any(|t| &t.id == team_id && t.usable()) {
            saved.space = Space::Personal;
        }
    }
    Ok(saved)
}

/// The team the launcher works in now; None in the personal space, or when
/// the file cannot be read.
pub fn active_team() -> Option<String> {
    match peek().ok()?.space {
        Space::Team { team_id } => Some(team_id),
        Space::Personal => None,
    }
}

/// This device's id, as leases name it.
pub fn device_id() -> String {
    load().map(|s| s.device_id).unwrap_or_default()
}

fn save(s: &Saved) -> Result<()> {
    let p = path()?;
    let before = cell().read().ok().and_then(|g| g.as_ref().filter(|(at, _)| *at == p).map(|(_, s)| s.space.clone()));
    let body = serde_json::to_vec_pretty(s)?;
    let tmp = p.with_extension("json.tmp");
    write_private(&tmp, &body)?;
    std::fs::rename(&tmp, &p).with_context(|| format!("replace {}", p.display()))?;
    if let Ok(mut g) = cell().write() {
        *g = Some((p, s.clone()));
    }
    if before.as_ref() != Some(&s.space) {
        SPACE_EPOCH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(())
}

/// Up by one whenever the space in use changes: a write carries the edition it
/// was asked under, and one from before a switch is refused.
static SPACE_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn space_epoch() -> u64 {
    SPACE_EPOCH.load(std::sync::atomic::Ordering::SeqCst)
}

/// The file holds member tokens, so only this account may read it.
#[cfg(unix)]
fn write_private(path: &std::path::Path, body: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .with_context(|| format!("write {}", path.display()))?;
    f.write_all(body)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private(path: &std::path::Path, body: &[u8]) -> Result<()> {
    // Local app data is this account's own on Windows, and does not roam.
    std::fs::write(path, body).with_context(|| format!("write {}", path.display()))
}

/// This device's name, as the person would recognise it in "open on …": the
/// one they gave it, else the machine's.
pub fn device_name() -> String {
    if let Some(n) = peek().ok().and_then(|s| s.device_name).filter(|n| !n.trim().is_empty()) {
        return n;
    }
    machine_name()
}

/// The longest device name, in characters.
pub const DEVICE_NAME_MAX: usize = 64;

/// Name this device; 1 to 64 characters once trimmed.
pub fn set_device_name(name: &str) -> Result<()> {
    let name = name.trim();
    let n = name.chars().count();
    if n == 0 || n > DEVICE_NAME_MAX || name.chars().any(char::is_control) {
        bail!("a device name is 1 to 64 characters");
    }
    let _edit = edit_lock();
    let mut s = load()?;
    s.device_name = Some(name.to_string());
    save(&s)
}

/// The OS's name for this machine.
fn machine_name() -> String {
    #[cfg(windows)]
    {
        if let Ok(n) = std::env::var("COMPUTERNAME") {
            if !n.is_empty() {
                return n;
            }
        }
    }
    #[cfg(unix)]
    {
        let mut buf = [0 as libc::c_char; 256];
        // SAFETY: gethostname writes at most buf.len() bytes and terminates on success.
        if unsafe { libc::gethostname(buf.as_mut_ptr(), buf.len()) } == 0 {
            if let Ok(s) = unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_str() {
                let s = s.trim_end_matches(".local");
                if !s.is_empty() {
                    return s.to_string();
                }
            }
        }
    }
    "This computer".into()
}

pub fn state() -> Result<SpaceState> {
    let s = load()?;
    let team_status = match &s.space {
        Space::Team { team_id } => Some(crate::space::cache::status(team_id)),
        Space::Personal => None,
    };
    Ok(SpaceState { space: s.space, teams: s.teams, device_name: device_name(), epoch: space_epoch(), team_status })
}

pub fn set_space(space: Space) -> Result<SpaceState> {
    {
        let _edit = edit_lock();
        let mut s = load()?;
        if let Space::Team { team_id } = &space {
            match s.teams.iter().find(|t| &t.id == team_id) {
                None => bail!("not a member of that team"),
                Some(t) if t.revoked => bail!("{} withdrew this launcher's access: join it again", t.name),
                Some(t) if t.needs_invite => bail!("{}", replaced_text(&t.name)),
                Some(_) => {}
            }
        }
        s.space = space;
        save(&s)?;
    }
    state()
}

/// Worded as errors.ts knows a token the server dropped.
fn replaced_text(team: &str) -> String {
    format!("{team}: the server does not know this token any more: paste the new invite from the team's admin")
}

/// The teams a channel is kept open for: joined, and reachable with the token kept.
pub fn followed() -> Vec<String> {
    peek().map(|s| s.teams.into_iter().filter(|t| t.usable()).map(|t| t.id).collect()).unwrap_or_default()
}

pub fn link(team_id: &str) -> Result<Option<TeamLink>> {
    Ok(load()?.teams.into_iter().find(|t| t.id == team_id))
}

/// What the team client needs to reach a team. Only `space::client` asks.
pub struct Reach {
    pub server: String,
    pub token: String,
    pub device_id: String,
    /// The team's key the server is held to; empty while none is kept.
    pub key: String,
}

pub fn reach(team_id: &str) -> Result<Reach> {
    let s = load()?;
    let link = s.teams.iter().find(|t| t.id == team_id).context("not a member of that team")?;
    if link.revoked {
        bail!("{} withdrew this launcher's access", link.name);
    }
    if link.needs_invite {
        bail!("{}", replaced_text(&link.name));
    }
    let token = s.tokens.get(team_id).context("no token for that team: join it again")?;
    Ok(Reach { server: link.server.clone(), token: token.clone(), device_id: s.device_id.clone(), key: link.perm_key.clone() })
}

/// The newest permission edition taken from the team, or zero.
pub fn floor(team_id: &str) -> Floor {
    load().ok().and_then(|s| s.floors.get(team_id).copied()).unwrap_or_default()
}

/// Note a newer edition; an older epoch never lowers it.
pub fn raise_floor(team_id: &str, to: Floor) -> Result<()> {
    let _edit = edit_lock();
    let mut s = load()?;
    if !s.teams.iter().any(|t| t.id == team_id) || s.floors.get(team_id).is_some_and(|f| f.epoch >= to.epoch) {
        return Ok(());
    }
    s.floors.insert(team_id.to_string(), to);
    save(&s)
}

/// What a team server says about itself and the token: `GET /me`.
#[derive(Deserialize)]
struct Me {
    team: MeTeam,
    /// None for the admin token.
    #[serde(default)]
    member: Option<MeMember>,
    #[serde(default)]
    admin: bool,
    #[serde(default)]
    perm_key: String,
}

#[derive(Deserialize)]
struct MeTeam {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct MeMember {
    id: String,
}

/// The server's base address, http or https: a self-hosted server is often
/// just an IP and a port.
pub fn server_base(input: &str) -> Result<String> {
    let url = url::Url::parse(input.trim()).context("not a server address: give it as http://host:port")?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        bail!("not a server address: give it as http://host:port");
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Join a team: the server confirms the token and names the team, and the
/// launcher moves into it.
pub async fn join(server: &str, token: &str) -> Result<SpaceState> {
    let base = server_base(server)?;
    let token = token.trim();
    if token.is_empty() {
        bail!("no token");
    }
    let device_id = load()?.device_id;
    let c = TeamClient::new(&base, token, &device_id)?;
    let me: Me = match c.get("/me").await {
        Ok(me) => me,
        Err(e) => bail!(join_refused(&base, &e)),
    };
    if !crate::space::perm::is_key(&me.perm_key) {
        bail!("{base} gave no key to check permissions with: is it an Octopus Agent team server?");
    }
    if c.server_key().as_deref() != Some(me.perm_key.as_str()) {
        bail!("{base} checks permissions with another key than the one it proved itself with");
    }
    // The admin token acts as the admin principal, and its permissions say so.
    let member_id = me.member.map(|m| m.id).unwrap_or_else(|| team_model::ADMIN_ID.to_string());
    {
        let _edit = edit_lock();
        let mut s = load()?;
        // Sync through this team as this member goes on with the new token.
        if let Some(l) = s.sync.as_mut().filter(|l| l.team_id == me.team.id && l.member_id == member_id) {
            l.token = token.to_string();
            l.server = base.clone();
        }
        s.teams.retain(|t| t.id != me.team.id);
        s.teams.push(TeamLink {
            id: me.team.id.clone(),
            name: me.team.name,
            server: base,
            admin: me.admin,
            member_id,
            perm_key: me.perm_key,
            revoked: false,
            needs_invite: false,
        });
        s.tokens.insert(me.team.id.clone(), token.to_string());
        // Maybe another member now: their editions count from scratch.
        s.floors.remove(&me.team.id);
        s.space = Space::Team { team_id: me.team.id };
        save(&s)?;
    }
    state()
}

fn join_refused(base: &str, e: &TeamError) -> String {
    match (e.code(), e.status()) {
        (Some(Code::Unauthorized | Code::UnknownToken), _) => "the server does not know this token".into(),
        (Some(Code::TokenReplaced), _) => "the server does not know this token: it was replaced by a new one".into(),
        (Some(Code::SwitchedOff), _) => "this member is switched off on the server".into(),
        (_, Some(404)) => format!("{base} is not an Octopus Agent team server"),
        (_, None) => match e {
            TeamError::Offline(_) => format!("{base} did not answer"),
            _ => format!("{base} is not an Octopus Agent team server"),
        },
        _ => format!("{base}: {e}"),
    }
}

// ---- personal sync's own link ----

/// Where sync goes now; None while it is not connected.
pub fn sync_place() -> Option<SyncPlace> {
    let l = peek().ok()?.sync?;
    Some(SyncPlace { server: l.server, team_id: l.team_id, own: l.admin })
}

/// What the client needs to reach the sync server. Only `space::client` asks.
pub fn sync_reach() -> Result<Reach> {
    let s = load()?;
    let l = s.sync.context(crate::space::sync::NOT_CONNECTED)?;
    // A link saved before keys were kept: the team's own, when it is joined here.
    let key = match l.key.is_empty() {
        true => s.teams.iter().find(|t| t.id == l.team_id).map(|t| t.perm_key.clone()).unwrap_or_default(),
        false => l.key,
    };
    Ok(Reach { server: l.server, token: l.token, device_id: s.device_id, key })
}

/// The key sync's server just proved itself with, kept while the link is still that server and token.
pub fn sync_key_learned(server: &str, token: &str, key: &str) {
    let _edit = edit_lock();
    let Ok(mut s) = load() else { return };
    let Some(l) = s.sync.as_mut().filter(|l| l.server == server && l.token == token && l.key.is_empty()) else { return };
    l.key = key.to_string();
    if let Err(e) = save(&s) {
        eprintln!("[launcher] sync: the server's key was not kept: {e:#}");
    }
}

/// Sync through a team joined here: its server, with this member's token.
pub fn sync_with_team(team_id: &str) -> Result<SyncPlace> {
    use crate::space::sync::NOT_MEMBER;
    let _edit = edit_lock();
    let mut s = load()?;
    let link = s.teams.iter().find(|t| t.id == team_id && t.usable()).context(NOT_MEMBER)?;
    let token = s.tokens.get(team_id).context(NOT_MEMBER)?.clone();
    let l = SyncLink {
        server: link.server.clone(),
        team_id: link.id.clone(),
        member_id: link.member_id.clone(),
        admin: link.admin,
        token,
        key: link.perm_key.clone(),
    };
    let place = SyncPlace { server: l.server.clone(), team_id: l.team_id.clone(), own: l.admin };
    s.sync = Some(l);
    save(&s)?;
    Ok(place)
}

/// Sync through a server and token pasted here; the server says whose space it is.
pub async fn sync_with_server(server: &str, token: &str) -> Result<SyncPlace> {
    let base = server_base(server)?;
    let token = token.trim();
    if token.is_empty() {
        bail!("no token");
    }
    let device_id = load()?.device_id;
    let c = TeamClient::new(&base, token, &device_id)?;
    let me: Me = match c.get("/me").await {
        Ok(me) => me,
        Err(TeamError::Offline(_)) => bail!("{}", crate::space::sync::no_answer(&base)),
        Err(e) => bail!(join_refused(&base, &e)),
    };
    let key = c.server_key().unwrap_or_default();
    if !me.perm_key.is_empty() && me.perm_key != key {
        bail!("{base} checks permissions with another key than the one it proved itself with");
    }
    // The admin token's own space is the admin principal's.
    let member_id = me.member.map(|m| m.id).unwrap_or_else(|| team_model::ADMIN_ID.to_string());
    let l = SyncLink { server: base, team_id: me.team.id, member_id, admin: me.admin, token: token.to_string(), key };
    let place = SyncPlace { server: l.server.clone(), team_id: l.team_id.clone(), own: l.admin };
    let _edit = edit_lock();
    let mut s = load()?;
    s.sync = Some(l);
    save(&s)?;
    Ok(place)
}

/// Sync disconnected: its token is forgotten here.
pub fn sync_forget() -> Result<()> {
    let _edit = edit_lock();
    let mut s = load()?;
    if s.sync.take().is_some() {
        save(&s)?;
    }
    Ok(())
}

/// What another of the person's computers pastes: the same server and token.
/// The server tells their devices apart by X-Device-Id.
pub fn sync_invite() -> Result<String> {
    let l = load()?.sync.context(crate::space::sync::NOT_CONNECTED)?;
    Ok(format!("{}#{}", l.server, l.token))
}

/// Point sync at another address, as if its server moved or went away.
#[cfg(test)]
pub fn set_sync_server(server: &str) {
    let _edit = edit_lock();
    let mut s = load().unwrap();
    if let Some(l) = s.sync.as_mut() {
        l.server = server.to_string();
    }
    save(&s).unwrap();
}

/// Whether `lost` names the address and token kept for the team now.
fn still_kept(s: &Saved, team_id: &str, lost: &impl Fn(&str, &str) -> bool) -> bool {
    let server = s.teams.iter().find(|t| t.id == team_id).map(|t| t.server.as_str());
    matches!((server, s.tokens.get(team_id)), (Some(server), Some(token)) if lost(server, token))
}

/// The team withdrew this member: forget the token, keep the team marked as
/// withdrawn, and go back to personal if it was the one in use. None, and
/// nothing changed, when `lost` is not the token kept: a join since then stays.
pub fn revoke(team_id: &str, lost: impl Fn(&str, &str) -> bool) -> Result<Option<SpaceState>> {
    {
        let _edit = edit_lock();
        let mut s = load()?;
        if !still_kept(&s, team_id, &lost) {
            return Ok(None);
        }
        s.tokens.remove(team_id);
        s.floors.remove(team_id);
        for t in s.teams.iter_mut().filter(|t| t.id == team_id) {
            t.revoked = true;
        }
        if s.space == (Space::Team { team_id: team_id.to_string() }) {
            s.space = Space::Personal;
        }
        save(&s)?;
    }
    state().map(Some)
}

/// The admin re-issued this member's token: forget it and wait for the new
/// invite. Not a withdrawal: the member is still in the team. None as for [`revoke`].
pub fn token_replaced(team_id: &str, lost: impl Fn(&str, &str) -> bool) -> Result<Option<SpaceState>> {
    {
        let _edit = edit_lock();
        let mut s = load()?;
        if !still_kept(&s, team_id, &lost) {
            return Ok(None);
        }
        s.tokens.remove(team_id);
        for t in s.teams.iter_mut().filter(|t| t.id == team_id) {
            t.needs_invite = true;
        }
        if s.space == (Space::Team { team_id: team_id.to_string() }) {
            s.space = Space::Personal;
        }
        save(&s)?;
    }
    state().map(Some)
}

/// The team's name as its server now gives it. True when it changed.
pub fn rename(team_id: &str, name: &str) -> Result<bool> {
    let _edit = edit_lock();
    let mut s = load()?;
    let Some(link) = s.teams.iter_mut().find(|t| t.id == team_id) else { return Ok(false) };
    if link.name == name {
        return Ok(false);
    }
    link.name = name.to_string();
    save(&s)?;
    Ok(true)
}

/// Forget a team on this launcher. Back to personal if it was the one in use.
pub fn leave(team_id: &str) -> Result<SpaceState> {
    {
        let _edit = edit_lock();
        let mut s = load()?;
        s.teams.retain(|t| t.id != team_id);
        s.tokens.remove(team_id);
        s.floors.remove(team_id);
        if s.space == (Space::Team { team_id: team_id.to_string() }) {
            s.space = Space::Personal;
        }
        save(&s)?;
    }
    state()
}

/// Delete all data: every team forgotten here, tokens and all, kept in no backup.
/// The ids it held, for what is kept in memory for them.
pub fn forget_all() -> Result<Vec<String>> {
    let _edit = edit_lock();
    let p = path()?;
    let ids = peek().map(|s| s.teams.into_iter().map(|t| t.id).collect()).unwrap_or_default();
    for f in [p.clone(), p.with_extension("json.tmp")] {
        match std::fs::remove_file(&f) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(e).with_context(|| format!("remove {}", f.display()));
            }
            _ => {}
        }
    }
    if let Ok(mut g) = cell().write() {
        *g = None;
    }
    // Back in the personal space: a team write asked before this is refused.
    SPACE_EPOCH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Ok(ids)
}

/// The token in the file on disk, for tests that check it is gone.
#[cfg(test)]
pub fn has_token(team_id: &str) -> bool {
    let on_disk = path().ok().and_then(|p| std::fs::read(p).ok());
    let saved: Option<Saved> = on_disk.and_then(|b| serde_json::from_slice(&b).ok());
    saved.is_some_and(|s| s.tokens.contains_key(team_id))
}

/// As after a restart: the next read comes from the file.
#[cfg(test)]
pub fn drop_cache() {
    if let Ok(mut g) = cell().write() {
        *g = None;
    }
}

/// Point a joined team at another address, as if its server moved there.
#[cfg(test)]
pub fn set_server(team_id: &str, server: &str) {
    let _edit = edit_lock();
    let mut s = load().unwrap();
    for t in s.teams.iter_mut().filter(|t| t.id == team_id) {
        t.server = server.to_string();
    }
    save(&s).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_space_round_trips_through_its_saved_shape() {
        let s = Space::Team { team_id: "t1".into() };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, r#"{"kind":"team","team_id":"t1"}"#);
        assert_eq!(serde_json::from_str::<Space>(&json).unwrap(), s);
        assert_eq!(
            serde_json::from_str::<Space>(r#"{"kind":"personal"}"#).unwrap(),
            Space::Personal
        );
    }

    #[test]
    fn the_interface_never_gets_a_token() {
        let link = TeamLink {
            id: "t1".into(),
            name: "Ads team".into(),
            server: "https://t".into(),
            admin: false,
            member_id: "m1".into(),
            perm_key: "EYesvvFdGqLWWIp3nlrH8SAjRAHTTX-_lOKR9mnVgiM".into(),
            revoked: false,
            needs_invite: false,
        };
        let shown = serde_json::to_string(&SpaceState {
            space: Space::Personal,
            teams: vec![link],
            device_name: "Vera's MacBook".into(),
            epoch: 1,
            team_status: None,
        })
        .unwrap();
        assert!(!shown.contains("token"), "{shown}");
        assert!(!shown.contains("stm_"), "{shown}");
    }

    #[test]
    fn a_link_saved_before_keys_reads_as_one_with_no_key() {
        let old = r#"{"id":"t1","name":"Ads","server":"http://203.0.113.7:8787","admin":false}"#;
        let link: TeamLink = serde_json::from_str(old).unwrap();
        assert_eq!((link.perm_key.as_str(), link.member_id.as_str(), link.revoked), ("", "", false));
        assert!(!link.needs_invite);
    }

    #[test]
    fn waiting_for_a_new_invite_is_shown_only_when_it_is_so() {
        let mut link: TeamLink = serde_json::from_str(r#"{"id":"t1","name":"Ads","server":"http://t"}"#).unwrap();
        assert!(!serde_json::to_string(&link).unwrap().contains("needs_invite"));
        link.needs_invite = true;
        let shown = serde_json::to_value(&link).unwrap();
        assert_eq!(shown["needs_invite"], true);
        assert_eq!(shown["revoked"], false, "not a withdrawal");
    }

    #[test]
    fn a_loss_is_saved_only_against_the_token_still_kept() {
        let _root = crate::store::test_root("team-loss").with_config();
        let server = "http://203.0.113.7:8787";
        {
            let _edit = edit_lock();
            let mut s = load().unwrap();
            let link: TeamLink = serde_json::from_value(serde_json::json!({ "id": "t1", "name": "Ads", "server": server })).unwrap();
            s.teams.push(link);
            s.tokens.insert("t1".into(), "stm_new".into());
            s.space = Space::Team { team_id: "t1".into() };
            save(&s).unwrap();
        }
        // Lost with the old token, after the new invite was pasted: the new one stays.
        let old = |_: &str, token: &str| token == "stm_old";
        assert!(token_replaced("t1", old).unwrap().is_none());
        assert!(revoke("t1", old).unwrap().is_none());
        let kept = link("t1").unwrap().unwrap();
        assert!(!kept.revoked && !kept.needs_invite && has_token("t1"));
        assert_eq!(state().unwrap().space, Space::Team { team_id: "t1".into() });

        let new = |at: &str, token: &str| at == server && token == "stm_new";
        assert_eq!(token_replaced("t1", new).unwrap().unwrap().space, Space::Personal);
        assert!(link("t1").unwrap().unwrap().needs_invite && !has_token("t1"));
        // Heard again, it changes nothing.
        assert!(revoke("t1", new).unwrap().is_none());
        assert!(!link("t1").unwrap().unwrap().revoked);
        let err = set_space(Space::Team { team_id: "t1".into() }).unwrap_err().to_string();
        assert_eq!(err, "Ads: the server does not know this token any more: paste the new invite from the team's admin");
        assert!(reach("t1").err().unwrap().to_string().contains("does not know this token"));
    }

    #[test]
    fn a_server_is_an_http_or_https_address() {
        assert_eq!(server_base("https://team.example.com/").unwrap(), "https://team.example.com");
        assert_eq!(server_base("http://203.0.113.7:8787").unwrap(), "http://203.0.113.7:8787");
        assert!(server_base("ftp://team.example.com").is_err());
        assert!(server_base("team.example.com").is_err());
    }

    /// Settings carried to another computer: a new device id there, and the old
    /// name with it goes; the computer they were made on keeps its own.
    #[test]
    fn a_device_id_stays_with_the_computer_it_was_made_on() {
        let root = crate::store::test_root("team-machine").with_config();
        machine::force(Some(Some("mac-1")));
        set_device_name("Vera's MacBook").unwrap();
        let first = device_id();
        let file = path().unwrap();
        let other = root.path.join("other-config");
        std::fs::create_dir_all(other.join("local")).unwrap();
        std::fs::copy(&file, other.join("local/teams.json")).unwrap();

        // The copy read on another computer.
        crate::store::set_test_config(Some(other.clone()));
        machine::force(Some(Some("mac-2")));
        let moved = device_id();
        assert!(!moved.is_empty() && moved != first);
        assert_ne!(device_name(), "Vera's MacBook");
        // Read again there: the same.
        crate::store::set_test_config(Some(root.path.join("config")));
        machine::force(Some(Some("mac-1")));
        assert_eq!(device_id(), first, "the first computer keeps its id and name");
        assert_eq!(device_name(), "Vera's MacBook");
        crate::store::set_test_config(Some(other));
        machine::force(Some(Some("mac-2")));
        assert_eq!(device_id(), moved);
        // A computer whose id cannot be read changes nothing.
        machine::force(Some(None));
        crate::store::set_test_config(Some(root.path.join("config")));
        assert_eq!(device_id(), first);
        machine::force(None);
        drop(root);
    }

    #[test]
    fn a_device_has_a_name() {
        assert!(!device_name().is_empty());
    }

    #[test]
    fn a_test_cannot_reach_the_real_teams_file() {
        assert!(state().is_err());
    }

    #[test]
    fn the_teams_file_stays_on_this_machine() {
        let root = crate::store::test_root("team-local").with_config();
        let at = path().unwrap();
        assert_eq!(at, crate::store::local_root().unwrap().join("teams.json"));
        assert_ne!(at.parent(), Some(crate::store::config_root().unwrap().as_path()));
        drop(root);
    }
}
