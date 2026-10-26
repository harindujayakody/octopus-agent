//! The id Chrome gives an unpacked extension (`extension.cc`, `id_util.cc`):
//! from the manifest's `key` when it has one, otherwise from its folder's path.

use anyhow::{Context, Result};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::Path;

/// 32 letters a..p, Chrome's spelling of an id.
pub fn is_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// The first 16 bytes of a hash, one letter a..p per nibble.
pub fn from_hash(hash: &[u8]) -> String {
    hash.iter()
        .take(16)
        .flat_map(|b| [b >> 4, b & 0x0f])
        .map(|n| char::from(b'a' + n))
        .collect()
}

/// `GenerateId`: the id a public key (SPKI DER) gives.
pub fn id_from_key(der: &[u8]) -> String {
    from_hash(&Sha256::digest(der))
}

/// The manifest's `key` as DER, read as `ParsePEMKeyBytes` reads it.
pub fn decode_key(text: &str) -> Option<Vec<u8>> {
    if text.is_empty() || text.len() > 100 * 1024 {
        return None;
    }
    let mut body = text.to_string();
    if text.starts_with("-----BEGIN") {
        // PEM: whatever lies between "...KEY-----" and the last "-----END".
        let flat = collapse_whitespace(text);
        let start = flat.get(10..)?.find("KEY-----")? + 10 + "KEY-----".len();
        let end = flat.rfind("-----END")?;
        body = flat.get(start..end)?.to_string();
        if body.is_empty() {
            return None;
        }
    }
    base64::engine::general_purpose::STANDARD.decode(body.as_bytes()).ok()
}

/// `CollapseWhitespaceASCII(text, true)`: runs holding a line break go, others become one space.
fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run: Option<bool> = None; // in a run; whether it held a line break
    for c in text.chars() {
        if c.is_ascii_whitespace() || c == '\x0b' {
            let br = c == '\n' || c == '\r';
            run = Some(run.unwrap_or(false) || br);
            continue;
        }
        if let Some(br) = run.take() {
            if !br && !out.is_empty() {
                out.push(' ');
            }
        }
        out.push(c);
    }
    out
}

/// `GenerateIdForPath` for a path already made absolute.
pub fn id_from_path_bytes(bytes: &[u8]) -> String {
    id_from_key(bytes)
}

/// What Chrome hashes on Windows: UTF-16LE, the drive letter upper-cased.
pub fn windows_path_bytes(path: &str) -> Vec<u8> {
    wide_bytes(path.encode_utf16().collect())
}

fn wide_bytes(mut wide: Vec<u16>) -> Vec<u8> {
    if wide.len() >= 2 && wide[1] == u16::from(b':') && (u16::from(b'a')..=u16::from(b'z')).contains(&wide[0]) {
        wide[0] -= 32;
    }
    wide.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// The id Chrome derives from this folder: `realpath` on macOS and Linux,
/// `_wfullpath` (no link resolution) on Windows.
pub fn id_from_path(dir: &Path) -> Result<String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let abs = std::path::absolute(dir).with_context(|| format!("absolute {}", dir.display()))?;
        Ok(id_from_path_bytes(&wide_bytes(abs.as_os_str().encode_wide().collect())))
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::ffi::OsStrExt;
        let abs = std::fs::canonicalize(dir).with_context(|| format!("realpath {}", dir.display()))?;
        Ok(id_from_path_bytes(abs.as_os_str().as_bytes()))
    }
}

/// The id Chrome will give the extension whose manifest.json is in `root`.
pub fn chrome_id(root: &Path) -> Result<String> {
    let manifest = super::manifest_edit::read_manifest(root)?;
    match manifest.get("key") {
        Some(k) => {
            let der = k.as_str().and_then(decode_key).context("manifest.json has an unreadable key")?;
            Ok(id_from_key(&der))
        }
        None => id_from_path(root),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Known answers from Chromium's id_util_unittest.cc.
    #[test]
    fn ids_match_chromium() {
        assert_eq!(id_from_key(b"test"), "jpignaibiiemhngfjkcpokkamffknabf");
        assert_eq!(id_from_key(b"_"), "ncocknphbhhlhkikpnnlmbcnbgdempcd");
        assert_eq!(
            id_from_key(b"this_string_is_longer_than_a_single_sha256_hash_digest"),
            "jimneklojkjdibfkgiiophfhjhbdgcfi"
        );
        assert_eq!(id_from_path_bytes(b"/path/to/file.ext"), "lnkgfdknojmdambfcanadbhmfjfljobb");
        assert_eq!(id_from_path_bytes(&windows_path_bytes("/path/to/file.ext")), "jjlkojfgbeklddcpckipekckcmgcbfjn");
    }

    #[test]
    fn drive_letter_is_upper_cased() {
        assert_eq!(windows_path_bytes("c:\\x"), windows_path_bytes("C:\\x"));
        assert_ne!(windows_path_bytes("\\\\srv\\x"), windows_path_bytes("\\\\SRV\\x"));
    }

    #[test]
    fn keys_as_chrome_reads_them() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"test");
        assert_eq!(decode_key(&b64).as_deref(), Some(&b"test"[..]));
        let pem = format!("-----BEGIN PUBLIC KEY-----\n{b64}\n-----END PUBLIC KEY-----\n");
        assert_eq!(decode_key(&pem).as_deref(), Some(&b"test"[..]));
        let wrapped = format!("-----BEGIN PUBLIC KEY-----\r\n{}\r\n{}\r\n-----END PUBLIC KEY-----", &b64[..4], &b64[4..]);
        assert_eq!(decode_key(&wrapped).as_deref(), Some(&b"test"[..]), "lines joined");
        assert!(decode_key(&format!("-----BEGIN PUBLIC KEY-----{} {}-----END PUBLIC KEY-----", &b64[..4], &b64[4..])).is_none());
        assert!(decode_key("").is_none());
        assert!(decode_key("not base64!").is_none());
        assert!(decode_key("-----BEGIN PUBLIC KEY----------END PUBLIC KEY-----").is_none());
    }

    #[test]
    fn path_id_follows_links_and_key_wins() {
        let dir = std::env::temp_dir().join(format!("shardx-chromeid-{}", uuid::Uuid::new_v4().simple()));
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("manifest.json"), r#"{"name":"x","version":"1","manifest_version":3}"#).unwrap();
        let by_path = chrome_id(&real).unwrap();
        assert_eq!(by_path, id_from_path(&real).unwrap());
        assert!(is_id(&by_path));
        #[cfg(unix)]
        {
            let link = dir.join("link");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            assert_eq!(chrome_id(&link).unwrap(), by_path, "realpath resolves the link");
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"test");
        std::fs::write(real.join("manifest.json"), format!(r#"{{"key":"{b64}","name":"x","version":"1"}}"#)).unwrap();
        assert_eq!(chrome_id(&real).unwrap(), "jpignaibiiemhngfjkcpokkamffknabf");
        std::fs::write(real.join("manifest.json"), r#"{"key":"@@","name":"x","version":"1"}"#).unwrap();
        assert!(chrome_id(&real).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
