//! Who holds a library extension: a browser started with it, a launch on its
//! way, or a browser the launcher does not track (that one holds them all).
//! Its folder is swapped only while nobody does; a launch waits a swap out.
//! Both sides look under one lock, so one of them always sees the other.

use super::swap::{self, Applied, Failure, Ops};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// How long a launch waits for a swap of its extensions.
pub const LAUNCH_WAIT: Duration = Duration::from_secs(10);
/// How long a delete or a stage waits for one.
pub const SWAP_WAIT: Duration = Duration::from_secs(30);
/// How long a launch or a sync waits for the library to be settled at start.
pub const SETTLE_WAIT: Duration = Duration::from_secs(60);
/// Why a launch is refused when the swap outlasts its wait.
pub const EXT_UPDATING: &str = "An extension of this profile is being updated. Try again in a minute.";
const STEP: Duration = Duration::from_millis(20);

#[derive(Default)]
struct State {
    /// Extensions being swapped, or otherwise worked on alone.
    applying: HashSet<String>,
    /// Launches on their way: profile and its extensions, by ticket.
    launching: HashMap<u64, (String, Vec<String>)>,
    next: u64,
}

fn state() -> MutexGuard<'static, State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// What the rest of the launcher says about running browsers; tests stand in their own.
pub trait World: Send + Sync {
    /// Profiles tracked as running with library extension `lib_id`.
    fn running_with(&self, lib_id: &str) -> Vec<String>;
    /// Profiles whose folder a browser holds while the launcher does not track it.
    fn untracked(&self) -> Vec<String>;
    /// A data move, a space switch or an engine swap: nothing is swapped meanwhile.
    fn paused(&self) -> bool;
}

/// The launcher itself.
pub struct System;

impl World for System {
    fn running_with(&self, lib_id: &str) -> Vec<String> {
        crate::process::Tracker::shared().users_of(lib_id)
    }

    fn untracked(&self) -> Vec<String> {
        let Ok(root) = crate::store::user_data_root() else { return Vec::new() };
        let Ok(rd) = std::fs::read_dir(&root) else { return Vec::new() };
        let tracker = crate::process::Tracker::shared();
        let mut out: Vec<String> = rd
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|id| !tracker.is_running(id) && crate::reset::lock_is_live(&root.join(id)))
            .collect();
        out.sort();
        out
    }

    fn paused(&self) -> bool {
        crate::migrate::in_progress() || crate::space::switching() || crate::runtime::swapping()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Applied(Applied),
    /// Held by these profiles; none named when the launcher itself is busy.
    Deferred { profiles: Vec<String> },
    /// Nothing approved is staged.
    Nothing,
}

/// The profiles holding `lib_id` now, for the update's "waiting on".
pub fn holders(world: &dyn World, lib_id: &str) -> Vec<String> {
    holders_in(&state(), world, lib_id)
}

fn holders_in(s: &State, world: &dyn World, lib_id: &str) -> Vec<String> {
    let starting: HashSet<&str> = s.launching.values().map(|(p, _)| p.as_str()).collect();
    let mut out: Vec<String> =
        s.launching.values().filter(|(_, ids)| ids.iter().any(|i| i == lib_id)).map(|(p, _)| p.clone()).collect();
    out.extend(world.running_with(lib_id));
    // A launch on its way may hold its lock before it is tracked; its own list says what it holds.
    out.extend(world.untracked().into_iter().filter(|p| !starting.contains(p.as_str())));
    out.sort();
    out.dedup();
    out
}

/// Libraries being settled at start, in the background (`extensions::at_launch`).
fn settling_now() -> MutexGuard<'static, HashSet<PathBuf>> {
    static S: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    S.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// `lib` settling until dropped.
pub struct Settling(PathBuf);

pub fn settling(lib: &Path) -> Settling {
    settling_now().insert(lib.to_path_buf());
    Settling(lib.to_path_buf())
}

impl Drop for Settling {
    fn drop(&mut self) {
        settling_now().remove(&self.0);
    }
}

pub fn settled(lib: &Path) -> bool {
    !settling_now().contains(lib)
}

/// Waits up to `wait` for the start's settling of `lib`; false if it still runs.
pub async fn until_settled(lib: &Path, wait: Duration) -> bool {
    let until = Instant::now() + wait;
    while !settled(lib) {
        if Instant::now() >= until {
            return false;
        }
        tokio::time::sleep(STEP).await;
    }
    true
}

/// Being swapped, or worked on alone, now.
pub fn busy(id: &str) -> bool {
    state().applying.contains(id)
}

/// Marks an extension as worked on alone until dropped.
struct Mark(String);

impl Drop for Mark {
    fn drop(&mut self) {
        state().applying.remove(&self.0);
    }
}

/// Applies the approved stage of `id` when nothing holds it, else says who does.
pub fn try_apply(world: &dyn World, lib: &Path, id: &str, ops: &Ops) -> Result<Outcome, Failure> {
    if !swap::staged(lib, id).is_some_and(|n| n.ready()) {
        return Ok(Outcome::Nothing);
    }
    {
        let mut s = state();
        if s.applying.contains(id) || world.paused() {
            return Ok(Outcome::Deferred { profiles: Vec::new() });
        }
        let profiles = holders_in(&s, world, id);
        if !profiles.is_empty() {
            return Ok(Outcome::Deferred { profiles });
        }
        s.applying.insert(id.to_string());
    }
    let _mark = Mark(id.to_string());
    swap::apply(lib, id, ops).map(Outcome::Applied)
}

