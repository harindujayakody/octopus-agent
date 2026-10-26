//! The live channel to each team joined: one socket a team, opened again with
//! backoff when it drops. It keeps the team's permission current, closes what
//! the team no longer lets stay open, and carries out a revocation or a new token.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use tokio::sync::mpsc;

use super::client::{Heard, LiveEvent, TeamClient, TeamError};
use super::perm;

/// How often the socket is pinged, and how long it may say nothing at all.
const PING_EVERY: Duration = Duration::from_secs(20);
const SILENT_FOR: Duration = Duration::from_secs(60);
/// Waits before opening it again: from the first to the last, doubling.
const FIRST_RETRY: Duration = Duration::from_millis(500);
const LAST_RETRY: Duration = Duration::from_secs(30);
/// A permission is never asked for more often than this.
const MIN_REFRESH: Duration = Duration::from_secs(5);

/// How the live channel tells the windows: an event name and its payload.
pub type Tell = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

fn app_tell() -> &'static OnceLock<Tell> {
    static TELL: OnceLock<Tell> = OnceLock::new();
    &TELL
}

/// Set once at start: how the app's windows are told.
pub fn set_tell(tell: Tell) {
    let _ = app_tell().set(tell);
}

pub(super) fn default_tell() -> Tell {
    app_tell().get().cloned().unwrap_or_else(|| Arc::new(|_: &str, _| {}))
}

enum Nudge {
    /// A call met a 401, token_replaced or switched_off: ask the server again.
    Confirm,
    Stop,
}

/// The followed teams, each with the way to nudge its task.
fn followers() -> MutexGuard<'static, HashMap<String, mpsc::UnboundedSender<Nudge>>> {
    static MAP: OnceLock<Mutex<HashMap<String, mpsc::UnboundedSender<Nudge>>>> = OnceLock::new();
    MAP.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// Follow every team joined and not withdrawn, in use or not, and stop
/// following any other: a team can withdraw this member at any time.
pub fn follow_joined() {
    let joined = crate::team::followed();
    let mut f = followers();
    f.retain(|id, tx| {
        let keep = joined.contains(id);
        if !keep {
            let _ = tx.send(Nudge::Stop);
        }
        keep
    });
    for id in joined {
        start(&mut f, &id, default_tell());
    }
}

/// Joined again, maybe as someone else: the old channel and permission go.
pub fn rejoined(team_id: &str) {
    restart(team_id, default_tell());
}

fn restart(team_id: &str, tell: Tell) {
    let mut f = followers();
    if let Some(tx) = f.remove(team_id) {
        let _ = tx.send(Nudge::Stop);
    }
    perm::forget(team_id);
    start(&mut f, team_id, tell);
}

fn start(f: &mut HashMap<String, mpsc::UnboundedSender<Nudge>>, team_id: &str, tell: Tell) {
    if f.get(team_id).is_some_and(|tx| !tx.is_closed()) {
        return;
    }
    let (tx, rx) = mpsc::unbounded_channel();
    f.insert(team_id.to_string(), tx);
    spawn(run(team_id.to_string(), tell, rx));
}

/// A test's follower, telling its own list instead of the app.
#[cfg(test)]
pub(super) fn follow_with(team_id: &str, tell: Tell) {
    start(&mut followers(), team_id, tell);
}

/// A call to the team met a 401 or switched_off. The team's follower asks
/// again; with none running, a task of its own does.
pub fn access_lost(team_id: &str) {
    if followers().get(team_id).is_some_and(|tx| tx.send(Nudge::Confirm).is_ok()) {
        return;
    }
    let (team_id, tell) = (team_id.to_string(), default_tell());
    spawn(async move {
        let Ok(client) = TeamClient::for_team(&team_id) else { return };
        let client = client.quiet();
        if let Some(loss) = confirmed_lost(&client).await {
            lose(&client, loss, &tell);
        }
    });
}

/// On the runtime of the caller when there is one, else on the app's.
pub(super) fn spawn(f: impl Future<Output = ()> + Send + 'static) {
    match tokio::runtime::Handle::try_current() {
        Ok(rt) => drop(rt.spawn(f)),
        Err(_) => drop(tauri::async_runtime::spawn(f)),
    }
}

/// What the team took away, as the server said or confirmed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Loss {
    /// Switched off or removed.
    Withdrawn,
    /// The token was re-issued: still a member, under the new invite.
    Replaced,
}

/// How a connection ended.
enum Ended {
    Stop,
    /// The server said so, or a second ask confirmed it.
    Gone(Loss),
    /// A 401, token_replaced or switched_off, not confirmed yet.
    Lost,
    /// The link broke or the permission did not check out: try again later.
    Dropped,
}

async fn run(team_id: String, tell: Tell, mut nudges: mpsc::UnboundedReceiver<Nudge>) {
    let mut wait = Backoff::new();
    let mut warned = false;
    loop {
        // Left, withdrawn or waiting for a new invite: nothing to follow.
        let Ok(client) = TeamClient::for_team(&team_id) else { break };
        let client = client.quiet();
        let gone = match connected(&client, &team_id, &tell, &mut nudges, &mut wait, &mut warned).await {
            Ended::Stop => break,
            Ended::Gone(loss) => Some(loss),
            Ended::Lost => confirmed_lost(&client).await,
            Ended::Dropped => None,
        };
        if let Some(loss) = gone {
            lose(&client, loss, &tell);
            break;
        }
        tokio::select! {
            _ = tokio::time::sleep(wait.next()) => {}
            n = nudges.recv() => match n {
                None | Some(Nudge::Stop) => break,
                Some(Nudge::Confirm) => {
                    if let Some(loss) = confirmed_lost(&client).await {
                        lose(&client, loss, &tell);
                        break;
                    }
                }
            },
        }
    }
    drop(nudges);
    followers().retain(|_, tx| !tx.is_closed());
}

