//! The authenticator: time-based one-time codes (TOTP, RFC 6238) for the
//! accounts profiles sign in to, as Google Authenticator makes them.
//!
//! Saved accounts live in `<local data>/authenticator.json`, each secret
//! sealed with AES-256-GCM under a key of this computer's own
//! (`authenticator.key`): on Windows that key is itself sealed with DPAPI, so
//! only this Windows user can read it; elsewhere it is a file only this user
//! may read. Codes are made here, so a secret never reaches the page. The
//! quick box (`totp_quick`) saves nothing.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const FILE: &str = "authenticator.json";
const KEY_FILE: &str = "authenticator.key";
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum Algorithm {
    #[default]
    Sha1,
    Sha256,
    Sha512,
}

/// What makes one account's codes.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Params {
    secret: Vec<u8>,
    digits: u32,
    period: u64,
    algorithm: Algorithm,
}

/// A saved account, as stored: its secret sealed.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stored {
    id: String,
    label: String,
    #[serde(default)]
    issuer: String,
    /// nonce(12) || ciphertext, base64.
    secret: String,
    digits: u32,
    period: u64,
    #[serde(default)]
    algorithm: Algorithm,
    /// A profile this account belongs to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    profile_id: Option<String>,
    /// Unix seconds.
    added: u64,
}

/// A saved account with its code now, as the page shows it.
#[derive(Debug, Clone, Serialize)]
pub struct Shown {
    pub id: String,
    pub label: String,
    pub issuer: String,
    pub profile_id: Option<String>,
    pub code: String,
    /// Seconds until this code changes.
    pub remaining: u64,
    pub period: u64,
}

/// One line of the quick box: its code, or why it has none.
#[derive(Debug, Clone, Serialize)]
pub struct Quick {
    pub label: String,
    pub code: Option<String>,
    pub remaining: u64,
    pub period: u64,
    pub error: Option<String>,
}

/// What the Add dialog sends: a secret or an `otpauth://` link, and a name.
#[derive(Debug, Clone, Deserialize)]
pub struct NewAccount {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub issuer: String,
    /// A Base32 secret, or an `otpauth://totp/...` link (as a QR code holds).
    pub secret: String,
    #[serde(default)]
    pub profile_id: Option<String>,
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// RFC 4648 Base32, as authenticator secrets are written: case, spaces,
/// dashes and padding ignored.
fn base32(s: &str) -> Result<Vec<u8>> {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits: u64 = 0;
    let mut n = 0u32;
    let mut out = Vec::new();
    for c in s.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '=') {
        let v = ALPHA
            .iter()
            .position(|&a| a == c.to_ascii_uppercase() as u8)
            .with_context(|| format!("“{c}” is not part of a Base32 secret"))? as u64;
        bits = (bits << 5) | v;
        n += 5;
        if n >= 8 {
            n -= 8;
            out.push((bits >> n) as u8);
            bits &= (1 << n) - 1;
        }
    }
    if out.len() < 10 {
        bail!("the secret is too short to be an authenticator key");
    }
    Ok(out)
}

