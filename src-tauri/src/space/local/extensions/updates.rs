//! Updates of library extensions linked to the Web Store (design §3.1.5, §3.2,
//! §3.7): the check, its record in `extension-updates.json`, Update and Link.
//! All of it goes through an [`Env`], so a test brings its own library,
//! record, store and browsers.

use super::manifest_edit::{self, Grant, Kinship};
use super::source::{self, How, SourceRef};
use super::swap::{self, Failure, Kind, Names, Ops, Order, Origin, Staged};
use super::update2::{self, Answer, AppAnswer, Flag, ProdVersion};
use super::usage::{self, Outcome, World};
use super::version::{newer, Version};
use super::{manifest_root, store_link, valid_id};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

/// The record's name in the data root; this computer's only.
pub const BOOK: &str = "extension-updates.json";
/// One request of the check, start to end.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// Asked when linking, so the store names its current version whatever is installed.
const ANY_VERSION: &str = "0.0.0.1";
const MB: u64 = 1 << 20;
/// Progress events at most this often, besides each new phase.
const TELL_EVERY: Duration = Duration::from_millis(200);

pub const UNLINKED: &str = "the extension is not linked to the Web Store yet: link it first";
pub const FLAGGED: &str = "the Web Store marks this extension as harmful, so it is not updated";
pub const BUSY: &str = "this extension is being updated already";
pub const CANCELLED: &str = "the update was cancelled";
pub const NOT_IN_LIBRARY: &str = "the extension is not in the library";
pub const NOT_A_LINK: &str = "that is not a Web Store link or extension id";
pub const NOT_IN_STORE: &str = "the Web Store has no extension with that id";
pub const NOT_OFFERED: &str = "the Web Store offers no package of it right now, so its files cannot be compared";
pub const DIFFERENT: &str = "by its files, that is a different extension";

/// What the window hears: `(event, payload)`.
pub type Tell = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// Everything an update touches.
pub struct Env {
    pub lib: PathBuf,
    pub book: PathBuf,
    /// The update2 endpoint.
    pub base: String,
    /// Where package downloads go instead of the codebase's own host; tests serve them.
    pub blobs: Option<String>,
    /// The installed engine; None when unknown (a browser of the person's own).
    pub engine: Option<String>,
    pub world: Arc<dyn World>,
    pub ops: Arc<Ops>,
    /// A profile's name by its id.
    pub names: Arc<dyn Fn(&str) -> String + Send + Sync>,
    pub tell: Tell,
    pub check_timeout: Duration,
}

impl Env {
    /// This computer's library and record.
    pub fn real(engine: Option<String>) -> Result<Env> {
        Ok(Env {
            lib: crate::store::extensions_dir()?,
            book: crate::store::data_root()?.join(BOOK),
            base: update2::WEBSTORE_UPDATE.into(),
            blobs: None,
            engine,
            world: Arc::new(usage::System),
            ops: Arc::new(Ops::real()),
            names: Arc::new(|id| {
                let stored = crate::space::local::profile::load_raw(id).ok();
                let name = stored.as_ref().and_then(|p| p.config.get("name")?.as_str()).unwrap_or("").trim();
                if name.is_empty() { id.to_string() } else { name.to_string() }
            }),
            tell: Arc::new(|event, payload| match (event, payload.as_str()) {
                ("store-changed", Some(kind)) => crate::notify_store_changed(kind),
                _ => crate::notify_event(event, payload),
            }),
            check_timeout: CHECK_TIMEOUT,
        })
    }

    /// The engine's version, else the bundle's: without one the store answers "noupdate".
    fn prod(&self) -> Option<ProdVersion> {
        self.engine.as_deref().and_then(ProdVersion::new).or_else(|| ProdVersion::new(crate::runtime::CHROMIUM_VERSION))
    }

    /// A codebase as this env fetches it.
    fn blob(&self, codebase: &str) -> String {
        let Some(to) = &self.blobs else { return codebase.to_string() };
        match url::Url::parse(codebase) {
            Ok(u) => format!("{}{}", to.trim_end_matches('/'), &u[url::Position::BeforePath..]),
            Err(_) => codebase.to_string(),
        }
    }

    fn changed(&self, kind: &str) {
        (self.tell)("store-changed", json!(kind));
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

// ---- The record ----

/// `extension-updates.json`: what the store last said, per library extension.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Book {
    pub v: u32,
    pub last_check_at: u64,
    /// Why the last check got no answer, when it did not.
    pub last_error: Option<String>,
    /// By `lib:<id>`.
    pub items: BTreeMap<String, Item>,
}

/// What the last answer about an item said.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Unchecked,
    Current,
    Available,
    Failed,
    IdConflict,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Item {
    /// The store's version, while newer than the installed one.
    pub latest: Option<String>,
    pub size: Option<u64>,
    /// When `latest` was first seen.
    pub first_seen: Option<u64>,
    pub checked_at: Option<u64>,
    pub status: Status,
    pub flags: Vec<Flag>,
    pub allowlisted: Option<bool>,
    pub error: Option<String>,
    /// The version a toast told of already.
    pub notified: Option<String>,
    /// The flags a toast told of already.
    pub flags_told: Vec<Flag>,
    pub skipped: Option<String>,
    /// When the update was let in, until it goes in.
    pub ready_since: Option<u64>,
}

fn key(id: &str) -> String {
    format!("lib:{id}")
}

fn book_lock() -> MutexGuard<'static, ()> {
    static L: Mutex<()> = Mutex::new(());
    L.lock().unwrap_or_else(|e| e.into_inner())
}

