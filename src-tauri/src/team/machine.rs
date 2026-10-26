//! This computer as its OS names it, hashed: settings copied to another
//! computer (a migration, a backup restored) do not carry its device id there.

/// A digest of the OS's id for this computer; None where it cannot be read.
pub fn key() -> Option<String> {
    #[cfg(test)]
    if let Some(k) = FORCED.with(|f| f.borrow().clone()) {
        return k;
    }
    let raw = raw()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(format!("shardx-device:{raw}").as_bytes());
    Some(d.iter().take(16).map(|b| format!("{b:02x}")).collect())
}

/// The hardware UUID, as IOPlatformUUID gives it.
#[cfg(target_os = "macos")]
fn raw() -> Option<String> {
    let mut id = [0u8; 16];
    let wait = libc::timespec { tv_sec: 1, tv_nsec: 0 };
    // SAFETY: a 16-byte buffer, the size of uuid_t.
    if unsafe { libc::gethostuuid(id.as_mut_ptr(), &wait) } != 0 || id == [0; 16] {
        return None;
    }
    Some(id.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(target_os = "linux")]
fn raw() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"].iter().find_map(|p| std::fs::read_to_string(p).ok().filter(|s| !s.trim().is_empty()))
}

/// MachineGuid, made when Windows is installed.
#[cfg(windows)]
fn raw() -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (key, name) = (wide("SOFTWARE\\Microsoft\\Cryptography"), wide("MachineGuid"));
    let mut buf = [0u16; 128];
    let mut size = std::mem::size_of_val(&buf) as u32;
    // SAFETY: NUL-terminated names, and a buffer of the size given.
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if rc != 0 {
        return None;
    }
    let n = (size as usize / 2).min(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]).trim_end_matches('\0').to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn raw() -> Option<String> {
    None
}

#[cfg(test)]
thread_local! {
    /// What this thread's test says the computer is.
    static FORCED: std::cell::RefCell<Option<Option<String>>> = const { std::cell::RefCell::new(None) };
}

/// The computer this thread's test runs as; None goes back to the real one.
#[cfg(test)]
pub fn force(key: Option<Option<&str>>) {
    FORCED.with(|f| *f.borrow_mut() = key.map(|k| k.map(str::to_owned)));
}

#[cfg(test)]
mod tests {
    #[test]
    fn this_computer_has_a_key_that_stays_the_same() {
        let k = super::key();
        if cfg!(any(target_os = "macos", windows)) {
            assert!(k.as_deref().is_some_and(|k| k.len() == 32), "{k:?}");
        }
        assert_eq!(super::key(), k);
    }
}
