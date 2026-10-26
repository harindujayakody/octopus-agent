//! When a process started: what tells a browser from whatever took its pid later.

use std::time::SystemTime;
#[cfg(any(target_os = "macos", target_os = "linux", windows))]
use std::time::Duration;

/// When `pid` started; None when it is not there, has ended, or this OS is not asked.
#[cfg(target_os = "macos")]
pub fn started_at(pid: u32) -> Option<SystemTime> {
    let pid = libc::c_int::try_from(pid).ok().filter(|p| *p > 0)?;
    // SAFETY: plain data, zero is a valid value of every field.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: the buffer is the struct this flavor fills, and of its size.
    let n = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
    // An ended process not yet reaped (SZOMB) has ended.
    if n != size || info.pbi_status == 5 {
        return None;
    }
    Some(SystemTime::UNIX_EPOCH + Duration::from_secs(info.pbi_start_tvsec) + Duration::from_micros(info.pbi_start_tvusec))
}

/// When `pid` started; None when it is not there or this OS is not asked.
#[cfg(target_os = "linux")]
pub fn started_at(pid: u32) -> Option<SystemTime> {
    if pid == 0 {
        return None;
    }
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // Its name, in parentheses, may hold spaces: fields count from after it, the state first.
    let rest: Vec<&str> = stat[stat.rfind(')')? + 1..].split_whitespace().collect();
    // An ended process not yet reaped has ended.
    if matches!(rest.first(), Some(&"Z" | &"X")) {
        return None;
    }
    let ticks: u64 = rest.get(19)?.parse().ok()?;
    // SAFETY: sysconf has no preconditions.
    let hz = u64::try_from(unsafe { libc::sysconf(libc::_SC_CLK_TCK) }).ok().filter(|h| *h > 0)?;
    let boot: u64 = std::fs::read_to_string("/proc/stat").ok()?.lines().find_map(|l| l.strip_prefix("btime "))?.trim().parse().ok()?;
    Some(SystemTime::UNIX_EPOCH + Duration::from_secs(boot) + Duration::from_millis(ticks * 1000 / hz))
}

/// When `pid` started; None when it is not there or has ended.
#[cfg(windows)]
pub fn started_at(pid: u32) -> Option<SystemTime> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    };
    if pid == 0 {
        return None;
    }
    // SAFETY: a handle of our own, closed below.
    let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, 0, pid) };
    if h.is_null() {
        return None;
    }
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut made, mut exit, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: a live handle and four out-parameters. An ended process still has times: the wait tells.
    let up = unsafe {
        WaitForSingleObject(h, 0) == WAIT_TIMEOUT && GetProcessTimes(h, &mut made, &mut exit, &mut kernel, &mut user) != 0
    };
    // SAFETY: opened above.
    unsafe { CloseHandle(h) };
    // 100 ns ticks since 1601, 11644473600 s before 1970.
    let ticks = (u64::from(made.dwHighDateTime) << 32) | u64::from(made.dwLowDateTime);
    let since_1970 = ticks.checked_sub(11_644_473_600 * 10_000_000).filter(|_| up)?;
    Some(SystemTime::UNIX_EPOCH + Duration::from_nanos(since_1970 * 100))
}

/// When `pid` started; None when it is not there or this OS is not asked.
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn started_at(_pid: u32) -> Option<SystemTime> {
    None
}

#[cfg(test)]
mod tests {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_process_started_when_it_did_and_a_gone_one_did_not() {
        let now = std::time::SystemTime::now();
        let mut c = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        let at = super::started_at(c.id()).expect("its start");
        let off = at.duration_since(now).unwrap_or_else(|e| e.duration());
        assert!(off < std::time::Duration::from_secs(3), "{off:?}");
        assert_eq!(super::started_at(c.id()), Some(at), "the same each time it is asked");
        c.kill().unwrap();
        c.wait().unwrap();
        assert_eq!(super::started_at(c.id()), None);
        assert!(super::started_at(std::process::id()).is_some_and(|t| t <= at));
    }

    #[cfg(windows)]
    #[test]
    fn a_process_started_when_it_did_and_a_gone_one_did_not() {
        let now = std::time::SystemTime::now();
        let mut c = std::process::Command::new("ping").args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        let at = super::started_at(c.id()).expect("its start");
        let off = at.duration_since(now).unwrap_or_else(|e| e.duration());
        assert!(off < std::time::Duration::from_secs(3), "{off:?}");
        assert_eq!(super::started_at(c.id()), Some(at), "the same each time it is asked");
        c.kill().unwrap();
        c.wait().unwrap();
        // Its handle still open here: the pid is not anyone else's yet, and it has ended.
        assert_eq!(super::started_at(c.id()), None);
        assert!(super::started_at(std::process::id()).is_some_and(|t| t <= at));
    }
}