/// The record, or an empty one: it is only a cache of the store's answers.
pub fn load(path: &Path) -> Book {
    fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(path: &Path, b: &Book) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(b)?;
    let wrote = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&body)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if wrote.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    wrote.with_context(|| format!("write {}", path.display()))
}

/// Read, changed by `f`, written back if it changed.
fn edit<R>(env: &Env, f: impl FnOnce(&mut Book) -> R) -> R {
    let _turn = book_lock();
    let mut b = load(&env.book);
    let before = b.clone();
    let out = f(&mut b);
    if b != before {
        b.v = 1;
        if let Err(e) = save(&env.book, &b) {
            eprintln!("[extensions] update record not saved: {e:#}");
        }
    }
    out
}

fn item<'a>(b: &'a mut Book, id: &str) -> &'a mut Item {
    b.items.entry(key(id)).or_default()
}

/// A deleted extension's line goes with it.
pub fn forget(book: &Path, id: &str) {
    let _turn = book_lock();
    let mut b = load(book);
    if b.items.remove(&key(id)).is_some() {
        if let Err(e) = save(book, &b) {
            eprintln!("[extensions] update record not saved: {e:#}");
        }
    }
}

/// Sync kept this computer's copy, another's would change its id here (`Some`);
/// or one from another computer went in since (`None`).
pub fn note_conflict(book: &Path, id: &str, message: Option<&str>) {
    let _turn = book_lock();
    let mut b = load(book);
    let before = b.clone();
    match message {
        Some(m) => {
            let it = item(&mut b, id);
            (it.status, it.error) = (Status::IdConflict, Some(m.to_string()));
        }
        None => {
            if let Some(it) = b.items.get_mut(&key(id)).filter(|it| it.status == Status::IdConflict) {
                (it.status, it.error) = (Status::Current, None);
            }
        }
    }
    if b != before {
        b.v = 1;
        if let Err(e) = save(book, &b) {
            eprintln!("[extensions] update record not saved: {e:#}");
        }
    }
}

/// What a store answer says of one copy installed at `installed`.
fn record(it: &mut Item, a: &AppAnswer, installed: &str, at: u64) {
    match &a.answer {
        Answer::Update { version, size, .. } if newer(version, installed) => {
            if it.latest.as_deref() != Some(version) {
                it.first_seen = Some(at);
            }
            it.latest = Some(version.clone());
            it.size = *size;
            it.status = Status::Available;
            it.error = None;
        }
        Answer::Update { .. } | Answer::NoUpdate => {
            (it.latest, it.size, it.first_seen) = (None, None, None);
            it.status = Status::Current;
            it.error = None;
        }
        Answer::Unknown(s) => {
            (it.latest, it.size, it.first_seen) = (None, None, None);
            it.status = Status::Failed;
            it.error = Some(format!("the Web Store does not know this extension ({s})"));
            // An item taken down says nothing of its flags: those known stay.
            it.checked_at = Some(at);
            return;
        }
        // No answer: what was known stays.
        Answer::Error(e) => {
            it.error = Some(e.clone());
            return;
        }
    }
    it.flags = a.flags.clone();
    it.allowlisted = a.allowlisted;
    it.checked_at = Some(at);
}

fn failed(env: &Env, id: &str, kind: Option<Kind>, message: &str) {
    edit(env, |b| {
        let it = item(b, id);
        it.status = if kind == Some(Kind::IdConflict) { Status::IdConflict } else { Status::Failed };
        it.error = Some(message.to_string());
    });
    env.changed("extension-updates");
}

// ---- Updates under way ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Download,
    Verify,
    Unpack,
    Apply,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub phase: Step,
    pub received: u64,
    pub total: u64,
}

struct Running {
    progress: Option<Progress>,
    cancel: watch::Sender<bool>,
    told: Option<Instant>,
}

type RunKey = (PathBuf, String);

fn registry() -> MutexGuard<'static, HashMap<RunKey, Running>> {
    static R: OnceLock<Mutex<HashMap<RunKey, Running>>> = OnceLock::new();
    R.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// One update or link of an extension at a time; Cancel reaches it through here.
struct Busy {
    key: RunKey,
    cancel: watch::Receiver<bool>,
}

impl Busy {
    fn cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    async fn until_cancelled(&mut self) {
        if self.cancel.wait_for(|c| *c).await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        registry().remove(&self.key);
    }
}

fn busy(env: &Env, id: &str) -> Result<Busy> {
    busy_at(&env.lib, id)
}