/// The code for a moment, RFC 6238 over RFC 4226's truncation.
fn code_at(p: &Params, unix: u64) -> String {
    let counter = (unix / p.period).to_be_bytes();
    let mac: Vec<u8> = match p.algorithm {
        Algorithm::Sha1 => {
            let mut m = <Hmac<sha1::Sha1> as Mac>::new_from_slice(&p.secret).expect("any key length");
            m.update(&counter);
            m.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha256 => {
            let mut m = <Hmac<sha2::Sha256> as Mac>::new_from_slice(&p.secret).expect("any key length");
            m.update(&counter);
            m.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha512 => {
            let mut m = <Hmac<sha2::Sha512> as Mac>::new_from_slice(&p.secret).expect("any key length");
            m.update(&counter);
            m.finalize().into_bytes().to_vec()
        }
    };
    let off = (mac[mac.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([mac[off] & 0x7f, mac[off + 1], mac[off + 2], mac[off + 3]]);
    format!("{:0width$}", bin % 10u32.pow(p.digits), width = p.digits as usize)
}

/// A pasted line: a Base32 secret or an `otpauth://` link, with any name it carries.
fn parse(line: &str) -> Result<(Params, String, String)> {
    let line = line.trim();
    if line.to_ascii_lowercase().starts_with("otpauth://") {
        let u = url::Url::parse(line).context("the otpauth link can't be read")?;
        if u.host_str() != Some("totp") {
            bail!("only time-based (TOTP) codes are supported, not “{}”", u.host_str().unwrap_or(""));
        }
        let q = |k: &str| u.query_pairs().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.to_string());
        let path = percent_decode(u.path().trim_start_matches('/'));
        let (issuer_in_path, account) = match path.split_once(':') {
            Some((i, a)) => (i.trim().to_string(), a.trim().to_string()),
            None => (String::new(), path.trim().to_string()),
        };
        let issuer = q("issuer").unwrap_or(issuer_in_path);
        let p = Params {
            secret: base32(&q("secret").context("the otpauth link has no secret")?)?,
            digits: q("digits").and_then(|d| d.parse().ok()).filter(|d| (6..=8).contains(d)).unwrap_or(6),
            period: q("period").and_then(|d| d.parse().ok()).filter(|d| *d > 0 && *d <= 300).unwrap_or(30),
            algorithm: match q("algorithm").map(|a| a.to_ascii_uppercase()).as_deref() {
                Some("SHA256") => Algorithm::Sha256,
                Some("SHA512") => Algorithm::Sha512,
                _ => Algorithm::Sha1,
            },
        };
        return Ok((p, account, issuer));
    }
    Ok((Params { secret: base32(line)?, digits: 6, period: 30, algorithm: Algorithm::Sha1 }, String::new(), String::new()))
}

fn percent_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={s}").as_bytes()).next().map(|(_, v)| v.to_string()).unwrap_or_else(|| s.to_string())
}

// ---- the key and the file ----

fn dir() -> Result<PathBuf> {
    let d = crate::store::local_root()?;
    fs::create_dir_all(&d)?;
    Ok(d)
}

#[cfg(target_os = "windows")]
fn dpapi(input: &[u8], protect: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
    let in_blob = CRYPT_INTEGER_BLOB { cbData: input.len() as u32, pbData: input.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: both blobs live across the call; the output is freed with LocalFree below.
    let ok = unsafe {
        if protect {
            CryptProtectData(&in_blob, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out)
        } else {
            CryptUnprotectData(&in_blob, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out)
        }
    };
    if ok == 0 {
        bail!("Windows could not {} the authenticator's key", if protect { "seal" } else { "open" });
    }
    // SAFETY: DPAPI filled `out` with cbData bytes it allocated.
    let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _) };
    Ok(bytes)
}

/// This computer's key for the saved secrets, made on first use.
fn vault_key() -> Result<[u8; 32]> {
    let path = dir()?.join(KEY_FILE);
    if let Ok(stored) = fs::read(&path) {
        #[cfg(target_os = "windows")]
        let raw = dpapi(&stored, false)?;
        #[cfg(not(target_os = "windows"))]
        let raw = stored;
        return raw.try_into().map_err(|_| anyhow::anyhow!("the authenticator's key is damaged"));
    }
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|e| anyhow::anyhow!("no random source: {e}"))?;
    #[cfg(target_os = "windows")]
    let stored = dpapi(&key, true)?;
    #[cfg(not(target_os = "windows"))]
    let stored = key.to_vec();
    fs::write(&path, &stored)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn seal(key: &[u8; 32], plain: &[u8]) -> Result<String> {
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce).map_err(|e| anyhow::anyhow!("no random source: {e}"))?;
    let ct = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key))
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|_| anyhow::anyhow!("sealing the secret failed"))?;
    Ok(STANDARD.encode([nonce.as_slice(), &ct].concat()))
}

fn open(key: &[u8; 32], sealed: &str) -> Result<Vec<u8>> {
    let body = STANDARD.decode(sealed).context("a saved secret is damaged")?;
    if body.len() < 12 + 16 {
        bail!("a saved secret is damaged");
    }
    let (nonce, ct) = body.split_at(12);
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key))
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| anyhow::anyhow!("a saved secret can't be opened on this computer"))
}

