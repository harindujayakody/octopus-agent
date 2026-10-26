//! What the OS says about the engine folder: who runs from it, and the room
//! left on its disk. Std, libc and windows-sys only.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Processes running from a folder. `browsers` are the engine binaries started
/// as a browser: one per running profile (or GPU probe).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Holders {
    pub processes: usize,
    pub browsers: usize,
    /// Of `browsers`, those the launcher did not start in this run.
    pub untracked: usize,
}

impl Holders {
    pub fn any(&self) -> bool {
        self.processes > 0 || self.browsers > 0
    }
}

struct Proc {
    pid: u32,
    ppid: u32,
    image: PathBuf,
    /// Started with `--type=` (renderer, GPU, crashpad); None where the
    /// command line cannot be read.
    helper: Option<bool>,
}

/// Who runs from `dir`; `browser` is the engine binary inside it.
pub fn holders(dir: &Path, browser: &Path) -> Holders {
    let (dir, browser) = (norm(dir), norm(browser));
    let inside: Vec<Proc> = processes()
        .into_iter()
        .map(|p| Proc { image: norm(&p.image), ..p })
        .filter(|p| under(&p.image, &dir))
        .collect();
    Holders { processes: inside.len(), browsers: browsers(&inside, &browser), untracked: 0 }
}

/// The engine binary not started as a helper. Without a command line, one whose
/// parent is not an engine process (an orphaned helper then counts: Windows
/// keeps a dead parent's pid).
fn browsers(inside: &[Proc], browser: &Path) -> usize {
    let pids: HashSet<u32> = inside.iter().map(|p| p.pid).collect();
    inside
        .iter()
        .filter(|p| p.image == browser && p.helper.map_or(!pids.contains(&p.ppid), |h| !h))
        .count()
}

/// Chromium's helpers carry `--type=`; the browser never does.
#[cfg(any(target_os = "linux", windows))]
fn is_helper(cmdline: &[u8]) -> bool {
    cmdline.windows(7).any(|w| w == b"--type=")
}

/// One spelling per path: real (macOS /var is /private/var), or Windows'
/// case-blind form without the `\\?\` prefix.
fn norm(p: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy().replace('/', "\\").to_lowercase();
        PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).trim_end_matches('\\'))
    }
    #[cfg(not(windows))]
    {
        // Linux names a replaced binary "<path> (deleted)": still that folder.
        let s = p.to_string_lossy();
        let p = Path::new(s.strip_suffix(" (deleted)").unwrap_or(&s));
        p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
    }
}

fn under(path: &Path, dir: &Path) -> bool {
    path != dir && path.starts_with(dir)
}

#[cfg(target_os = "macos")]
fn processes() -> Vec<Proc> {
    use std::os::unix::ffi::OsStrExt;
    // SAFETY: a null buffer only asks how many there are.
    let n = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if n <= 0 {
        return Vec::new();
    }
    let mut pids = vec![0 as libc::pid_t; n as usize + 64];
    let bytes = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
    // SAFETY: the buffer is `bytes` long.
    let n = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    let n = (n.max(0) as usize).min(pids.len());
    let mut out = Vec::new();
    for &pid in &pids[..n] {
        if pid <= 0 {
            continue;
        }
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        // SAFETY: the buffer is as long as said.
        let len = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if len <= 0 {
            continue;
        }
        let image = PathBuf::from(std::ffi::OsStr::from_bytes(&buf[..len as usize]));
        // SAFETY: plain data, zero is a valid value of every field.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        // SAFETY: the buffer is the struct this flavor fills, and of its size.
        let got = unsafe {
            libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size)
        };
        let ppid = if got == size { info.pbi_ppid } else { 0 };
        // Helpers are their own binaries here, so the parent rule is enough.
        out.push(Proc { pid: pid as u32, ppid, image, helper: None });
    }
    out
}

#[cfg(target_os = "linux")]
fn processes() -> Vec<Proc> {
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new() };
    let mut out = Vec::new();
    for ent in dir.flatten() {
        let Some(pid) = ent.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
        let Ok(image) = std::fs::read_link(ent.path().join("exe")) else { continue };
        // Fields after the name in parentheses: state, then the parent.
        let ppid = std::fs::read_to_string(ent.path().join("stat"))
            .ok()
            .and_then(|s| s.rfind(')').and_then(|i| s[i + 1..].split_whitespace().nth(1).map(str::to_string)))
            .and_then(|p| p.parse().ok())
            .unwrap_or(0);
        let helper = std::fs::read(ent.path().join("cmdline")).ok().map(|c| is_helper(&c));
        out.push(Proc { pid, ppid, image, helper });
    }
    out
}