/// Sync laying a package down: no update or link of the same extension meanwhile.
pub struct Claim(#[allow(dead_code)] Busy);

pub fn claim(lib: &Path, id: &str) -> Option<Claim> {
    busy_at(lib, id).ok().map(Claim)
}

fn busy_at(lib: &Path, id: &str) -> Result<Busy> {
    let key = (lib.to_path_buf(), id.to_string());
    let mut r = registry();
    if r.contains_key(&key) {
        bail!(BUSY);
    }
    let (tx, rx) = watch::channel(false);
    r.insert(key.clone(), Running { progress: None, cancel: tx, told: None });
    Ok(Busy { key, cancel: rx })
}

fn running(lib: &Path, id: &str) -> Option<Option<Progress>> {
    registry().get(&(lib.to_path_buf(), id.to_string())).map(|r| r.progress)
}

/// Where an update is; the window hears it a few times a second.
fn step(lib: &Path, id: &str, tell: &Tell, phase: Step, received: u64, total: u64) {
    let emit = {
        let mut r = registry();
        let Some(run) = r.get_mut(&(lib.to_path_buf(), id.to_string())) else { return };
        let new_phase = run.progress.map(|p| p.phase) != Some(phase);
        let due = run.told.is_none_or(|t| t.elapsed() >= TELL_EVERY);
        run.progress = Some(Progress { phase, received, total });
        let emit = new_phase || due || (total > 0 && received >= total);
        if emit {
            run.told = Some(Instant::now());
        }
        emit
    };
    if emit {
        tell("extension-update:progress", json!({ "id": id, "phase": phase, "received": received, "total": total }));
    }
}

// ---- What the window shows ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Unlinked,
    Unchecked,
    Current,
    Available,
    Downloading,
    /// The new version is here, checked; it goes in on Update, or by itself once let in.
    Ready,
    Waiting,
    Applying,
    Confirm,
    Failed,
    NeedsEngine,
    IdConflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Holder {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    Permissions,
    Identity,
}

/// What the person must see before the update goes in.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Confirm {
    pub reason: Reason,
    pub grown: Vec<Grant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub names: Option<Names>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExtensionUpdate {
    /// The library entry's id.
    pub id: String,
    pub state: State,
    /// `version_name`, else `version`.
    pub installed: String,
    pub latest: Option<String>,
    pub size: Option<u64>,
    pub first_seen: Option<u64>,
    pub ready_since: Option<u64>,
    pub waiting_on: Vec<Holder>,
    pub progress: Option<Progress>,
    pub error: Option<String>,
    pub checked_at: Option<u64>,
    pub flags: Vec<Flag>,
    pub allowlisted: Option<bool>,
    pub skipped: Option<String>,
    /// The engine the staged version asks for.
    pub needs_engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirm: Option<Confirm>,
}

/// The installed copy, as the update sees it.
struct Live {
    root: PathBuf,
    version: String,
    shown: String,
    name: String,
}

fn live(lib: &Path, id: &str) -> Option<Live> {
    if !valid_id(id) {
        return None;
    }
    let root = manifest_root(&lib.join(id));
    let m = manifest_edit::read_manifest(&root).ok()?;
    let version = m.get("version")?.as_str()?.to_string();
    Version::parse(&version)?;
    let shown = m.get("version_name").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).unwrap_or(&version).to_string();
    let name = manifest_edit::display_name(&root).unwrap_or_else(|| id.to_string());
    Some(Live { root, version, shown, name })
}

/// The store item a library extension is linked to.
fn linked(lib: &Path, id: &str) -> Option<String> {
    match source::read(lib, id)?.source? {
        SourceRef::Webstore { id } => Some(id),
        SourceRef::Url { .. } => None,
    }
}

fn ids(lib: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(lib) else { return Vec::new() };
    let mut out: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| valid_id(n))
        .collect();
    out.sort();
    out
}

fn named(env: &Env, profiles: &[String]) -> Vec<Holder> {
    profiles.iter().map(|p| Holder { id: p.clone(), name: (env.names)(p) }).collect()
}

/// Every library extension's update, from the record, what is staged and what runs.
pub fn all(env: &Env) -> Vec<ExtensionUpdate> {
    let book = load(&env.book);
    ids(&env.lib).iter().filter_map(|id| view(env, &book, id)).collect()
}

pub fn one(env: &Env, id: &str) -> Option<ExtensionUpdate> {
    view(env, &load(&env.book), id)
}

fn view(env: &Env, book: &Book, id: &str) -> Option<ExtensionUpdate> {
    let live = live(&env.lib, id)?;
    let it = book.items.get(&key(id)).cloned().unwrap_or_default();
    // A stage against another installed version never goes in.
    let staged = swap::staged(&env.lib, id).filter(|s| s.from == live.version);
    let latest = it.latest.clone().filter(|l| newer(l, &live.version));
    let mut u = ExtensionUpdate {
        id: id.to_string(),
        state: State::Current,
        installed: live.shown,
        latest: latest.clone(),
        size: it.size,
        first_seen: it.first_seen,
        ready_since: None,
        waiting_on: Vec::new(),
        progress: None,
        error: it.error.clone(),
        checked_at: it.checked_at,
        flags: it.flags.clone(),
        allowlisted: it.allowlisted,
        skipped: it.skipped.clone(),
        needs_engine: None,
        confirm: None,
    };
    u.state = if let Some(progress) = running(&env.lib, id) {
        u.progress = progress;
        if progress.is_some_and(|p| p.phase == Step::Apply) { State::Applying } else { State::Downloading }
    } else if let Some(s) = &staged {
        if latest.as_ref().is_none_or(|l| newer(&s.to, l)) {
            u.latest = Some(s.to.clone());
        }
        staged_state(env, &it, s, &mut u)
    } else if it.status == Status::IdConflict {
        State::IdConflict
    } else if linked(&env.lib, id).is_none() {
        State::Unlinked
    } else if it.status == Status::Failed {
        State::Failed
    } else if let Some(l) = &latest {
        if it.skipped.as_deref() == Some(l.as_str()) { State::Current } else { State::Available }
    } else if it.status == Status::Unchecked {
        State::Unchecked
    } else {
        State::Current
    };
    Some(u)
}

