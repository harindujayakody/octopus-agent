//! A team browser tied to the launcher's life: SIGHUP when it dies on Linux
//! (PR_SET_PDEATHSIG), a job that ends with it and its reaper on Windows (KILL_ON_JOB_CLOSE).

use std::io;
use tokio::process::{Child, Command};

/// What keeps the tie: on Windows the job, closed once the browser is gone.
#[derive(Default)]
pub struct Tie {
    #[cfg(windows)]
    _job: Option<win::Job>,
}

impl Tie {
    /// The job held by `process` too (the profile's reaper), until it exits: a launcher
    /// killed then leaves the browser for the reaper to close as Stop does, cookies saved.
    #[cfg(windows)]
    pub fn lend(&self, process: std::os::windows::io::RawHandle) -> bool {
        self._job.as_ref().is_some_and(|j| j.lend(process))
    }
}

/// Start `cmd` tied to this process.
#[cfg(target_os = "linux")]
pub async fn spawn(mut cmd: Command) -> io::Result<(Child, Tie)> {
    let parent = std::process::id();
    // SAFETY: prctl and getppid are async-signal-safe.
    unsafe {
        cmd.pre_exec(move || {
            // SIGHUP: Chromium quits and saves on it, as on SIGINT (SIGTERM loses fresh cookies). Not SIGINT
            // itself: the reaper sends that, and a second of the same signal kills it unsaved.
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGHUP as libc::c_ulong, 0, 0, 0) != 0 {
                return Err(io::Error::last_os_error());
            }
            // The launcher died before the line above: nothing would send it.
            if libc::getppid() as u32 != parent {
                return Err(io::Error::from_raw_os_error(libc::ESRCH));
            }
            Ok(())
        });
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = linux::Ask { cmd, rt: tokio::runtime::Handle::current(), tx };
    linux::spawner().send(ask).map_err(|_| io::Error::other("the spawner thread is gone"))?;
    let child = rx.await.map_err(|_| io::Error::other("the spawner thread is gone"))??;
    Ok((child, Tie::default()))
}

#[cfg(target_os = "linux")]
mod linux {
    use std::io;
    use std::sync::mpsc::Sender;
    use std::sync::OnceLock;
    use tokio::process::{Child, Command};

    pub struct Ask {
        pub cmd: Command,
        pub rt: tokio::runtime::Handle,
        pub tx: tokio::sync::oneshot::Sender<io::Result<Child>>,
    }

    /// PR_SET_PDEATHSIG fires when the thread that forked ends, not the process:
    /// so one thread that lives as long as the launcher forks every tied browser.
    pub fn spawner() -> &'static Sender<Ask> {
        static TX: OnceLock<Sender<Ask>> = OnceLock::new();
        TX.get_or_init(|| {
            let (tx, rx) = std::sync::mpsc::channel::<Ask>();
            let run = move || {
                for Ask { mut cmd, rt, tx } in rx {
                    let _in = rt.enter();
                    let _ = tx.send(cmd.spawn());
                }
            };
            if let Err(e) = std::thread::Builder::new().name("browser-spawner".into()).spawn(run) {
                eprintln!("[launcher] the spawner thread did not start: {e}");
            }
            tx
        })
    }
}

#[cfg(windows)]
pub async fn spawn(mut cmd: Command) -> io::Result<(Child, Tie)> {
    use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
    // Held until it is in the job, so nothing it starts escapes it.
    cmd.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    let mut child = cmd.spawn()?;
    let pid = child.id().unwrap_or(0);
    let job = win::Job::new().filter(|j| child.raw_handle().is_some_and(|h| j.assign(h)));
    if !win::resume(pid) {
        let _ = child.start_kill();
        return Err(io::Error::other("the browser was started held and could not be let go"));
    }
    if job.is_none() {
        eprintln!("[launcher] pid {pid} is not in a job: it may outlive a launcher that is killed");
    }
    Ok((child, Tie { _job: job }))
}

#[cfg(windows)]
mod win {
    use std::os::windows::io::RawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    /// A job whose processes end when its last handle closes.
    pub struct Job(HANDLE);

    // SAFETY: a kernel handle, usable from any thread.
    unsafe impl Send for Job {}

    impl Job {
        pub fn new() -> Option<Job> {
            // SAFETY: an unnamed job, closed in Drop.
            let job = Job(unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) });
            if job.0.is_null() {
                return None;
            }
            // SAFETY: plain data, all zero but the one flag.
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
            let set = unsafe {
                SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size)
            };
            (set != 0).then_some(job)
        }

        pub fn assign(&self, process: RawHandle) -> bool {
            // SAFETY: both handles live for the call.
            unsafe { AssignProcessToJobObject(self.0, process as HANDLE) != 0 }
        }

        /// A copy of the job's handle in `process`, closed by its exit.
        pub fn lend(&self, process: RawHandle) -> bool {
            use windows_sys::Win32::Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS};
            use windows_sys::Win32::System::Threading::GetCurrentProcess;
            let mut copy: HANDLE = std::ptr::null_mut();
            // SAFETY: our job and a process handle with PROCESS_DUP_HANDLE, both live for the call.
            unsafe {
                DuplicateHandle(GetCurrentProcess(), self.0, process as HANDLE, &mut copy, 0, 0, DUPLICATE_SAME_ACCESS) != 0
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: our own handle; what is still in the job ends with it.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Let a process started held go: its one thread resumed.
    pub fn resume(pid: u32) -> bool {
        // SAFETY: a snapshot of our own, closed below.
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        // SAFETY: plain data; dwSize says which shape it is.
        let mut te: THREADENTRY32 = unsafe { std::mem::zeroed() };
        te.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut resumed = false;
        let mut more = unsafe { Thread32First(snap, &mut te) } != 0;
        while more {
            if te.th32OwnerProcessID == pid {
                let t = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, te.th32ThreadID) };
                if !t.is_null() {
                    resumed |= unsafe { ResumeThread(t) } != u32::MAX;
                    unsafe { CloseHandle(t) };
                }
            }
            more = unsafe { Thread32Next(snap, &mut te) } != 0;
        }
        unsafe { CloseHandle(snap) };
        resumed
    }
}

/// Elsewhere the reaper alone closes it.
#[cfg(not(any(target_os = "linux", windows)))]
pub async fn spawn(mut cmd: Command) -> io::Result<(Child, Tie)> {
    Ok((cmd.spawn()?, Tie::default()))
}

#[cfg(all(test, windows))]
mod tests {
    use std::time::Duration;

    fn ping(seconds: &str) -> tokio::process::Command {
        let mut c = tokio::process::Command::new("ping");
        c.args(["-n", seconds, "127.0.0.1"]).stdout(std::process::Stdio::null());
        c
    }

    /// A job lent to the reaper outlives the launcher's handle, and ends with the reaper.
    #[tokio::test]
    async fn a_lent_job_ends_with_its_last_holder() {
        let (mut browser, tie) = super::spawn(ping("60")).await.unwrap();
        let mut reaper = ping("60").spawn().unwrap();
        assert!(tie.lend(reaper.raw_handle().unwrap()));
        drop(tie);
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(browser.try_wait().unwrap().is_none(), "ended with the launcher's handle");
        reaper.kill().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), browser.wait()).await.expect("ended with the reaper").unwrap();
    }
}