#[cfg(windows)]
fn processes() -> Vec<Proc> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, UNICODE_STRING};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// Whether its command line has `--type=` (Windows 8.1 and later).
    fn helper(h: HANDLE) -> Option<bool> {
        let mut need = 0u32;
        // SAFETY: a null buffer of length 0 only asks for the size.
        unsafe { NtQueryInformationProcess(h, ProcessCommandLineInformation, std::ptr::null_mut(), 0, &mut need) };
        // u64s keep the UNICODE_STRING at its start aligned.
        let words = (need as usize).div_ceil(8).max(std::mem::size_of::<UNICODE_STRING>().div_ceil(8));
        let mut buf = vec![0u64; words];
        let len = (buf.len() * 8) as u32;
        // SAFETY: the buffer is `len` bytes long.
        let status = unsafe {
            NtQueryInformationProcess(h, ProcessCommandLineInformation, buf.as_mut_ptr().cast(), len, &mut need)
        };
        if status < 0 {
            return None;
        }
        // SAFETY: on success the buffer starts with a UNICODE_STRING whose text
        // lies inside the same buffer, which outlives this read.
        let text = unsafe {
            let us = &*(buf.as_ptr() as *const UNICODE_STRING);
            if us.Buffer.is_null() {
                return None;
            }
            std::slice::from_raw_parts(us.Buffer, us.Length as usize / 2)
        };
        let bytes: Vec<u8> = text.iter().map(|&c| if c < 0x80 { c as u8 } else { b'?' }).collect();
        Some(is_helper(&bytes))
    }

    fn image(pid: u32) -> Option<(PathBuf, Option<bool>)> {
        // SAFETY: closed below; limited rights are enough for the image name.
        let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if h.is_null() {
            return None;
        }
        let mut buf = vec![0u16; 32768];
        let mut len = buf.len() as u32;
        // SAFETY: `len` is the buffer's length in characters.
        let ok = unsafe { QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) } != 0;
        let helper = if ok { helper(h) } else { None };
        // SAFETY: our own handle.
        unsafe { CloseHandle(h) };
        ok.then(|| (PathBuf::from(std::ffi::OsString::from_wide(&buf[..len as usize])), helper))
    }

    // SAFETY: a snapshot of our own, closed below.
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    // SAFETY: plain data; dwSize says which shape it is.
    let mut e: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut out = Vec::new();
    // SAFETY: the snapshot and the entry live for the walk.
    let mut more = unsafe { Process32FirstW(snap, &mut e) } != 0;
    while more {
        if e.th32ProcessID != 0 {
            if let Some((image, helper)) = image(e.th32ProcessID) {
                out.push(Proc { pid: e.th32ProcessID, ppid: e.th32ParentProcessID, image, helper });
            }
        }
        // SAFETY: as above.
        more = unsafe { Process32NextW(snap, &mut e) } != 0;
    }
    // SAFETY: our own handle.
    unsafe { CloseHandle(snap) };
    out
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn processes() -> Vec<Proc> {
    Vec::new()
}

/// Bytes the current user may still write on the disk holding `dir`.
#[cfg(unix)]
pub fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: plain data, filled by the call.
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: a NUL-terminated path and the struct the call fills.
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some((st.f_bavail as u64).saturating_mul(st.f_frsize as u64))
}

#[cfg(windows)]
pub fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut avail = 0u64;
    // SAFETY: a NUL-terminated path; the totals we do not need are null.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(avail)
}

#[cfg(not(any(unix, windows)))]
pub fn free_bytes(_dir: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_disk_answers_how_much_room_is_left() {
        let free = free_bytes(&std::env::temp_dir()).expect("statvfs on the temp dir");
        assert!(free > 0);
    }

    /// A browser started from the folder counts once; what it started counts as
    /// a process, not as another browser; a folder nobody runs from is free.
    #[cfg(unix)]
    #[test]
    fn processes_running_from_the_folder_are_found() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("shardx-holders-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let engine = dir.join("engine");
        std::fs::create_dir_all(&engine).unwrap();
        // A real binary under our own name, as the engine is.
        let browser = engine.join("browser");
        std::fs::copy("/bin/sleep", &browser).unwrap();
        std::fs::set_permissions(&browser, std::fs::Permissions::from_mode(0o755)).unwrap();
        let elsewhere = dir.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        assert_eq!(holders(&elsewhere, &elsewhere.join("browser")), Holders::default());

        let mut a = std::process::Command::new(&browser).arg("30").spawn().unwrap();
        let mut b = std::process::Command::new(&browser).arg("30").spawn().unwrap();
        let found = holders(&engine, &browser);
        a.kill().unwrap();
        b.kill().unwrap();
        let _ = a.wait();
        let _ = b.wait();
        assert_eq!(found, Holders { processes: 2, browsers: 2, untracked: 0 });
        assert!(!holders(&engine, &browser).any(), "gone once they end");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A helper whose browser died is not a running profile; without a
    /// command line, the parent decides.
    #[test]
    fn helpers_are_not_browsers_even_once_orphaned() {
        let bin = PathBuf::from("/e/chrome");
        let p = |pid, ppid, helper| Proc { pid, ppid, image: bin.clone(), helper };
        let crashpad = PathBuf::from("/e/crashpad");
        let procs = [
            p(10, 1, Some(false)),   // a browser
            p(11, 10, Some(true)),   // its renderer
            p(20, 999, Some(true)),  // a GPU process whose browser is gone
            Proc { pid: 21, ppid: 999, image: crashpad, helper: None },
        ];
        assert_eq!(browsers(&procs, &bin), 1);
        let unread = [p(30, 1, None), p(31, 30, None)];
        assert_eq!(browsers(&unread, &bin), 1);
    }
}