async fn connected(
    client: &TeamClient,
    team_id: &str,
    tell: &Tell,
    nudges: &mut mpsc::UnboundedReceiver<Nudge>,
    wait: &mut Backoff,
    warned: &mut bool,
) -> Ended {
    // The socket first: a change made while the permission comes still arrives.
    let mut socket = match client.live().await {
        Ok(s) => s,
        Err(e) => return ended_by(team_id, &e),
    };
    if let Err(end) = refresh(client, team_id, warned, tell).await {
        return end;
    }
    wait.reset();
    // What changed while the socket was down was not heard: read it all again.
    super::cache::heard_all(team_id, tell);
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ping.tick().await;
    let mut heard_at = Instant::now();
    loop {
        let due = perm::refresh_in(team_id).unwrap_or(Duration::ZERO).max(MIN_REFRESH);
        let renew = tokio::select! {
            heard = socket.hear() => {
                heard_at = Instant::now();
                match heard {
                    Heard::Closed => return Ended::Dropped,
                    Heard::Event(LiveEvent::Revoked) => return Ended::Gone(Loss::Withdrawn),
                    Heard::Event(LiveEvent::TokenReplaced) => return Ended::Gone(Loss::Replaced),
                    Heard::Event(LiveEvent::GrantsChanged { epoch }) => {
                        perm::held_epoch(team_id).is_none_or(|held| held < epoch)
                    }
                    Heard::Event(LiveEvent::TeamChanged { what }) if what == "team" => {
                        renamed(client, team_id, tell).await;
                        false
                    }
                    // Nothing here keeps the trash: the Team page reads it again, for the team in use.
                    Heard::Event(LiveEvent::TeamChanged { what }) if what == "trash" => {
                        if crate::team::active_team().as_deref() == Some(team_id) {
                            tell("store-changed", serde_json::json!("team-trash"));
                        }
                        false
                    }
                    Heard::Event(LiveEvent::TeamChanged { what }) => {
                        super::cache::heard(team_id, &what, tell);
                        false
                    }
                    // The member's own space: sync reads it again, when it follows this team.
                    Heard::Event(LiveEvent::PersonalChanged { .. }) => {
                        super::sync::heard_from(team_id);
                        false
                    }
                    Heard::Event(LiveEvent::Other) | Heard::Alive => false,
                }
            }
            n = nudges.recv() => match n {
                None | Some(Nudge::Stop) => return Ended::Stop,
                Some(Nudge::Confirm) => {
                    if let Some(loss) = confirmed_lost(client).await {
                        return Ended::Gone(loss);
                    }
                    false
                }
            },
            _ = tokio::time::sleep(due) => true,
            _ = ping.tick() => {
                if heard_at.elapsed() > SILENT_FOR || !socket.ping().await {
                    return Ended::Dropped;
                }
                // After a sleep the timer above may be behind the boot clock.
                perm::refresh_in(team_id).is_none_or(|d| d.is_zero())
            }
        };
        if renew {
            if let Err(end) = refresh(client, team_id, warned, tell).await {
                return end;
            }
        }
    }
}

/// Ask for the permission now and hold it once it checks out; a new edition
/// rechecks what is open.
async fn refresh(client: &TeamClient, team_id: &str, warned: &mut bool, tell: &Tell) -> Result<(), Ended> {
    let issued = client.permission().await.map_err(|e| ended_by(team_id, &e))?;
    let before = perm::held_epoch(team_id);
    match perm::accept(team_id, &issued.permission) {
        Ok(epoch) => {
            if before != Some(epoch) {
                recheck_open(client, team_id).await;
                // What the member sees moved with the rules.
                super::cache::heard_all(team_id, tell);
            }
            Ok(())
        }
        // Left, or joined again as someone else: no longer this team's channel.
        Err(_) if !client.is_current() => Err(Ended::Stop),
        Err(why) => {
            eprintln!("[launcher] team {team_id}: {why}");
            if !std::mem::replace(warned, true) {
                crate::notify_warning(format!("The team's permission did not check out: {why}"));
            }
            Err(Ended::Dropped)
        }
    }
}

fn ended_by(team_id: &str, e: &TeamError) -> Ended {
    if e.access_lost() {
        Ended::Lost
    } else {
        eprintln!("[launcher] team {team_id}: {e}");
        Ended::Dropped
    }
}

/// A second `GET /permission`, which also says which loss: it counts only when
/// it says the same, and the server there is still this team, not a fresh one.
async fn confirmed_lost(client: &TeamClient) -> Option<Loss> {
    let loss = match client.permission().await {
        Err(e) if e.token_replaced() => Loss::Replaced,
        Err(e) if e.access_lost() => Loss::Withdrawn,
        _ => return None,
    };
    if client.same_team().await {
        return Some(loss);
    }
    static TOLD: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    let link = client.team().and_then(|id| crate::team::link(id).ok().flatten());
    if let Some(link) = link {
        let first = TOLD.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner()).insert(link.id);
        if first {
            crate::notify_warning(format!(
                "{} at {} answers as another team now: was it started without its data?",
                link.name, link.server
            ));
        }
    }
    None
}