fn staged_state(env: &Env, it: &Item, s: &Staged, u: &mut ExtensionUpdate) -> State {
    if let Some(min) = &s.needs_engine {
        u.needs_engine = Some(min.clone());
        return State::NeedsEngine;
    }
    if !s.approved && (!s.grown.is_empty() || s.identity.is_some()) {
        u.confirm = Some(Confirm {
            reason: if s.identity.is_some() { Reason::Identity } else { Reason::Permissions },
            grown: s.grown.clone(),
            names: s.identity.as_ref().map(|i| i.names.clone()),
            overlap: s.identity.as_ref().map(|i| i.overlap),
        });
        return State::Confirm;
    }
    if !s.approved {
        return State::Ready;
    }
    // One left from an update that went in since is older than this stage.
    u.ready_since = Some(it.ready_since.filter(|r| *r >= s.at).unwrap_or(s.at));
    let held = usage::holders(&*env.world, &u.id);
    if held.is_empty() && !env.world.paused() {
        return State::Ready;
    }
    u.waiting_on = named(env, &held);
    State::Waiting
}

// ---- The check ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Fresh {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Flagged {
    pub id: String,
    pub name: String,
    pub flags: Vec<Flag>,
}

/// What a check found that no toast has told of yet.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct News {
    pub fresh: Vec<Fresh>,
    pub flagged: Vec<Flagged>,
}

impl News {
    pub fn is_empty(&self) -> bool {
        self.fresh.is_empty() && self.flagged.is_empty()
    }
}

/// What the store said to one round of questions.
struct Asked {
    answers: Vec<AppAnswer>,
    /// Why a request got no answer.
    error: Option<String>,
    /// None got one.
    none: bool,
}

impl Asked {
    fn about(&self, sid: &str) -> Option<&AppAnswer> {
        self.answers.iter().find(|a| a.id == sid)
    }
}

/// One GET per batch, straight from this computer, with the launcher's own UA.
async fn ask(env: &Env, items: &[(String, String)]) -> Asked {
    let no_answer = |asked: &[(String, String)], why: &str| -> Vec<AppAnswer> {
        asked
            .iter()
            .map(|(id, _)| AppAnswer { id: id.clone(), answer: Answer::Error(why.into()), flags: vec![], allowlisted: None })
            .collect()
    };
    let Some(prod) = env.prod() else {
        let why = "the engine's version is unknown";
        return Asked { answers: no_answer(items, why), error: Some(why.into()), none: true };
    };
    let batches = update2::batches(&env.base, &prod, items);
    let (mut answers, mut error, mut got) = (Vec::new(), None, 0);
    for (url, asked) in &batches {
        match super::get_small(url, &update2::user_agent(), env.check_timeout).await {
            Ok(body) if update2::parse(&body).is_ok() => {
                got += 1;
                answers.extend(update2::answers(&body, asked));
            }
            Ok(_) => {
                let why = "the Web Store's answer could not be read";
                error = Some(why.to_string());
                answers.extend(no_answer(asked, why));
            }
            Err(e) => {
                answers.extend(no_answer(asked, &e));
                error = Some(e);
            }
        }
    }
    Asked { answers, error, none: got == 0 && !batches.is_empty() }
}

/// One check of a record at a time; a second caller takes the first one's result.
struct Gate {
    turn: tokio::sync::Mutex<()>,
    done: AtomicU64,
    last: Mutex<Option<Result<News, String>>>,
}

fn gate(book: &Path) -> Arc<Gate> {
    static G: OnceLock<Mutex<HashMap<PathBuf, Arc<Gate>>>> = OnceLock::new();
    let mut g = G.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    g.entry(book.to_path_buf())
        .or_insert_with(|| Arc::new(Gate { turn: tokio::sync::Mutex::new(()), done: AtomicU64::new(0), last: Mutex::new(None) }))
        .clone()
}

/// Asks the store about every linked extension; nothing is sent when none is.
/// Err only when no request got an answer; what was known then stays.
pub async fn check(env: &Env) -> Result<News, String> {
    let gate = gate(&env.book);
    let seen = gate.done.load(Ordering::SeqCst);
    let _turn = gate.turn.lock().await;
    if gate.done.load(Ordering::SeqCst) != seen {
        // One ran while this waited: its answer is this one's.
        return gate.last.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_else(|| Ok(News::default()));
    }
    let out = check_once(env).await;
    *gate.last.lock().unwrap_or_else(|e| e.into_inner()) = Some(out.clone());
    gate.done.fetch_add(1, Ordering::SeqCst);
    out
}

