//! The reaper as a test runs it: this test binary started again, with the
//! reaper's own command line after `--`, so `ps` shows what production passes.

use std::cell::Cell;
use std::ffi::OsString;
use std::path::Path;

/// Where a test's reaper finds the config dir its parent test uses.
const CONFIG: &str = "SHARDX_TEST_REAPER_CONFIG";
const NAME: &str = "space::reap::tests::as_reaper";

thread_local! {
    static SPAWNING: Cell<bool> = const { Cell::new(false) };
}

/// Whether a profile opened on this thread gets a reaper; off unless a test asks.
pub(crate) fn spawning() -> bool {
    SPAWNING.with(Cell::get)
}

pub(crate) fn spawn_reapers(on: bool) {
    SPAWNING.with(|c| c.set(on));
}

static STARTED: std::sync::Mutex<Vec<(std::path::PathBuf, u32)>> = std::sync::Mutex::new(Vec::new());

pub(super) fn started(dir: &Path, pid: Option<u32>) {
    if let Some(pid) = pid {
        STARTED.lock().unwrap_or_else(|e| e.into_inner()).push((dir.to_path_buf(), pid));
    }
}

/// The last reaper started for the copy at `dir`.
pub(crate) fn reaper_of(dir: &Path) -> Option<u32> {
    let all = STARTED.lock().unwrap_or_else(|e| e.into_inner());
    all.iter().rev().find(|(d, _)| d == dir).map(|(_, p)| *p)
}

pub(super) fn as_reaper_command(cmd: &mut tokio::process::Command, dir: &Path) {
    cmd.args(["--exact", "--ignored", "--nocapture", "--test-threads=1", "-q", "--", NAME]);
    cmd.args(super::argv(std::process::id(), dir));
    if let Some(config) = crate::store::test_config() {
        cmd.env(CONFIG, config);
    }
}

/// The reaper's entry in a test binary: does nothing unless started as one.
#[test]
#[ignore = "started by the tests that need a reaper"]
fn as_reaper() {
    let args: Vec<OsString> = std::env::args_os().collect();
    let Some(at) = args.iter().position(|a| a == super::FLAG) else { return };
    crate::store::set_test_config(std::env::var_os(CONFIG).map(Into::into));
    let line = std::iter::once(args[0].clone()).chain(args[at..].iter().cloned());
    assert_eq!(super::from_args(line), Some(0));
}

#[test]
fn the_command_line_names_the_launcher_and_the_copy_and_nothing_else() {
    let root = std::env::temp_dir().join("shardx-data");
    let dir = root.join("team-open").join("t1").join("p-1");
    let line = |a: &[&str]| a.iter().map(OsString::from).collect::<Vec<_>>();
    let argv = super::argv(4242, &dir);
    assert_eq!(argv, [OsString::from("--reap"), "4242".into(), dir.clone().into_os_string()]);
    // Not a reaper's line: the launcher runs as it always did.
    assert_eq!(super::from_args(line(&["app", "--minimized"])), None);
    assert_eq!(super::from_args(line(&["app"])), None);
    // A reaper's line that is not whole, or names no copy, is refused.
    assert_eq!(super::from_args(line(&["app", "--reap", "4242"])), Some(2));
    let bad_pid = vec!["app".into(), "--reap".into(), "x".into(), dir.clone().into_os_string()];
    assert_eq!(super::from_args(bad_pid), Some(2));
    let not_copies = [root.join("user-data").join("p-1"), "team-open/t1/p-1".into(), root.join("team-open/t1/../p-1")];
    for p in not_copies {
        assert_eq!(super::data_root_of(&p), None, "{}", p.display());
    }
    assert_eq!(super::data_root_of(&dir), Some(root));
}