/// Carry out a loss, if this client's token is still the one kept: a join
/// since then is not what was lost. Checked where the loss is saved.
fn lose(client: &TeamClient, loss: Loss, tell: &Tell) {
    let Some(team_id) = client.team() else { return };
    let lost = |server: &str, token: &str| client.made_with(server, token);
    match loss {
        Loss::Withdrawn => revoke(team_id, lost, tell),
        Loss::Replaced => replaced(team_id, lost, tell),
    }
}

/// The team was renamed: the name kept here follows it.
async fn renamed(client: &TeamClient, team_id: &str, tell: &Tell) {
    let info = match super::admin::team_info(client).await {
        Ok(info) if info.id == team_id => info,
        Ok(_) => return,
        Err(e) => {
            eprintln!("[launcher] team {team_id}: its new name was not read: {e}");
            return;
        }
    };
    match crate::team::rename(team_id, &info.name) {
        Ok(true) => tell_space(tell),
        Ok(false) => {}
        Err(e) => eprintln!("[launcher] team {team_id}: its new name was not saved: {e:#}"),
    }
}

fn tell_space(tell: &Tell) {
    if let Ok(st) = crate::team::state() {
        tell("space-changed", serde_json::to_value(&st.space).unwrap_or_default());
    }
}

/// A team profile open on this device, as the recheck needs it.
#[derive(Debug, Clone)]
pub struct Open {
    pub id: String,
    /// Started with CDP, which reads every cookie.
    pub cdp: bool,
}

fn open_now() -> MutexGuard<'static, HashMap<String, Vec<Open>>> {
    static OPEN: OnceLock<Mutex<HashMap<String, Vec<Open>>>> = OnceLock::new();
    OPEN.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// A team profile opened here, rechecked on every new permission.
pub fn opened(team_id: &str, open: Open) {
    let mut all = open_now();
    let list = all.entry(team_id.to_string()).or_default();
    list.retain(|o| o.id != open.id);
    list.push(open);
}

/// Closed here: nothing more to recheck.
pub fn closed(team_id: &str, id: &str) {
    if let Some(list) = open_now().get_mut(team_id) {
        list.retain(|o| o.id != id);
    }
}

fn open_in(team_id: &str) -> Vec<Open> {
    open_now().get(team_id).cloned().unwrap_or_default()
}

/// Close what the team no longer lets stay open: out of sight, no Start, or CDP
/// without Cookies. By the server's rows: a permission names nothing hidden.
async fn recheck_open(client: &TeamClient, team_id: &str) {
    let open = open_in(team_id);
    if open.is_empty() {
        return;
    }
    let ids: Vec<&str> = open.iter().map(|o| o.id.as_str()).collect();
    let seen = match perm::look(client, team_id, &ids).await {
        Ok(seen) => seen,
        Err(e) => {
            eprintln!("[launcher] team {team_id}: open profiles not rechecked: {e:#}");
            return;
        }
    };
    for o in &open {
        let keep = seen.iter().find(|s| s.id() == o.id).is_some_and(|s| {
            perm::team_pass::<perm::Start>(team_id, s).is_ok()
                && (!o.cdp || perm::team_pass::<perm::Cookies>(team_id, s).is_ok())
        });
        if !keep {
            close_team_profile(team_id, &o.id);
        }
    }
}

/// A team profile the team took back closes, with upload: the member worked
/// on it rightfully. Then its copy is wiped.
fn close_team_profile(team_id: &str, id: &str) {
    eprintln!("[launcher] team {team_id}: {id} may no longer stay open here");
    closed(team_id, id);
    super::open::close(&super::open::Home::team(team_id), id, super::open::End::Upload);
}

/// The team withdrew this member: nothing of it stays here.
fn revoke(team_id: &str, lost: impl Fn(&str, &str) -> bool, tell: &Tell) {
    let name = crate::team::link(team_id).ok().flatten().map(|t| t.name);
    let Some(saved) = crate::team::revoke(team_id, lost).transpose() else { return };
    close_and_wipe_open_team_profiles(team_id);
    perm::forget(team_id);
    super::cache::forget(team_id);
    super::secrets::forget(team_id);
    match saved {
        Ok(st) => {
            tell("space-changed", serde_json::to_value(&st.space).unwrap_or_default());
            let name = name.unwrap_or_else(|| "A team".into());
            crate::notify_warning(format!("{name} withdrew this launcher's access."));
        }
        Err(e) => eprintln!("[launcher] team {team_id} withdrew access, and saving that failed: {e:#}"),
    }
}

/// The team's profiles open on this device close without upload, and their
/// copies are wiped.
fn close_and_wipe_open_team_profiles(team_id: &str) {
    open_now().remove(team_id);
    super::open::close_team(team_id, super::open::End::Discard);
}

/// The admin re-issued this member's token: it is dropped, and the team waits
/// for the new invite. Nothing is wiped: the member is still in the team.
fn replaced(team_id: &str, lost: impl Fn(&str, &str) -> bool, tell: &Tell) {
    let name = crate::team::link(team_id).ok().flatten().map(|t| t.name);
    let Some(saved) = crate::team::token_replaced(team_id, lost).transpose() else { return };
    close_open_team_profiles(team_id);
    perm::forget(team_id);
    super::cache::forget(team_id);
    match saved {
        Ok(st) => {
            tell("space-changed", serde_json::to_value(&st.space).unwrap_or_default());
            let name = name.unwrap_or_else(|| "A team".into());
            crate::notify_warning(format!("{name} replaced this launcher's invite: paste the new one from the team's admin."));
        }
        Err(e) => eprintln!("[launcher] team {team_id} replaced this token, and saving that failed: {e:#}"),
    }
}