async fn check_once(env: &Env) -> Result<News, String> {
    // Every copy linked to the store: (library id, store id, installed version).
    let copies: Vec<(String, String, Live)> = ids(&env.lib)
        .into_iter()
        .filter_map(|id| {
            let sid = linked(&env.lib, &id)?;
            let l = live(&env.lib, &id)?;
            Some((id, sid, l))
        })
        .collect();
    let at = now();
    if copies.is_empty() {
        edit(env, |b| {
            b.last_check_at = at;
            b.last_error = None;
        });
        return Ok(News::default());
    }
    // One question per store item, for its oldest copy.
    let mut oldest: BTreeMap<String, String> = BTreeMap::new();
    for (_, sid, l) in &copies {
        let v = oldest.entry(sid.clone()).or_insert_with(|| l.version.clone());
        if newer(v, &l.version) {
            *v = l.version.clone();
        }
    }
    let items: Vec<(String, String)> = oldest.into_iter().collect();
    let asked = ask(env, &items).await;
    let news = edit(env, |b| {
        let mut news = News::default();
        for (id, sid, l) in &copies {
            let Some(a) = asked.about(sid) else { continue };
            let it = item(b, id);
            record(it, a, &l.version, at);
            // A flagged one is told of as flagged, never as an update.
            if let (Status::Available, Some(v), true) = (it.status, it.latest.clone(), it.flags.is_empty()) {
                if it.notified.as_ref() != Some(&v) && it.skipped.as_ref() != Some(&v) {
                    it.notified = Some(v.clone());
                    news.fresh.push(Fresh { id: id.clone(), name: l.name.clone(), version: v });
                }
            }
            if !matches!(a.answer, Answer::Error(_)) {
                if !it.flags.is_empty() && it.flags_told != it.flags {
                    news.flagged.push(Flagged { id: id.clone(), name: l.name.clone(), flags: it.flags.clone() });
                }
                it.flags_told = it.flags.clone();
            }
        }
        // A check nobody answered is tried again soon, not in 5 h.
        if !asked.none {
            b.last_check_at = at;
        }
        b.last_error = asked.error.clone();
        news
    });
    // A version the store no longer offers, or of an item it flags, is never put in.
    for (id, sid, l) in &copies {
        if asked.about(sid).is_some_and(|a| !a.flags.is_empty()) {
            drop_flagged(env, id, sid).await;
            continue;
        }
        let offered = match asked.about(sid).map(|a| &a.answer) {
            Some(Answer::Update { version, .. }) => version.clone(),
            Some(Answer::NoUpdate) => l.version.clone(),
            _ => continue,
        };
        drop_withdrawn(env, id, sid, &offered).await;
    }
    env.changed("extension-updates");
    match (asked.none, asked.error) {
        (true, Some(e)) => Err(e),
        _ => Ok(news),
    }
}

/// A stage from the store newer than what it offers now goes.
async fn drop_withdrawn(env: &Env, id: &str, sid: &str, offered: &str) -> bool {
    let withdrawn = swap::staged(&env.lib, id).is_some_and(|s| s.origin == Origin::Store(sid.to_string()) && newer(&s.to, offered));
    if !withdrawn || running(&env.lib, id).is_some() {
        return false;
    }
    eprintln!("[extensions] {id}: the Web Store no longer offers the staged version; dropped");
    drop_stage(env, id).await
}

/// The store's stage of a flagged item goes; one that cannot go yet stops
/// going in by itself.
async fn drop_flagged(env: &Env, id: &str, sid: &str) {
    if !swap::staged(&env.lib, id).is_some_and(|s| s.origin == Origin::Store(sid.to_string())) || running(&env.lib, id).is_some() {
        return;
    }
    eprintln!("[extensions] {id}: the Web Store flags it; its staged version is dropped");
    if !drop_stage(env, id).await {
        swap::withhold(&env.lib, id);
    }
}

/// `swap::cancel` off the async threads: it may wait for a swap.
async fn drop_stage(env: &Env, id: &str) -> bool {
    let (lib, who, ops) = (env.lib.clone(), id.to_string(), env.ops.clone());
    tokio::task::spawn_blocking(move || swap::cancel(&lib, &who, &ops)).await.unwrap_or(false)
}

// ---- Downloads ----

