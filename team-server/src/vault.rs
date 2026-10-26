//! The server's own key, and what it locks.
//!
//! The server decides who sees what, on its own and at once — whoever else is
//! online. That needs it to be able to read the team's profiles, so they are
//! encrypted at rest with a key the server holds, not with keys only members
//! have. The person running the server can therefore read the team's data;
//! that is the owner, on their own machine.
//!
//! What the key does buy: it lives in a file of its own beside the database,
//! readable only by the account the server runs as. A copy of the database
//! alone — a backup, a disk image, a stolen file — opens nothing.

use aes_gcm::aead::{Aead, AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce, Tag};
use anyhow::{bail, Context, Result};
use std::path::Path;

const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const KEY_LEN: usize = 32;

/// What [`Vault::seal_detached`] keeps apart from the bytes: format, nonce, tag.
pub const ENVELOPE_LEN: usize = 1 + NONCE_LEN + TAG_LEN;

/// A format byte at the front of everything sealed, so a future change of
/// cipher can tell old blobs from new ones instead of failing on them.
const FORMAT_V1: u8 = 1;

pub struct Vault {
    cipher: Aes256Gcm,
}

impl Vault {
    /// Open the key file, or make one on first run. It is written with
    /// owner-only permissions before any data is sealed with it.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        let key = match std::fs::read(path) {
            Ok(bytes) => {
                if bytes.len() != KEY_LEN {
                    bail!(
                        "{} is {} bytes, a key is {KEY_LEN}: refusing to guess",
                        path.display(),
                        bytes.len()
                    );
                }
                bytes
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                use rand::RngCore;
                let mut fresh = vec![0u8; KEY_LEN];
                rand::thread_rng().fill_bytes(&mut fresh);
                write_private(path, &fresh)?;
                fresh
            }
            Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
        };
        Ok(Vault::from_key(&key))
    }

    fn from_key(key: &[u8]) -> Self {
        Vault { cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)) }
    }

    #[cfg(test)]
    pub fn for_tests() -> Self {
        use rand::RngCore;
        let mut k = [0u8; KEY_LEN];
        rand::thread_rng().fill_bytes(&mut k);
        Vault::from_key(&k)
    }

    /// Format byte, a fresh nonce, then the ciphertext with its tag. The item's
    /// id is bound in as associated data: a blob moved onto another row in the
    /// database does not open as that row.
    pub fn seal(&self, item_id: &str, plain: &[u8]) -> Result<Vec<u8>> {
        use rand::RngCore;
        let mut nonce = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce);
        let ct = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                aes_gcm::aead::Payload { msg: plain, aad: item_id.as_bytes() },
            )
            .map_err(|_| anyhow::anyhow!("could not seal {item_id}"))?;
        let mut out = Vec::with_capacity(1 + NONCE_LEN + ct.len());
        out.push(FORMAT_V1);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    /// Seal in place, as an older server kept large blobs: `buf` becomes the
    /// ciphertext and the envelope (format, nonce, tag) is returned to keep beside it.
    #[cfg(test)]
    pub fn seal_detached(&self, item_id: &str, buf: &mut [u8]) -> Result<Vec<u8>> {
        use rand::RngCore;
        let mut nonce = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce);
        let tag = self
            .cipher
            .encrypt_in_place_detached(Nonce::from_slice(&nonce), item_id.as_bytes(), buf)
            .map_err(|_| anyhow::anyhow!("could not seal {item_id}"))?;
        let mut envelope = Vec::with_capacity(ENVELOPE_LEN);
        envelope.push(FORMAT_V1);
        envelope.extend_from_slice(&nonce);
        envelope.extend_from_slice(&tag);
        Ok(envelope)
    }

    /// Open in place what an older server sealed whole, with its envelope.
    /// Only the move to chunks still needs it.
    pub fn open_detached(&self, item_id: &str, envelope: &[u8], buf: &mut [u8]) -> Result<()> {
        if envelope.len() != ENVELOPE_LEN {
            bail!("{item_id}: the stored envelope is not one this server made");
        }
        if envelope[0] != FORMAT_V1 {
            bail!("{item_id}: stored with a format this server does not know ({})", envelope[0]);
        }
        let (nonce, tag) = envelope[1..].split_at(NONCE_LEN);
        self.cipher
            .decrypt_in_place_detached(Nonce::from_slice(nonce), item_id.as_bytes(), buf, Tag::from_slice(tag))
            .map_err(|_| anyhow::anyhow!("{item_id}: stored data does not open with this server's key"))
    }

    pub fn open(&self, item_id: &str, sealed: &[u8]) -> Result<Vec<u8>> {
        if sealed.len() < 1 + NONCE_LEN {
            bail!("{item_id}: stored data is too short to be anything we sealed");
        }
        if sealed[0] != FORMAT_V1 {
            bail!("{item_id}: stored with a format this server does not know ({})", sealed[0]);
        }
        let (nonce, ct) = sealed[1..].split_at(NONCE_LEN);
        self.cipher
            .decrypt(
                Nonce::from_slice(nonce),
                aes_gcm::aead::Payload { msg: ct, aad: item_id.as_bytes() },
            )
            .map_err(|_| anyhow::anyhow!("{item_id}: stored data does not open with this server's key"))
    }
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    // Windows has no mode bits; the file inherits the data directory's ACL,
    // which is the account the server runs as.
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_sealed_opens_again() {
        let v = Vault::for_tests();
        let sealed = v.seal("p1", b"cookies and all").unwrap();
        assert_ne!(&sealed[1 + NONCE_LEN..], b"cookies and all");
        assert_eq!(v.open("p1", &sealed).unwrap(), b"cookies and all");
    }

    #[test]
    fn the_same_data_never_seals_the_same_way_twice() {
        let v = Vault::for_tests();
        assert_ne!(v.seal("p1", b"x").unwrap(), v.seal("p1", b"x").unwrap());
    }

    #[test]
    fn another_servers_key_opens_nothing() {
        let ours = Vault::for_tests();
        let theirs = Vault::for_tests();
        let sealed = ours.seal("p1", b"secret").unwrap();
        assert!(theirs.open("p1", &sealed).is_err());
    }

    #[test]
    fn a_blob_moved_onto_another_row_does_not_open_there() {
        let v = Vault::for_tests();
        let sealed = v.seal("p1", b"Vera's shop").unwrap();
        assert!(v.open("p2", &sealed).is_err(), "bound to the id it was sealed for");
    }

    #[test]
    fn tampering_is_caught() {
        let v = Vault::for_tests();
        let mut sealed = v.seal("p1", b"secret").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert!(v.open("p1", &sealed).is_err());
        assert!(v.open("p1", &[FORMAT_V1, 1, 2]).is_err(), "too short is refused, not a panic");
        let mut wrong_format = v.seal("p1", b"secret").unwrap();
        wrong_format[0] = 9;
        assert!(v.open("p1", &wrong_format).is_err());
    }

    #[test]
    fn a_large_blob_is_sealed_in_place_with_its_envelope_apart() {
        let v = Vault::for_tests();
        let plain: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let mut buf = plain.clone();
        let env = v.seal_detached("session:p1", &mut buf).unwrap();
        assert_eq!((env.len(), buf.len()), (ENVELOPE_LEN, plain.len()), "no bytes added to the blob");
        assert_ne!(buf, plain);

        // Bound to the row it was sealed for, and to its own envelope.
        let mut other = buf.clone();
        assert!(v.open_detached("session:p2", &env, &mut other).is_err());
        let mut tampered = buf.clone();
        tampered[7] ^= 1;
        assert!(v.open_detached("session:p1", &env, &mut tampered).is_err());
        assert!(v.open_detached("session:p1", &env[1..], &mut buf.clone()).is_err(), "short envelope");
        assert!(Vault::for_tests().open_detached("session:p1", &env, &mut buf.clone()).is_err());

        v.open_detached("session:p1", &env, &mut buf).unwrap();
        assert_eq!(buf, plain);
        // Nothing at all seals too.
        let env = v.seal_detached("session:p3", &mut []).unwrap();
        v.open_detached("session:p3", &env, &mut []).unwrap();
    }

    #[test]
    fn the_key_file_is_made_once_and_kept() {
        let dir = std::env::temp_dir().join(format!("shardx-vault-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("server.key");

        let first = Vault::open_or_create(&path).unwrap();
        let sealed = first.seal("p1", b"kept across restarts").unwrap();
        let again = Vault::open_or_create(&path).unwrap();
        assert_eq!(again.open("p1", &sealed).unwrap(), b"kept across restarts");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "only the server's own account may read the key");
        }

        // A file that is not a key is refused rather than used.
        std::fs::write(dir.join("bad.key"), b"short").unwrap();
        assert!(Vault::open_or_create(&dir.join("bad.key")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