/// The team's profiles open on this device close; their copies stay for the
/// new invite, which sends them back.
fn close_open_team_profiles(team_id: &str) {
    open_now().remove(team_id);
    super::open::close_team(team_id, super::open::End::Keep);
}

/// Waits between tries, doubling, a little uneven so a team's launchers do
/// not all come back in the same second.
struct Backoff {
    next: Duration,
}

impl Backoff {
    fn new() -> Self {
        Backoff { next: FIRST_RETRY }
    }

    fn reset(&mut self) {
        self.next = FIRST_RETRY;
    }

    fn next(&mut self) -> Duration {
        let d = self.next;
        self.next = (d * 2).min(LAST_RETRY);
        let spread = (uuid::Uuid::new_v4().as_u128() % 401) as f64 / 1000.0;
        d.mul_f64(0.8 + spread)
    }
}

#[cfg(test)]
mod tests {
    use super::super::client::{Code, Method};
    use super::*;
    use crate::team::{self, Space};
    use serde_json::{json, Value};
    use shardbrowser_team_server::{Action, Grant, NewMember, Scope, TestServer};

    fn allow(action: Action) -> Grant {
        Grant { scope: Scope::Team, action, allow: true }
    }

    /// A member of a real team server in-process, joined from this launcher.
    struct Joined {
        // Stopped before its data goes with the root.
        srv: TestServer,
        root: crate::store::TestRoot,
        team_id: String,
        vera: NewMember,
        told: Arc<Mutex<Vec<(String, Value)>>>,
    }

    impl Joined {
        async fn new(grants: &[Grant]) -> Joined {
            let root = crate::store::test_root("team-live").with_config();
            let srv = TestServer::start(root.path.join("server")).await.unwrap();
            let vera = srv.add_member("Vera", grants).unwrap();
            team::join(&srv.url, &vera.token).await.unwrap();
            let team_id = srv.server.team_id().to_string();
            Joined { srv, root, team_id, vera, told: Default::default() }
        }

        /// What the windows were told, the lists' own reloads aside.
        fn spoken(&self) -> Vec<(String, Value)> {
            let told = self.told.lock().unwrap();
            told.iter().filter(|(e, _)| e != "store-changed" && e != "team-status").cloned().collect()
        }

        fn follow(&self) {
            let told = self.told.clone();
            follow_with(
                &self.team_id,
                Arc::new(move |event: &str, payload| told.lock().unwrap().push((event.to_string(), payload))),
            );
        }

        fn admin(&self) -> TeamClient {
            TeamClient::new(&self.srv.url, &self.srv.admin_token, "admin-device").unwrap()
        }

        fn member(&self) -> TeamClient {
            TeamClient::for_team(&self.team_id).unwrap()
        }

        /// A team profile, made by the admin.
        async fn make_profile(&self, id: &str, folder: &str) {
            let body = json!({ "name": id, "folder": folder, "data": "" });
            self.admin().call(Method::PUT, &format!("/profiles/{id}"), Some(&body)).await.unwrap();
        }

        /// Her pass on a profile, as the server lists it to her now.
        async fn pass<A: perm::Right>(&self, id: &str) -> bool {
            let seen = perm::look(&self.member(), &self.team_id, &[id]).await.unwrap();
            seen.first().is_some_and(|s| perm::team_pass::<A>(&self.team_id, s).is_ok())
        }

        fn open_ids(&self) -> Vec<String> {
            let mut ids: Vec<String> = open_in(&self.team_id).into_iter().map(|o| o.id).collect();
            ids.sort();
            ids
        }

        async fn set_grants(&self, grants: &[Grant]) -> u64 {
            let path = format!("/admin/members/{}/grants", self.vera.id);
            let body = json!({ "grants": grants });
            let (_, answer) = self.admin().call(Method::PUT, &path, Some(&body)).await.unwrap();
            serde_json::from_slice::<Value>(&answer).unwrap()["epoch"].as_u64().unwrap()
        }

        fn link(&self) -> team::TeamLink {
            team::link(&self.team_id).unwrap().unwrap()
        }

        fn still_joined(&self) {
            assert!(!self.link().revoked);
            assert!(team::has_token(&self.team_id));
            assert_eq!(team::state().unwrap().space, Space::Team { team_id: self.team_id.clone() });
        }

        fn withdrawn(&self) -> bool {
            self.link().revoked
        }

        fn assert_withdrawn(&self) {
            assert!(self.link().revoked);
            assert!(!team::has_token(&self.team_id), "the token is forgotten");
            assert_eq!(team::state().unwrap().space, Space::Personal);
            assert!(TeamClient::for_team(&self.team_id).is_err(), "nothing reaches the team now");
            assert_eq!(perm::held_epoch(&self.team_id), None);
            assert!(team::set_space(Space::Team { team_id: self.team_id.clone() }).is_err());
        }
    }

