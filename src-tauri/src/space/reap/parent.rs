//! The reaper's view of the launcher that started it: told the moment it ends
//! (kqueue on macOS, a pidfd on Linux, a process handle on Windows).

use std::time::Duration;

/// The launcher, watched from its reaper.
pub struct Parent {
    imp: imp::Watch,
}

impl Parent {
    /// Watch `pid`, the launcher that started this process.
    pub fn watch(pid: u32) -> Parent {
        Parent { imp: imp::watch(pid) }
    }

    /// Whether it has ended, waiting up to `wait` for it to.
    pub fn ended_within(&mut self, wait: Duration) -> bool {
        self.imp.ended_within(wait)
    }
}

/// Still this process's parent: a dead parent's children go to another at once.
#[cfg(unix)]
fn is_parent(pid: u32) -> bool {
    // SAFETY: getppid has no preconditions.
    unsafe { libc::getppid() as u32 == pid }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::is_parent;
    use std::time::Duration;

    pub struct Watch {
        kq: i32,
        pid: u32,
        gone: bool,
    }

    pub fn watch(pid: u32) -> Watch {
        let mut w = Watch { kq: -1, pid, gone: !is_parent(pid) };
        if w.gone {
            return w;
        }
        // SAFETY: a new queue, closed in Drop.
        let kq = unsafe { libc::kqueue() };
        if kq < 0 {
            return w;
        }
        let ev = libc::kevent {
            ident: pid as libc::uintptr_t,
            filter: libc::EVFILT_PROC,
            flags: libc::EV_ADD | libc::EV_ONESHOT,
            fflags: libc::NOTE_EXIT,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        // SAFETY: one change in, nothing out.
        if unsafe { libc::kevent(kq, &ev, 1, std::ptr::null_mut(), 0, std::ptr::null()) } < 0 {
            w.gone = std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
            unsafe { libc::close(kq) };
            return w;
        }
        w.kq = kq;
        // Ended between the look and the watch.
        w.gone = !is_parent(pid);
        w
    }

    impl Watch {
        pub fn ended_within(&mut self, wait: Duration) -> bool {
            if self.gone {
                return true;
            }
            if self.kq >= 0 {
                let ts = libc::timespec { tv_sec: wait.as_secs() as _, tv_nsec: wait.subsec_nanos() as _ };
                // SAFETY: room for the one event asked for.
                let mut out: libc::kevent = unsafe { std::mem::zeroed() };
                let n = unsafe { libc::kevent(self.kq, std::ptr::null(), 0, &mut out, 1, &ts) };
                self.gone = n > 0;
            } else {
                std::thread::sleep(wait);
            }
            self.gone = self.gone || !is_parent(self.pid);
            self.gone
        }
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            if self.kq >= 0 {
                // SAFETY: our own descriptor.
                unsafe { libc::close(self.kq) };
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::is_parent;
    use std::time::Duration;

    pub struct Watch {
        fd: i32,
        pid: u32,
        gone: bool,
    }

    pub fn watch(pid: u32) -> Watch {
        let mut w = Watch { fd: -1, pid, gone: !is_parent(pid) };
        if w.gone {
            return w;
        }
        // SAFETY: a new descriptor, closed in Drop; before Linux 5.3 it fails and getppid is read instead.
        w.fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::pid_t, 0) } as i32;
        w.gone = !is_parent(pid);
        w
    }

    impl Watch {
        pub fn ended_within(&mut self, wait: Duration) -> bool {
            if self.gone {
                return true;
            }
            if self.fd >= 0 {
                let mut p = libc::pollfd { fd: self.fd, events: libc::POLLIN, revents: 0 };
                let ms = wait.as_millis().min(i32::MAX as u128) as i32;
                // SAFETY: one pollfd, ours.
                self.gone = unsafe { libc::poll(&mut p, 1, ms) } > 0;
            } else {
                std::thread::sleep(wait);
            }
            self.gone = self.gone || !is_parent(self.pid);
            self.gone
        }
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            if self.fd >= 0 {
                // SAFETY: our own descriptor.
                unsafe { libc::close(self.fd) };
            }
        }
    }
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
mod imp {
    use super::is_parent;
    use std::time::Duration;

    pub struct Watch {
        pid: u32,
    }

    pub fn watch(pid: u32) -> Watch {
        Watch { pid }
    }

    impl Watch {
        pub fn ended_within(&mut self, wait: Duration) -> bool {
            if is_parent(self.pid) {
                std::thread::sleep(wait);
            }
            !is_parent(self.pid)
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, FILETIME, HANDLE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetProcessTimes, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SYNCHRONIZE,
    };

    pub struct Watch {
        handle: HANDLE,
        gone: bool,
    }

    pub fn watch(pid: u32) -> Watch {
        // SAFETY: a handle of our own, closed in Drop.
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            // No such pid: it ended. Anything else leaves the sweep to close it.
            return Watch { handle, gone: unsafe { GetLastError() } == ERROR_INVALID_PARAMETER };
        }
        // A pid taken again after the launcher ended names a process younger than this one.
        let me = started(unsafe { GetCurrentProcess() });
        let gone = started(handle).zip(me).is_some_and(|(p, me)| p > me);
        Watch { handle, gone }
    }

    fn started(h: HANDLE) -> Option<u64> {
        let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut c, mut e, mut k, mut u) = (zero, zero, zero, zero);
        // SAFETY: four FILETIMEs to fill.
        if unsafe { GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) } == 0 {
            return None;
        }
        Some(((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64)
    }

    impl Watch {
        pub fn ended_within(&mut self, wait: Duration) -> bool {
            if self.gone {
                return true;
            }
            if self.handle.is_null() {
                std::thread::sleep(wait);
                return false;
            }
            let ms = wait.as_millis().min(u32::MAX as u128 - 1) as u32;
            // SAFETY: our own handle.
            self.gone = unsafe { WaitForSingleObject(self.handle, ms) } == WAIT_OBJECT_0;
            self.gone
        }
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                // SAFETY: our own handle.
                unsafe { CloseHandle(self.handle) };
            }
        }
    }
}