fn read() -> Result<Vec<Stored>> {
    match fs::read_to_string(dir()?.join(FILE)) {
        Ok(s) => Ok(serde_json::from_str(&s).context("the authenticator's file is damaged")?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn write(all: &[Stored]) -> Result<()> {
    let path = dir()?.join(FILE);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(all)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn shown(key: &[u8; 32], s: &Stored, at: u64) -> Result<Shown> {
    let p = Params { secret: open(key, &s.secret)?, digits: s.digits, period: s.period, algorithm: s.algorithm };
    Ok(Shown {
        id: s.id.clone(),
        label: s.label.clone(),
        issuer: s.issuer.clone(),
        profile_id: s.profile_id.clone(),
        code: code_at(&p, at),
        remaining: s.period - at % s.period,
        period: s.period,
    })
}

pub fn list() -> Result<Vec<Shown>> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let all = read()?;
    if all.is_empty() {
        return Ok(Vec::new());
    }
    let key = vault_key()?;
    let at = now();
    all.iter().map(|s| shown(&key, s, at)).collect()
}

pub fn add(new: NewAccount) -> Result<Shown> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, account, issuer_in) = parse(&new.secret)?;
    let label = Some(new.label.trim()).filter(|l| !l.is_empty()).map(str::to_string).unwrap_or(account);
    let issuer = Some(new.issuer.trim()).filter(|i| !i.is_empty()).map(str::to_string).unwrap_or(issuer_in);
    if label.is_empty() && issuer.is_empty() {
        bail!("Give the account a name.");
    }
    let key = vault_key()?;
    let stored = Stored {
        id: uuid::Uuid::new_v4().simple().to_string(),
        label,
        issuer,
        secret: seal(&key, &p.secret)?,
        digits: p.digits,
        period: p.period,
        algorithm: p.algorithm,
        profile_id: new.profile_id.filter(|s| !s.trim().is_empty()),
        added: now(),
    };
    let mut all = read()?;
    all.push(stored.clone());
    write(&all)?;
    shown(&key, &stored, now())
}

pub fn remove(id: &str) -> Result<()> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read()?;
    let before = all.len();
    all.retain(|s| s.id != id);
    if all.len() == before {
        bail!("That account is already gone.");
    }
    write(&all)
}

/// Codes for pasted lines, one per line; nothing is kept.
pub fn quick(lines: &[String]) -> Vec<Quick> {
    let at = now();
    lines
        .iter()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| match parse(l) {
            Ok((p, account, issuer)) => Quick {
                label: [issuer, account].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(": "),
                code: Some(code_at(&p, at)),
                remaining: p.period - at % p.period,
                period: p.period,
                error: None,
            },
            Err(e) => Quick { label: String::new(), code: None, remaining: 0, period: 30, error: Some(format!("{e:#}")) },
        })
        .collect()
}

#[tauri::command]
pub fn totp_list() -> Result<Vec<Shown>, String> {
    list().map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn totp_add(account: NewAccount) -> Result<Shown, String> {
    add(account).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn totp_remove(id: String) -> Result<(), String> {
    remove(&id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn totp_quick(lines: Vec<String>) -> Vec<Quick> {
    quick(&lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 appendix B, SHA-1 and SHA-256 at T = 59 s, 8 digits.
    #[test]
    fn rfc_6238_vectors() {
        let p = Params { secret: b"12345678901234567890".to_vec(), digits: 8, period: 30, algorithm: Algorithm::Sha1 };
        assert_eq!(code_at(&p, 59), "94287082");
        assert_eq!(code_at(&p, 1111111109), "07081804");
        let p256 = Params { secret: b"12345678901234567890123456789012".to_vec(), digits: 8, period: 30, algorithm: Algorithm::Sha256 };
        assert_eq!(code_at(&p256, 59), "46119246");
    }

    #[test]
    fn base32_and_otpauth_links_are_read() {
        assert_eq!(base32("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap(), b"12345678901234567890");
        assert_eq!(base32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").unwrap(), b"12345678901234567890");
        let (p, account, issuer) =
            parse("otpauth://totp/ACME%20Co:john@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ACME%20Co&digits=8").unwrap();
        assert_eq!((account.as_str(), issuer.as_str(), p.digits), ("john@example.com", "ACME Co", 8));
        assert!(parse("not a secret!").is_err());
    }
}