    /// Wait for `check`, failing past `within`.
    async fn until(what: &str, within: Duration, mut check: impl FnMut() -> bool) -> Duration {
        let start = Instant::now();
        while !check() {
            assert!(start.elapsed() < within, "{what}: not within {within:?}");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        start.elapsed()
    }

    #[tokio::test]
    async fn joining_asks_the_server_who_the_token_is() {
        let root = crate::store::test_root("team-join").with_config();
        let srv = TestServer::start(root.path.join("server")).await.unwrap();
        let vera = srv.add_member("Vera", &[allow(Action::See)]).unwrap();

        let err = team::join(&srv.url, "stm_nobody").await.unwrap_err().to_string();
        assert!(err.contains("does not know this token"), "{err}");
        let err = team::join(&format!("{}/nothing", srv.url), &vera.token).await.unwrap_err().to_string();
        assert!(err.contains("not an Octopus Agent team server"), "{err}");
        let err = team::join("http://127.0.0.1:1", &vera.token).await.unwrap_err().to_string();
        assert!(err.contains("did not answer"), "{err}");
        assert!(team::state().unwrap().teams.is_empty(), "a failed join keeps nothing");

        let st = team::join(&srv.url, &vera.token).await.unwrap();
        let team_id = srv.server.team_id().to_string();
        assert_eq!(st.space, Space::Team { team_id: team_id.clone() });
        let link = &st.teams[0];
        assert_eq!((link.id.as_str(), link.name.as_str()), (team_id.as_str(), "Team"));
        assert_eq!(link.member_id, vera.id);
        assert_eq!(link.perm_key, srv.server.public_key());
        assert!(!link.admin && !link.revoked);
        assert!(team::has_token(&team_id));

        // The admin token joins as the admin principal.
        let st = team::join(&srv.url, &srv.admin_token).await.unwrap();
        assert_eq!(st.teams.len(), 1, "the same team, joined again");
        assert_eq!(st.teams[0].member_id, team_model::ADMIN_ID);
        assert!(st.teams[0].admin);
    }

    #[tokio::test]
    async fn a_permission_is_believed_only_from_the_team_and_for_us() {
        let t = Joined::new(&[allow(Action::See)]).await;
        let issued = t.member().permission().await.unwrap();
        let epoch = perm::accept(&t.team_id, &issued.permission).unwrap();
        assert_eq!(perm::held_epoch(&t.team_id), Some(epoch));

        // Another member's permission from the same team.
        let ivan = t.srv.add_member("Ivan", &[allow(Action::See)]).unwrap();
        let his = TeamClient::new(&t.srv.url, &ivan.token, "d").unwrap().permission().await.unwrap();
        assert_eq!(perm::accept(&t.team_id, &his.permission), Err(perm::Rejected::OtherMember));

        // Another server's, signed with its own key.
        let other = TestServer::start(t.root.path.join("other")).await.unwrap();
        let m = other.add_member("Vera", &[allow(Action::See)]).unwrap();
        let foreign = TeamClient::new(&other.url, &m.token, "d").unwrap().permission().await.unwrap();
        assert_eq!(perm::accept(&t.team_id, &foreign.permission), Err(perm::Rejected::Signature));
        assert_eq!(perm::held_epoch(&t.team_id), Some(epoch), "a refused one replaces nothing");
    }

    #[tokio::test]
    async fn a_change_of_rules_brings_a_new_permission_within_a_second() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.make_profile("p1", "").await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        let before = perm::look(&t.member(), &t.team_id, &["p1"]).await.unwrap();
        assert!(perm::team_pass::<perm::Start>(&t.team_id, &before[0]).is_err());

        let epoch = t.set_grants(&[allow(Action::See), allow(Action::Start)]).await;
        let took = until("the new permission", Duration::from_secs(1), || {
            perm::held_epoch(&t.team_id) == Some(epoch)
        })
        .await;
        assert!(took < Duration::from_secs(1), "{took:?}");
        assert!(t.pass::<perm::Start>("p1").await);
        // A look from under the old rules is not a pass under the new ones,
        // and says so, so the caller can look again instead of refusing.
        assert!(perm::team_pass::<perm::Start>(&t.team_id, &before[0]).is_err());
        assert!(perm::moved_since(&t.team_id, &before[0]));
        let now = perm::look(&t.member(), &t.team_id, &["p1"]).await.unwrap();
        assert!(!perm::moved_since(&t.team_id, &now[0]));
        assert!(perm::team_pass::<perm::Start>(&t.team_id, &now[0]).is_ok());
        assert!(t.spoken().is_empty());
    }

    #[tokio::test]
    async fn an_open_profile_the_team_takes_back_is_let_go() {
        let all = [allow(Action::See), allow(Action::Start), allow(Action::Cookies)];
        let t = Joined::new(&all).await;
        let open = [("p1", "Ads", true), ("p2", "Ads", true), ("p3", "Ads", false), ("p4", "Secret", false), ("p5", "Ads", true)];
        for (id, folder, cdp) in open {
            t.make_profile(id, folder).await;
            opened(&t.team_id, Open { id: id.into(), cdp });
        }
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        assert_eq!(t.open_ids(), ["p1", "p2", "p3", "p4", "p5"]);

        // Out of sight: p1 by its own refusal, p4 by its folder's. The permission
        // cannot name either, so only the server's own rows tell.
        let refuse = |scope: Scope, action| Grant { scope, action, allow: false };
        let id = |id: &str| Scope::Profile { id: id.into() };
        let mut rules = all.to_vec();
        rules.extend([
            refuse(id("p1"), Action::See),
            refuse(id("p2"), Action::Cookies),
            refuse(id("p3"), Action::Cookies),
            refuse(Scope::Folder { name: "Secret".into() }, Action::See),
        ]);
        t.set_grants(&rules).await;
        // p2 has CDP and no Cookies now; p3 started without it, so it stays.
        until("the profiles let go", Duration::from_secs(2), || t.open_ids() == ["p3", "p5"]).await;
        t.still_joined();
    }