/// The store's package at `codebase` into `.<id>.part`, given up on Cancel.
async fn download(env: &Env, busy: &mut Busy, id: &str, codebase: &str, order: &Order) -> Result<PathBuf> {
    if let Some(size) = order.size {
        swap::room(&env.ops, &env.lib, size)?;
    }
    let part = swap::Paths::new(&env.lib, id).part();
    let cap = order.size.map_or(super::DOWNLOAD_MAX, |s| s.saturating_add(MB).min(super::DOWNLOAD_MAX));
    let total = order.size.unwrap_or(0);
    let (lib, who, tell) = (env.lib.clone(), id.to_string(), env.tell.clone());
    let heard = move |n: u64| step(&lib, &who, &tell, Step::Download, n, total);
    step(&env.lib, id, &env.tell, Step::Download, 0, total);
    let (url, ua) = (env.blob(codebase), update2::user_agent());
    let got = tokio::select! {
        r = super::fetch(&url, &part, &ua, cap, &heard) => r,
        _ = busy.until_cancelled() => Err(anyhow!(CANCELLED)),
    };
    if let Err(e) = got {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    Ok(part)
}

/// The downloaded package staged over the live tree, off the async threads.
async fn stage(env: &Env, busy: &Busy, id: &str, part: &Path, order: Order) -> Result<Staged, Failure> {
    let (lib, who, file, ops, tell) = (env.lib.clone(), id.to_string(), part.to_path_buf(), env.ops.clone(), env.tell.clone());
    let progress: swap::Progress = {
        let (lib, who, tell) = (lib.clone(), who.clone(), tell.clone());
        Arc::new(move |phase, got, total| {
            let phase = match phase {
                swap::Phase::Download => Step::Download,
                swap::Phase::Verify => Step::Verify,
                swap::Phase::Unpack => Step::Unpack,
            };
            step(&lib, &who, &tell, phase, got, total)
        })
    };
    let staged = tokio::task::spawn_blocking(move || swap::stage_file(&lib, &who, &file, &order, &ops, &progress))
        .await
        .unwrap_or_else(|e| Err(Failure::new(Kind::Package, format!("the update could not be unpacked: {e}"))));
    if busy.cancelled() {
        drop_stage(env, id).await;
        return Err(Failure::new(Kind::Stale, CANCELLED));
    }
    staged
}

// ---- Update ----

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum Done {
    Applied { from: String, to: String },
    /// Goes in once these profiles close.
    Waiting { waiting_on: Vec<Holder> },
    /// Shown to the person first; Update again with `confirmed`.
    Confirm { update: Box<ExtensionUpdate> },
    NeedsEngine { version: String },
    /// The store does not offer the version it named at the last check.
    NotServed,
    /// Nothing newer.
    Current,
}

/// Asks the store again, stages its version (or takes the one staged), and
/// puts it in once nothing holds it. `confirmed` lets in what a stage already
/// here asked the person about, never a package downloaded by this same call.
pub async fn update(env: &Env, id: &str, confirmed: bool) -> Result<Done> {
    let mut busy = busy(env, id)?;
    let live = live(&env.lib, id).context(NOT_IN_LIBRARY)?;
    let sid = linked(&env.lib, id).context(UNLINKED)?;
    let known = load(&env.book).items.get(&key(id)).cloned().unwrap_or_default();
    if !known.flags.is_empty() {
        bail!(FLAGGED);
    }
    // Asked again right before: a version the store has withdrawn never goes in.
    let asked = ask(env, &[(sid.clone(), live.version.clone())]).await;
    if asked.none {
        bail!("{}", asked.error.unwrap_or_else(|| "the Web Store did not answer".into()));
    }
    let a = asked.about(&sid).cloned().context("the Web Store did not answer about this extension")?;
    let at = now();
    let (version, codebase, sha256, size) = match &a.answer {
        Answer::Update { version, codebase, sha256, size } if newer(version, &live.version) => {
            edit(env, |b| record(item(b, id), &a, &live.version, at));
            (version.clone(), codebase.clone(), sha256.clone(), *size)
        }
        Answer::Update { .. } | Answer::NoUpdate => {
            // The badge stays until the next check; only the flags are taken.
            edit(env, |b| {
                let it = item(b, id);
                it.flags = a.flags.clone();
                it.allowlisted = a.allowlisted;
            });
            drop_withdrawn(env, id, &sid, &live.version).await;
            env.changed("extension-updates");
            if !a.flags.is_empty() {
                bail!(FLAGGED);
            }
            return Ok(if known.latest.is_some_and(|l| newer(&l, &live.version)) { Done::NotServed } else { Done::Current });
        }
        Answer::Unknown(_) => {
            edit(env, |b| record(item(b, id), &a, &live.version, at));
            env.changed("extension-updates");
            bail!(NOT_IN_STORE);
        }
        Answer::Error(e) => bail!("the Web Store's answer could not be read: {e}"),
    };
    if !a.flags.is_empty() {
        env.changed("extension-updates");
        bail!(FLAGGED);
    }

    let order = Order::store(&sid, sha256.as_deref(), size, env.engine.as_deref()).expecting(&version);
    let engine_short = |min: &str| env.engine.as_deref().is_some_and(|e| newer(min, e));
    let kept = swap::staged(&env.lib, id).filter(|s| {
        s.origin == order.origin && s.to == version && s.from == live.version && s.needs_engine.as_deref().is_none_or(engine_short)
    });
    let fresh = kept.is_none();
    let staged = match kept {
        Some(s) => s,
        None => {
            let part = match download(env, &mut busy, id, &codebase, &order).await {
                Ok(p) => p,
                Err(e) if busy.cancelled() => return Err(e),
                Err(e) => {
                    failed(env, id, None, &format!("{e:#}"));
                    return Err(e);
                }
            };
            let staged = stage(env, &busy, id, &part, order).await;
            let _ = fs::remove_file(&part);
            match staged {
                Ok(s) => s,
                Err(f) if busy.cancelled() => return Err(f.into()),
                Err(f) => {
                    failed(env, id, Some(f.kind), &f.message);
                    return Err(f.into());
                }
            }
        }
    };
    if let Some(min) = &staged.needs_engine {
        env.changed("extension-updates");
        return Ok(Done::NeedsEngine { version: min.clone() });
    }
    let let_in = fresh || !staged.approved;
    if !staged.approved {
        let asks = !staged.grown.is_empty() || staged.identity.is_some();
        if asks && (fresh || !confirmed) {
            drop(busy);
            env.changed("extension-updates");
            let shown = one(env, id).context(NOT_IN_LIBRARY)?;
            return Ok(Done::Confirm { update: Box::new(shown) });
        }
        swap::approve(&env.lib, id)?;
    }
    edit(env, |b| {
        let since = &mut item(b, id).ready_since;
        if let_in || since.is_none() {
            *since = Some(at);
        }
    });
    apply(env, &busy, id).await
}

/// The approved stage put in, or left waiting for whoever holds the extension;
/// `_busy` keeps it shown as applying meanwhile.
async fn apply(env: &Env, _busy: &Busy, id: &str) -> Result<Done> {
    step(&env.lib, id, &env.tell, Step::Apply, 0, 0);
    let (world, lib, who, ops) = (env.world.clone(), env.lib.clone(), id.to_string(), env.ops.clone());
    let out = tokio::task::spawn_blocking(move || usage::try_apply(&*world, &lib, &who, &ops))
        .await
        .map_err(|e| anyhow!("the update stopped: {e}"))?;
    match out {
        Ok(Outcome::Applied(a)) => {
            edit(env, |b| {
                let it = item(b, id);
                it.ready_since = None;
                it.error = None;
                it.status = Status::Current;
            });
            env.changed("extensions");
            env.changed("extension-updates");
            Ok(Done::Applied { from: a.from, to: a.to })
        }
        Ok(Outcome::Deferred { profiles }) => {
            env.changed("extension-updates");
            Ok(Done::Waiting { waiting_on: named(env, &profiles) })
        }
        Ok(Outcome::Nothing) => bail!("nothing is staged for this extension"),
        Err(f) => {
            failed(env, id, Some(f.kind), &f.message);
            Err(f.into())
        }
    }
}

// ---- Link ----

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum Linked {
    Linked { source: SourceRef, allowlisted: Option<bool>, update: Option<Box<ExtensionUpdate>> },
    /// Shown to the person first, always when the files decide; link again with `confirmed`.
    Confirm {
        names: Names,
        installed: String,
        store: String,
        overlap: f64,
        /// What the files say: `same` or `unsure`.
        kin: Kinship,
        allowlisted: Option<bool>,
        flags: Vec<Flag>,
    },
}

/// Links a library extension to the store item `raw` names (design §3.1.5):
/// the key decides when there is one; otherwise the store's current package
/// is downloaded and its files weighed against the installed ones.
pub async fn link(env: &Env, id: &str, raw: &str, confirmed: bool) -> Result<Linked> {
    let mut busy = busy(env, id)?;
    let sid = store_link::store_id(raw).context(NOT_A_LINK)?;
    let live = live(&env.lib, id).context(NOT_IN_LIBRARY)?;
    let mut side = source::read(&env.lib, id).unwrap_or_default();
    match &side.source {
        Some(SourceRef::Webstore { id: have }) if *have == sid => {
            drop(busy);
            return Ok(linked_now(env, id, &sid));
        }
        Some(SourceRef::Webstore { id: have }) => bail!("it is linked to the Web Store item {have} already"),
        _ => {}
    }
    // Chrome gives it the id its key makes: nothing else to weigh.
    if let Some(kid) = super::key_id(&live.root) {
        if kid != sid {
            bail!("that is a different extension: its key gives it the id {kid}");
        }
        side.source = Some(SourceRef::webstore(&sid));
        side.how = Some(How::ManifestKey);
        side.recovered = true;
        source::write(&env.lib, id, &side)?;
        drop(busy);
        env.changed("extensions");
        return Ok(linked_now(env, id, &sid));
    }

    let asked = ask(env, &[(sid.clone(), ANY_VERSION.into())]).await;
    if asked.none {
        bail!("{}", asked.error.unwrap_or_else(|| "the Web Store did not answer".into()));
    }
    let a = asked.about(&sid).cloned().context("the Web Store did not answer about this extension")?;
    let (version, codebase, sha256, size) = match &a.answer {
        Answer::Update { version, codebase, sha256, size } => (version.clone(), codebase.clone(), sha256.clone(), *size),
        Answer::Unknown(_) => bail!(NOT_IN_STORE),
        Answer::NoUpdate => bail!(NOT_OFFERED),
        Answer::Error(e) => bail!("the Web Store's answer could not be read: {e}"),
    };
    // Linking is not asking for the update; the files were weighed here already.
    let mut order = Order::store(&sid, sha256.as_deref(), size, env.engine.as_deref()).expecting(&version);
    (order.approve, order.weighed) = (false, true);
    let part = download(env, &mut busy, id, &codebase, &order).await?;
    step(&env.lib, id, &env.tell, Step::Verify, 0, 0);
    let (lib, who, file, weigh_order, ops) = (env.lib.clone(), id.to_string(), part.clone(), order.clone(), env.ops.clone());
    let weighed = tokio::task::spawn_blocking(move || swap::weigh(&lib, &who, &file, &weigh_order, &ops))
    .await
    .map_err(|e| anyhow!("the package could not be compared: {e}"))
    .and_then(|r| r.map_err(anyhow::Error::from));
    let w = match weighed {
        Ok(w) if !busy.cancelled() => w,
        Ok(_) => {
            let _ = fs::remove_file(&part);
            bail!(CANCELLED);
        }
        Err(e) => {
            let _ = fs::remove_file(&part);
            return Err(e);
        }
    };
    let kin = manifest_edit::kinship(w.overlap, w.same_name);
    eprintln!("[extensions] {id}: weighed against {sid} {}: {:.2} of its files match, same name {}", w.version, w.overlap, w.same_name);
    if kin == Kinship::Other {
        let _ = fs::remove_file(&part);
        bail!("{DIFFERENT} ({}% of its files match)", (w.overlap * 100.0).round());
    }
    // Names and shared files are easy to copy: the person sees what was found first.
    if !confirmed {
        let _ = fs::remove_file(&part);
        return Ok(Linked::Confirm {
            names: w.names,
            installed: live.shown,
            store: w.version,
            overlap: w.overlap,
            kin,
            allowlisted: a.allowlisted,
            flags: a.flags.clone(),
        });
    }

    side.source = Some(SourceRef::webstore(&sid));
    side.how = Some(How::User);
    side.recovered = true;
    if let Err(e) = source::write(&env.lib, id, &side) {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    // A newer version in hand stays staged, so Update needs no second download.
    if newer(&w.version, &live.version) {
        if let Err(f) = stage(env, &busy, id, &part, order).await {
            eprintln!("[extensions] {id}: linked; its update was not kept: {f}");
        }
    }
    let _ = fs::remove_file(&part);
    let at = now();
    edit(env, |b| record(item(b, id), &a, &live.version, at));
    drop(busy);
    env.changed("extensions");
    Ok(linked_now(env, id, &sid))
}

fn linked_now(env: &Env, id: &str, sid: &str) -> Linked {
    env.changed("extension-updates");
    let update = one(env, id);
    Linked::Linked {
        source: SourceRef::webstore(sid),
        allowlisted: update.as_ref().and_then(|u| u.allowlisted),
        update: update.map(Box::new),
    }
}

// ---- Cancel, skip, retry ----

/// Stops a download under way, or drops what is staged.
pub fn cancel(env: &Env, id: &str) -> Result<()> {
    if !valid_id(id) {
        bail!("invalid extension id");
    }
    let signalled = registry().get(&(env.lib.clone(), id.to_string())).map(|r| r.cancel.send(true)).is_some();
    // One under way drops its own stage once it stops.
    if !signalled && swap::Paths::new(&env.lib, id).staging().exists() && !swap::cancel(&env.lib, id, &env.ops) {
        bail!("the extension is being updated right now; try again in a minute");
    }
    edit(env, |b| {
        if let Some(it) = b.items.get_mut(&key(id)) {
            it.ready_since = None;
        }
    });
    env.changed("extension-updates");
    Ok(())
}

/// Hides `version` until a newer one comes; a stage of it goes.
pub fn skip(env: &Env, id: &str, version: &str) -> Result<()> {
    if live(&env.lib, id).is_none() {
        bail!(NOT_IN_LIBRARY);
    }
    if Version::parse(version).is_none() {
        bail!("{version:?} is not a version");
    }
    let staged = swap::staged(&env.lib, id).is_some_and(|s| s.to == version);
    if staged && running(&env.lib, id).is_none() && !swap::cancel(&env.lib, id, &env.ops) {
        bail!("the extension is being updated right now; try again in a minute");
    }
    edit(env, |b| {
        let it = item(b, id);
        it.skipped = Some(version.to_string());
        if staged {
            it.ready_since = None;
        }
        // A failed try of that version hides with it, as the design's "until the next one".
        if it.status == Status::Failed && it.latest.as_deref() == Some(version) {
            (it.status, it.error) = (Status::Available, None);
        }
    });
    env.changed("extension-updates");
    Ok(())
}

/// Approved updates whose holders have gone, put in; a folder a failed swap
/// left aside put back. Not while the start settles the library.
pub fn retry_waiting(env: &Env, when: &str) {
    if !usage::settled(&env.lib) {
        return;
    }
    swap::put_back_all(&env.lib, &env.ops);
    // One the store flagged since it was let in stays out.
    let book = load(&env.book);
    for id in swap::waiting(&env.lib) {
        let flagged = book.items.get(&key(&id)).is_some_and(|it| !it.flags.is_empty());
        let store = swap::staged(&env.lib, &id).is_some_and(|s| matches!(s.origin, Origin::Store(_)));
        if flagged && store && !swap::cancel(&env.lib, &id, &env.ops) {
            swap::withhold(&env.lib, &id);
        }
    }
    if swap::waiting(&env.lib).is_empty() {
        return;
    }
    usage::report(&usage::retry(&*env.world, &env.lib, &env.ops), when);
}

#[cfg(test)]
mod tests;
