//! `<launcher> --reap <ppid> <dir>`: one detached process per team or synced profile open here.
//! If the launcher dies, it closes the browser, sends the session back and wipes the copy.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

mod parent;
#[cfg(test)]
pub(crate) mod tests;

const FLAG: &str = "--reap";
/// How often it looks whether the copy is still there.
const LOOK_EVERY: Duration = Duration::from_secs(1);
/// How long a wipe held up by a lock (Windows) is tried again.
const WIPE_FOR: Duration = Duration::from_secs(120);

static REAPER: AtomicBool = AtomicBool::new(false);

/// This process is a reaper: a lost token is left for the launcher to handle.
pub fn in_reaper() -> bool {
    REAPER.load(Ordering::Relaxed)
}

/// What follows the program on a reaper's command line.
pub fn argv(ppid: u32, dir: &Path) -> Vec<OsString> {
    vec![FLAG.into(), ppid.to_string().into(), dir.as_os_str().to_owned()]
}

/// Run as a reaper when the command line asks for one: its exit code then.
pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Option<i32> {
    let mut args = args.into_iter().skip(1);
    if args.next()? != FLAG {
        return None;
    }
    let (Some(ppid), Some(dir), None) = (args.next(), args.next(), args.next()) else {
        return Some(2);
    };
    let Some(ppid) = ppid.to_str().and_then(|p| p.parse::<u32>().ok()) else {
        return Some(2);
    };
    Some(run(ppid, PathBuf::from(dir)))
}

/// The data root a copy lives under: only `<root>/team-open/<home>/<id>` is reaped.
fn data_root_of(dir: &Path) -> Option<PathBuf> {
    use std::path::Component;
    let plain = dir.is_absolute() && !dir.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir));
    let open = dir.parent()?.parent()?;
    if !plain || open.file_name()? != "team-open" {
        return None;
    }
    open.parent().map(Path::to_path_buf)
}

fn run(ppid: u32, dir: PathBuf) -> i32 {
    REAPER.store(true, Ordering::Relaxed);
    let Some(root) = data_root_of(&dir) else {
        eprintln!("[reaper] {} is not an open copy", dir.display());
        return 2;
    };
    crate::store::set_data_root(Some(root));
    let Some(nonce) = super::open::nonce_at(&dir) else { return 0 };
    let mut parent = parent::Parent::watch(ppid);
    loop {
        if !super::open::still_there(&dir, &nonce) {
            return 0;
        }
        if parent.ended_within(LOOK_EVERY) {
            break;
        }
    }
    eprintln!("[reaper] the launcher (pid {ppid}) is gone; closing {}", dir.display());
    let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else { return 1 };
    let mine = rt.block_on(super::open::reap(dir.clone(), &nonce));
    drop(rt);
    // What a lock held up is tried again a while; the next start's sweep has the rest.
    let until = Instant::now() + WIPE_FOR;
    while mine && !super::open::retry_left() && Instant::now() < until {
        std::thread::sleep(Duration::from_secs(2));
    }
    0
}

/// A reaper as started: on Windows its process, which the browser's job is lent to.
#[derive(Default)]
pub struct Reaper {
    #[cfg(windows)]
    process: Option<std::os::windows::io::OwnedHandle>,
}

impl Reaper {
    /// Holds the job `tie` keeps too, where the OS has one.
    pub fn hold(&self, tie: &crate::process::Tie) {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            if !self.process.as_ref().is_some_and(|p| tie.lend(p.as_raw_handle())) {
                eprintln!("[launcher] the reaper holds no job: a launcher killed ends the browser unsaved");
            }
        }
        #[cfg(not(windows))]
        let _ = tie;
    }
}

/// Start the reaper of the copy at `dir`, detached: it outlives this process.
pub fn spawn(dir: &Path) -> std::io::Result<Reaper> {
    #[cfg(test)]
    if !tests::spawning() {
        return Ok(Reaper::default());
    }
    let mut child = match command(dir, true)?.spawn() {
        Ok(c) => c,
        // Inside a job that lets nothing break away: started inside it.
        Err(_) if cfg!(windows) => command(dir, false)?.spawn()?,
        Err(e) => return Err(e),
    };
    #[cfg(test)]
    tests::started(dir, child.id());
    #[cfg(windows)]
    let reaper = Reaper {
        // SAFETY: the child's own handle, live while `child` is; the copy is ours.
        process: child.raw_handle().and_then(|h| unsafe { std::os::windows::io::BorrowedHandle::borrow_raw(h) }.try_clone_to_owned().ok()),
    };
    #[cfg(not(windows))]
    let reaper = Reaper::default();
    // Waited for, so its exit leaves nothing behind.
    super::live::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(reaper)
}

fn command(dir: &Path, _break_away: bool) -> std::io::Result<tokio::process::Command> {
    use std::process::Stdio;
    // On Linux the running binary even when an update replaced it on disk.
    let exe = if cfg!(target_os = "linux") { PathBuf::from("/proc/self/exe") } else { std::env::current_exe()? };
    let mut cmd = tokio::process::Command::new(exe);
    #[cfg(not(test))]
    cmd.args(argv(std::process::id(), dir));
    #[cfg(test)]
    tests::as_reaper_command(&mut cmd, dir);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    // SAFETY: setsid is async-signal-safe. A session of its own: no hangup or group signal reaches it.
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{
            CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
        };
        let away = if _break_away { CREATE_BREAKAWAY_FROM_JOB } else { 0 };
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | away);
    }
    Ok(cmd)
}