    #[tokio::test]
    async fn an_open_profile_moved_out_of_sight_is_let_go_though_her_rules_stay() {
        let ads = |action| Grant { scope: Scope::Folder { name: "Ads".into() }, action, allow: true };
        let t = Joined::new(&[ads(Action::See), ads(Action::Start), ads(Action::Cookies)]).await;
        for id in ["p1", "p2"] {
            t.make_profile(id, "Ads").await;
            opened(&t.team_id, Open { id: id.into(), cdp: true });
        }
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        let epoch = perm::held_epoch(&t.team_id).unwrap();

        let body = json!({ "name": "p1", "folder": "Hidden", "data": "", "base_revision": 1 });
        t.admin().call(Method::PUT, "/profiles/p1", Some(&body)).await.unwrap();
        until("p1 let go", Duration::from_secs(2), || t.open_ids() == ["p2"]).await;
        assert!(perm::held_epoch(&t.team_id).unwrap() > epoch, "what she sees moved, so the edition did");
    }

    #[tokio::test]
    async fn a_dropped_socket_is_opened_again() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        // The server keeps eight sockets a member and closes the oldest past that.
        let mut others = Vec::new();
        for _ in 0..8 {
            let c = TeamClient::new(&t.srv.url, &t.vera.token, "another-device").unwrap();
            others.push(c.live().await.unwrap());
        }
        // The follower's socket was the oldest. Its new one pushes out the next oldest.
        let first = tokio::time::timeout(Duration::from_secs(3), others[0].hear()).await;
        assert!(matches!(first, Ok(Heard::Closed)), "the follower did not open a new socket");
        let epoch = t.set_grants(&[allow(Action::See), allow(Action::Start)]).await;
        until("the permission after a reconnect", Duration::from_secs(5), || {
            perm::held_epoch(&t.team_id) == Some(epoch)
        })
        .await;
        t.still_joined();
    }

    #[tokio::test]
    async fn a_401_withdraws_the_team_only_once_the_server_confirms_it() {
        let t = Joined::new(&[allow(Action::See)]).await;

        // An admin route answers a member 401, but the token itself is fine.
        let err = t.member().call(Method::GET, "/admin/members", None).await.unwrap_err();
        assert!(err.access_lost(), "{err}");
        tokio::time::sleep(Duration::from_millis(300)).await;
        t.still_joined();

        // Removed with no live socket open: the next call's 401 is the news.
        t.admin().call(Method::DELETE, &format!("/admin/members/{}", t.vera.id), None).await.unwrap();
        let err = t.member().call(Method::GET, "/profiles", None).await.unwrap_err();
        assert_eq!((err.status(), err.code()), (Some(401), Some(&Code::Unauthorized)));
        until("the withdrawal", Duration::from_secs(2), || t.withdrawn()).await;
        t.assert_withdrawn();
    }

    #[tokio::test]
    async fn another_team_at_the_address_withdraws_nothing() {
        let t = Joined::new(&[allow(Action::See)]).await;
        // The address now answers as a server started without its data: another
        // team, with a key of its own; her token never goes to it.
        let fresh = TestServer::start(t.root.path.join("fresh")).await.unwrap();
        team::set_server(&t.team_id, &fresh.url);
        let err = t.member().call(Method::GET, "/profiles", None).await.unwrap_err();
        assert!(err.to_string().starts_with(&format!("{} is not this team's server", fresh.url)), "{err}");
        assert!(!err.access_lost());
        tokio::time::sleep(Duration::from_millis(500)).await;
        t.still_joined();

        // Back at its own server, removed: the same 401 withdraws.
        team::set_server(&t.team_id, &t.srv.url);
        t.admin().call(Method::DELETE, &format!("/admin/members/{}", t.vera.id), None).await.unwrap();
        t.member().call(Method::GET, "/profiles", None).await.unwrap_err();
        until("the withdrawal", Duration::from_secs(2), || t.withdrawn()).await;
        t.assert_withdrawn();
    }

    #[tokio::test]
    async fn joining_again_as_someone_else_starts_the_channel_over() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.make_profile("p1", "").await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        assert!(!t.pass::<perm::Start>("p1").await);

        // The admin token, on the same team: what `team_join` does.
        team::join(&t.srv.url, &t.srv.admin_token).await.unwrap();
        let told = t.told.clone();
        restart(&t.team_id, Arc::new(move |e: &str, p| told.lock().unwrap().push((e.to_string(), p))));
        let start = Instant::now();
        while !(perm::held_epoch(&t.team_id).is_some() && t.pass::<perm::Start>("p1").await) {
            assert!(start.elapsed() < Duration::from_secs(5), "the admin's permission did not come");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        t.still_joined();
        assert!(t.spoken().is_empty());
    }

    #[tokio::test]
    async fn a_team_not_in_use_is_still_followed_and_withdrawn() {
        let t = Joined::new(&[allow(Action::See)]).await;
        team::set_space(Space::Personal).unwrap();
        assert_eq!(team::followed(), vec![t.team_id.clone()]);
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        let path = format!("/admin/members/{}", t.vera.id);
        t.admin().call(Method::PATCH, &path, Some(&json!({ "active": false }))).await.unwrap();
        until("the withdrawal", Duration::from_secs(2), || t.withdrawn()).await;
        t.assert_withdrawn();
        assert!(team::followed().is_empty());
    }

    #[tokio::test]
    async fn an_older_permission_is_refused_even_after_a_restart() {
        let t = Joined::new(&[allow(Action::See)]).await;
        let old = t.member().permission().await.unwrap().permission;
        perm::accept(&t.team_id, &old).unwrap();
        t.set_grants(&[allow(Action::See), allow(Action::Start)]).await;
        let new = t.member().permission().await.unwrap().permission;
        perm::accept(&t.team_id, &new).unwrap();
        assert_eq!(perm::accept(&t.team_id, &old), Err(perm::Rejected::Older));

        // As after a restart: nothing held, the file read again.
        perm::forget(&t.team_id);
        team::drop_cache();
        assert_eq!(perm::accept(&t.team_id, &old), Err(perm::Rejected::Older));
        assert!(perm::accept(&t.team_id, &new).is_ok(), "the newest edition again is fine");
    }

    #[tokio::test]
    async fn a_follower_meeting_a_401_confirms_it_and_withdraws() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.admin().call(Method::DELETE, &format!("/admin/members/{}", t.vera.id), None).await.unwrap();
        t.follow();
        until("the withdrawal", Duration::from_secs(2), || t.withdrawn()).await;
        t.assert_withdrawn();
        let told = t.spoken();
        assert_eq!(told, [("space-changed".to_string(), json!({ "kind": "personal" }))]);
    }

    #[tokio::test]
    async fn a_plain_refusal_withdraws_nothing() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;

        // No Create: making a profile is refused, and that is all it is.
        let body = json!({ "name": "New", "data": "" });
        let err = t.member().call(Method::PUT, "/profiles/p-new", Some(&body)).await.unwrap_err();
        assert_eq!((err.status(), err.code()), (Some(403), Some(&Code::Forbidden)), "{err}");
        assert!(!err.access_lost());
        tokio::time::sleep(Duration::from_millis(500)).await;
        t.still_joined();
        assert!(perm::held_epoch(&t.team_id).is_some());
        assert!(t.spoken().is_empty());
    }

    #[tokio::test]
    async fn a_switched_off_member_is_withdrawn_once_the_server_confirms_it() {
        let t = Joined::new(&[allow(Action::See)]).await;
        let path = format!("/admin/members/{}", t.vera.id);
        t.admin().call(Method::PATCH, &path, Some(&json!({ "active": false }))).await.unwrap();
        let err = t.member().call(Method::GET, "/profiles", None).await.unwrap_err();
        assert_eq!((err.status(), err.code()), (Some(403), Some(&Code::SwitchedOff)));
        until("the withdrawal", Duration::from_secs(2), || t.withdrawn()).await;
        t.assert_withdrawn();
    }

    #[tokio::test]
    async fn a_switch_off_told_down_the_live_socket_withdraws_at_once() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        let path = format!("/admin/members/{}", t.vera.id);
        t.admin().call(Method::PATCH, &path, Some(&json!({ "active": false }))).await.unwrap();
        // Sooner than a reconnect could find it out.
        until("the withdrawal", Duration::from_millis(300), || t.withdrawn()).await;
        t.assert_withdrawn();
        let told = t.spoken();
        assert_eq!(told, [("space-changed".to_string(), json!({ "kind": "personal" }))]);
    }

    impl Joined {
        /// The admin gives her a new token, as the Team page's re-issue does.
        async fn reissue(&self) -> String {
            let path = format!("/admin/members/{}/token", self.vera.id);
            let (_, answer) = self.admin().call(Method::POST, &path, None).await.unwrap();
            serde_json::from_slice::<Value>(&answer).unwrap()["token"].as_str().unwrap().to_string()
        }

        /// Dropped, waiting for the new invite, and not withdrawn.
        fn assert_waits_for_invite(&self) {
            let link = self.link();
            assert!(link.needs_invite && !link.revoked, "{link:?}");
            assert!(!team::has_token(&self.team_id), "the old token is forgotten");
            assert_eq!(team::state().unwrap().space, Space::Personal);
            let err = TeamClient::for_team(&self.team_id).err().unwrap().to_string();
            assert!(err.contains("new invite"), "{err}");
            assert_eq!(perm::held_epoch(&self.team_id), None);
            assert!(team::followed().is_empty());
            let err = team::set_space(Space::Team { team_id: self.team_id.clone() }).unwrap_err();
            assert!(err.to_string().contains("new invite"), "{err}");
        }
    }

    #[tokio::test]
    async fn a_token_reissued_down_the_live_socket_waits_for_the_new_invite() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        let token = t.reissue().await;
        until("the token dropped", Duration::from_millis(500), || t.link().needs_invite).await;
        t.assert_waits_for_invite();
        let told = t.spoken();
        assert_eq!(told, [("space-changed".to_string(), json!({ "kind": "personal" }))]);

        // The new invite brings the team back, as the same member.
        let st = team::join(&t.srv.url, &token).await.unwrap();
        assert_eq!(st.space, Space::Team { team_id: t.team_id.clone() });
        assert_eq!(st.teams[0].member_id, t.vera.id);
        t.still_joined();
        assert!(!t.link().needs_invite);
        assert_eq!(team::followed(), vec![t.team_id.clone()]);
    }

    #[tokio::test]
    async fn a_reissued_token_met_on_a_call_is_confirmed_and_waits_for_the_new_invite() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.reissue().await;
        let err = t.member().call(Method::GET, "/profiles", None).await.unwrap_err();
        assert_eq!((err.status(), err.code()), (Some(401), Some(&Code::TokenReplaced)));
        assert!(err.to_string().contains("does not know this token"), "{err}");
        until("the token dropped", Duration::from_secs(2), || t.link().needs_invite).await;
        t.assert_waits_for_invite();
    }

    #[tokio::test]
    async fn a_follower_opening_with_a_reissued_token_waits_for_the_new_invite() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.reissue().await;
        t.follow();
        until("the token dropped", Duration::from_secs(2), || t.link().needs_invite).await;
        t.assert_waits_for_invite();
        let told = t.spoken();
        assert_eq!(told, [("space-changed".to_string(), json!({ "kind": "personal" }))]);
    }

    #[tokio::test]
    async fn reissued_then_removed_is_a_withdrawal() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.reissue().await;
        t.admin().call(Method::DELETE, &format!("/admin/members/{}", t.vera.id), None).await.unwrap();
        let err = t.member().call(Method::GET, "/profiles", None).await.unwrap_err();
        assert_eq!(err.code(), Some(&Code::Unauthorized));
        until("the withdrawal", Duration::from_secs(2), || t.withdrawn()).await;
        t.assert_withdrawn();
        assert!(!t.link().needs_invite);
    }

    #[tokio::test]
    async fn a_reissue_heard_after_joining_with_the_new_invite_drops_nothing() {
        let t = Joined::new(&[allow(Action::See)]).await;
        // An old client, made before the new invite was pasted.
        let old = t.member().quiet();
        let token = t.reissue().await;
        team::join(&t.srv.url, &token).await.unwrap();
        let loss = confirmed_lost(&old).await;
        assert_eq!(loss, Some(Loss::Replaced));
        lose(&old, Loss::Replaced, &default_tell());
        t.still_joined();
        assert!(!t.link().needs_invite);
    }

    /// Sync through the team goes on with the new invite's token; joined as
    /// someone else, it keeps its own.
    #[tokio::test]
    async fn sync_through_the_team_follows_the_new_invite() {
        let t = Joined::new(&[allow(Action::See)]).await;
        team::sync_with_team(&t.team_id).unwrap();
        let token = t.reissue().await;
        team::join(&t.srv.url, &token).await.unwrap();
        assert!(TeamClient::for_sync().unwrap().made_with(&t.srv.url, &token));
        let other = t.srv.add_member("Ivan", &[]).unwrap();
        team::join(&t.srv.url, &other.token).await.unwrap();
        assert!(TeamClient::for_sync().unwrap().made_with(&t.srv.url, &token), "Ivan's token is not Vera's sync");
    }

    #[tokio::test]
    async fn a_renamed_team_is_renamed_here_too() {
        let t = Joined::new(&[allow(Action::See)]).await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        t.admin().call(Method::PATCH, "/admin/team", Some(&json!({ "name": "Growth" }))).await.unwrap();
        until("the new name", Duration::from_secs(1), || t.link().name == "Growth").await;
        let told = t.spoken();
        let here = json!({ "kind": "team", "team_id": t.team_id });
        assert_eq!(told, [("space-changed".to_string(), here)]);
        t.still_joined();
    }

    #[tokio::test]
    async fn the_team_page_hears_when_the_trash_changes() {
        let t = Joined::new(&[allow(Action::See), allow(Action::Delete)]).await;
        t.make_profile("p1", "").await;
        t.make_profile("p2", "").await;
        t.follow();
        until("the first permission", Duration::from_secs(5), || perm::held_epoch(&t.team_id).is_some()).await;
        let heard = || t.told.lock().unwrap().iter().any(|(e, p)| e == "store-changed" && p == "team-trash");
        // Followed but not in use (its sync, another team's page): not this page's news.
        team::set_space(Space::Personal).unwrap();
        t.admin().call(Method::DELETE, "/profiles/p2", None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(!heard(), "{:?}", t.told.lock().unwrap());
        team::set_space(Space::Team { team_id: t.team_id.clone() }).unwrap();
        t.admin().call(Method::DELETE, "/profiles/p1", None).await.unwrap();
        until("the trash news", Duration::from_secs(5), heard).await;
    }

    #[test]
    fn retries_double_up_to_a_cap_and_start_over_after_a_good_connection() {
        let mut b = Backoff::new();
        let waits: Vec<Duration> = (0..10).map(|_| b.next()).collect();
        assert!(waits[0] >= FIRST_RETRY.mul_f64(0.8) && waits[0] <= FIRST_RETRY.mul_f64(1.2));
        assert!(waits[3] >= FIRST_RETRY.mul_f64(8.0 * 0.8));
        assert!(waits.iter().all(|w| *w <= LAST_RETRY.mul_f64(1.2)));
        assert!(waits[9] >= LAST_RETRY.mul_f64(0.8));
        b.reset();
        assert!(b.next() <= FIRST_RETRY.mul_f64(1.2));
    }
}