/// `id` worked on alone (a delete, a stage's clearing, sync's packing): no
/// swap and no launch with it meanwhile.
pub struct Exclusive(#[allow(dead_code)] Mark);

/// Waits up to `wait` for a swap of `id` to end; None if it does not.
pub fn exclusive(id: &str, wait: Duration) -> Option<Exclusive> {
    let until = Instant::now() + wait;
    loop {
        if state().applying.insert(id.to_string()) {
            return Some(Exclusive(Mark(id.to_string())));
        }
        if Instant::now() >= until {
            return None;
        }
        std::thread::sleep(STEP);
    }
}

/// A launch's claim on its extensions, from before their folders are read
/// until its browser is tracked (or the launch fails).
pub struct Hold(u64);

impl Drop for Hold {
    fn drop(&mut self) {
        state().launching.remove(&self.0);
    }
}

fn enter(profile_id: &str, ids: &[String]) -> Option<Hold> {
    let mut s = state();
    if ids.iter().any(|i| s.applying.contains(i)) {
        return None;
    }
    s.next += 1;
    let n = s.next;
    s.launching.insert(n, (profile_id.to_string(), ids.to_vec()));
    Some(Hold(n))
}

/// Before `profile_id` starts with `ids`: an approved update nobody holds goes
/// in first, then a swap under way is waited out. Refused only on timeout.
pub async fn begin_launch(profile_id: &str, ids: &[String]) -> anyhow::Result<Hold> {
    let lib = crate::store::extensions_dir()?;
    // The start's sweep and source pass first: a folder may be mid-way back.
    if !until_settled(&lib, SETTLE_WAIT).await {
        eprintln!("[extensions] {profile_id} starts while the library is still being settled");
    }
    begin_launch_in(Arc::new(System), Arc::new(Ops::real()), lib, profile_id, ids, LAUNCH_WAIT).await
}

pub async fn begin_launch_in(
    world: Arc<dyn World>,
    ops: Arc<Ops>,
    lib: PathBuf,
    profile_id: &str,
    ids: &[String],
    wait: Duration,
) -> anyhow::Result<Hold> {
    let ready: Vec<String> = ids.iter().filter(|id| swap::staged(&lib, id).is_some_and(|n| n.ready())).cloned().collect();
    if !ready.is_empty() {
        let (w, o, l) = (world.clone(), ops.clone(), lib.clone());
        let done = tokio::task::spawn_blocking(move || {
            ready.into_iter().map(|id| { let r = try_apply(&*w, &l, &id, &o); (id, r) }).collect::<Vec<_>>()
        })
        .await;
        match done {
            Ok(results) => report(&results, &format!("before {profile_id} started")),
            Err(e) => eprintln!("[extensions] updates before {profile_id} started: {e}"),
        }
    }
    let until = Instant::now() + wait;
    loop {
        if let Some(hold) = enter(profile_id, ids) {
            return Ok(hold);
        }
        if Instant::now() >= until {
            anyhow::bail!("{EXT_UPDATING}");
        }
        tokio::time::sleep(STEP).await;
    }
}

/// Every approved update that waits, tried once; a folder a failed swap
/// left aside put back first.
pub fn retry(world: &dyn World, lib: &Path, ops: &Ops) -> Vec<(String, Result<Outcome, Failure>)> {
    swap::put_back_all(lib, ops);
    swap::waiting(lib)
        .into_iter()
        .map(|id| {
            let r = try_apply(world, lib, &id, ops);
            (id, r)
        })
        .collect()
}

/// A browser closed: updates waiting for it go in now, in the background.
pub fn profile_closed(profile_id: &str) {
    // Tests never reach a real library from a closing browser.
    if cfg!(test) {
        return;
    }
    let when = format!("after {profile_id} closed");
    std::thread::spawn(move || match crate::store::extensions_dir() {
        Ok(lib) => report(&retry(&System, &lib, &Ops::real()), &when),
        Err(e) => eprintln!("[extensions] updates {when}: {e:#}"),
    });
}

/// Applied ones logged and the pages told; the rest only logged when they failed.
pub fn report(results: &[(String, Result<Outcome, Failure>)], when: &str) {
    let mut changed = false;
    for (id, r) in results {
        match r {
            Ok(Outcome::Applied(a)) => {
                eprintln!("[extensions] {id}: updated from {} to {} ({when})", a.from, a.to);
                changed = true;
            }
            Ok(_) => {}
            Err(e) => eprintln!("[extensions] {id}: update not applied ({when}): {e}"),
        }
    }
    if changed {
        crate::notify_store_changed("extensions");
        crate::notify_store_changed("extension-updates");
    }
}

/// Launches on their way with `id`, and whether it is being worked on alone.
#[cfg(test)]
fn seen(id: &str) -> (Vec<String>, bool) {
    let s = state();
    let starting = s.launching.values().filter(|(_, ids)| ids.iter().any(|i| i == id)).map(|(p, _)| p.clone()).collect();
    (starting, s.applying.contains(id))
}

#[cfg(test)]
mod tests;
