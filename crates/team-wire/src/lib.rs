//! The encrypted link between a launcher and its team server, shared by both
//! so they agree to the byte.
//!
//! The address stays plain `http://IP:port`. A launcher asks `GET /wire` to
//! switch to [`UPGRADE`]; once the server says 101, TLS 1.3 runs on that same
//! connection and the app's own http goes inside it, every route, body and
//! live socket alike. The server shows the team's key, the one that signs
//! permissions, as a raw public key (RFC 7250): no certificate, no domain.
//!
//! A launcher that has joined holds that key and takes no other. One that has
//! not yet (joining, connecting sync) learns the key the server shows, then
//! asks it to [`proof`] that it knows the token being used, bound to that key,
//! before the token itself goes out. Someone in between knows neither the
//! token nor what the server keeps of it, so cannot pass for the server.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{digest, hmac};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls13_signature_with_raw_key, CryptoProvider, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, SubjectPublicKeyInfoDer, UnixTime};
use rustls::server::AlwaysResolvesServerRawPublicKeys;
use rustls::sign::CertifiedKey;
use rustls::{CertificateError, DigitallySignedStruct, Error, SignatureScheme};
use serde::{Deserialize, Serialize};

/// Where a launcher asks to switch; with [`HEALTH`] the only path served in the clear.
pub const PATH: &str = "/wire";
/// What the `Upgrade` header names, both ways.
pub const UPGRADE: &str = "shardx-tls/1";
/// The one path served in the clear for a person or a monitor: it says only that the server is up.
pub const HEALTH: &str = "/health";
/// Inside the TLS: where a launcher that has no key yet asks the server to prove itself.
pub const VOUCH: &str = "/wire/vouch";
/// The code a refusal carries when a launcher talks to this server in the clear.
pub const PLAIN_REFUSED: &str = "upgrade_required";
/// The code a vouch for a token the server never issued answers with.
pub const UNKNOWN_TOKEN: &str = "unknown_token";

/// An Ed25519 public key, raw.
pub type Key = [u8; 32];

/// DER of an Ed25519 SubjectPublicKeyInfo up to the key's own 32 bytes.
const ED25519_SPKI: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

/// The key as TLS shows it: an Ed25519 SubjectPublicKeyInfo.
pub fn spki(key: &Key) -> Vec<u8> {
    let mut out = ED25519_SPKI.to_vec();
    out.extend_from_slice(key);
    out
}

fn key_of(spki: &[u8]) -> Option<Key> {
    spki.strip_prefix(&ED25519_SPKI)?.try_into().ok()
}

/// The key as a launcher keeps it (`perm_key`): base64url of the 32 bytes.
pub fn key_text(key: &Key) -> String {
    URL_SAFE_NO_PAD.encode(key)
}

pub fn key_from_text(text: &str) -> Option<Key> {
    URL_SAFE_NO_PAD.decode(text.trim()).ok()?.try_into().ok()
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// The server's side: TLS 1.3 only, the team's Ed25519 key (PKCS#8) shown raw.
/// Also the key's public half, as launchers check it.
pub fn server_config(pkcs8: &[u8]) -> Result<(Arc<rustls::ServerConfig>, Key), Error> {
    let p = provider();
    let signer = p.key_provider.load_private_key(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(pkcs8.to_vec())))?;
    let shown = signer.public_key().ok_or_else(|| Error::General("the key has no public half".into()))?;
    let key = key_of(shown.as_ref()).ok_or_else(|| Error::General("not an Ed25519 key".into()))?;
    let certified = Arc::new(CertifiedKey::new(vec![CertificateDer::from(spki(&key))], signer));
    let cfg = rustls::ServerConfig::builder_with_provider(p)
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(AlwaysResolvesServerRawPublicKeys::new(certified)));
    Ok((Arc::new(cfg), key))
}

/// The key a launcher holds a server to. One that learns takes the first key
/// a server shows and holds every later connection to it.
#[derive(Debug)]
pub struct Pin {
    key: Mutex<Option<Key>>,
    other: AtomicBool,
}

impl Pin {
    pub fn to(key: Key) -> Arc<Pin> {
        Arc::new(Pin { key: Mutex::new(Some(key)), other: AtomicBool::new(false) })
    }

    pub fn learn() -> Arc<Pin> {
        Arc::new(Pin { key: Mutex::new(None), other: AtomicBool::new(false) })
    }

    /// The key held, once there is one.
    pub fn key(&self) -> Option<Key> {
        *self.key.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A server showed a key other than the one held, and was refused.
    pub fn saw_another(&self) -> bool {
        self.other.load(Ordering::SeqCst)
    }
}

/// The launcher's side: TLS 1.3 only, and the server must show the key `pin` holds.
pub fn client_config(pin: Arc<Pin>) -> Arc<rustls::ClientConfig> {
    let p = provider();
    let algs = p.signature_verification_algorithms;
    let mut cfg = rustls::ClientConfig::builder_with_provider(p)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .expect("ring speaks TLS 1.3")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Held { pin, algs }))
        .with_no_client_auth();
    // The address is an IP more often than not, and no name is checked anyway.
    cfg.enable_sni = false;
    Arc::new(cfg)
}

#[derive(Debug)]
struct Held {
    pin: Arc<Pin>,
    algs: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for Held {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        let shown = key_of(end_entity.as_ref())
            .filter(|_| intermediates.is_empty())
            .ok_or(Error::InvalidCertificate(CertificateError::BadEncoding))?;
        let mut held = self.pin.key.lock().unwrap_or_else(|e| e.into_inner());
        match *held {
            Some(k) if k == shown => {}
            Some(_) => {
                self.pin.other.store(true, Ordering::SeqCst);
                return Err(Error::InvalidCertificate(CertificateError::ApplicationVerificationFailure));
            }
            None => *held = Some(shown),
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General("TLS 1.2 is not spoken here".into()))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        if dss.scheme != SignatureScheme::ED25519 {
            return Err(Error::General("the server signed with another scheme than Ed25519".into()));
        }
        verify_tls13_signature_with_raw_key(message, &SubjectPublicKeyInfoDer::from(cert.as_ref()), dss, &self.algs)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![SignatureScheme::ED25519]
    }

    fn requires_raw_public_keys(&self) -> bool {
        true
    }
}

// ---- a server proving it knows the token ----

/// What the server keeps in place of a token: sha-256, in hex.
pub fn token_hash(token: &str) -> String {
    hex(digest::digest(&digest::SHA256, token.as_bytes()).as_ref())
}

/// A member token's name before the server is trusted: it tells nothing of the token.
pub fn key_id(token_hash: &str) -> String {
    let mut ctx = digest::Context::new(&digest::SHA256);
    ctx.update(b"shardx-wire/1 key id\0");
    ctx.update(token_hash.as_bytes());
    hex(ctx.finish().as_ref())
}

fn proof_key(token_hash: &str) -> hmac::Key {
    let mut ctx = digest::Context::new(&digest::SHA256);
    ctx.update(b"shardx-wire/1 proof key\0");
    ctx.update(token_hash.as_bytes());
    hmac::Key::new(hmac::HMAC_SHA256, ctx.finish().as_ref())
}

fn proof_message(challenge: &[u8], server_key: &Key) -> Vec<u8> {
    let mut m = b"shardx-wire/1 vouch\0".to_vec();
    m.extend_from_slice(challenge);
    m.extend_from_slice(server_key);
    m
}

/// That whoever holds `token_hash` vouches for `server_key`, answering `challenge`.
pub fn proof(token_hash: &str, challenge: &[u8], server_key: &Key) -> Vec<u8> {
    hmac::sign(&proof_key(token_hash), &proof_message(challenge, server_key)).as_ref().to_vec()
}

/// Whether `got` is that proof, compared in constant time.
pub fn proof_holds(token_hash: &str, challenge: &[u8], server_key: &Key, got: &[u8]) -> bool {
    hmac::verify(&proof_key(token_hash), &proof_message(challenge, server_key), got).is_ok()
}

/// 32 fresh random bytes for a challenge.
pub fn challenge() -> [u8; 32] {
    use ring::rand::SecureRandom;
    let mut c = [0u8; 32];
    ring::rand::SystemRandom::new().fill(&mut c).expect("the system's random source");
    c
}

/// A launcher's ask at [`VOUCH`]: which token, without the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vouch {
    /// A member token's [`key_id`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member: Option<String>,
    /// The admin token's signed part; the server signs it again to know the token.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admin: Option<String>,
    /// base64url of 32 random bytes.
    pub challenge: String,
}

impl Vouch {
    pub fn new(token: &str, challenge: &[u8]) -> Vouch {
        let challenge = URL_SAFE_NO_PAD.encode(challenge);
        match admin_signed_part(token) {
            Some(signed) => Vouch { member: None, admin: Some(signed.to_owned()), challenge },
            None => Vouch { member: Some(key_id(&token_hash(token))), admin: None, challenge },
        }
    }

    pub fn challenge_bytes(&self) -> Option<Vec<u8>> {
        URL_SAFE_NO_PAD.decode(&self.challenge).ok().filter(|c| c.len() == 32)
    }
}

/// The admin token is a JWT: header and claims are not secret, the signature is.
fn admin_signed_part(token: &str) -> Option<&str> {
    let (signed, _) = token.rsplit_once('.')?;
    (signed.matches('.').count() == 1).then_some(signed)
}

/// The server's answer at [`VOUCH`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vouched {
    /// base64url of [`proof`].
    pub proof: String,
}

impl Vouched {
    pub fn new(token_hash: &str, challenge: &[u8], server_key: &Key) -> Vouched {
        Vouched { proof: URL_SAFE_NO_PAD.encode(proof(token_hash, challenge, server_key)) }
    }

    /// Whether this answers `challenge` for `token`, from the server showing `server_key`.
    pub fn holds(&self, token: &str, challenge: &[u8], server_key: &Key) -> bool {
        let Ok(got) = URL_SAFE_NO_PAD.decode(&self.proof) else { return false };
        proof_holds(&token_hash(token), challenge, server_key, &got)
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn team_key() -> (Vec<u8>, Key) {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        (pkcs8.as_ref().to_vec(), pair.public_key().as_ref().try_into().unwrap())
    }

    /// A handshake over memory; the client's error, if it failed.
    fn handshake(client: Arc<rustls::ClientConfig>, server: Arc<rustls::ServerConfig>) -> Result<(), Error> {
        let name = ServerName::try_from("203.0.113.7").unwrap();
        let mut c = rustls::ClientConnection::new(client, name).unwrap();
        let mut s = rustls::ServerConnection::new(server).unwrap();
        for _ in 0..10 {
            let mut buf = Vec::new();
            while c.wants_write() {
                c.write_tls(&mut buf).unwrap();
            }
            let mut rd = &buf[..];
            while !rd.is_empty() {
                s.read_tls(&mut rd).unwrap();
            }
            let _ = s.process_new_packets();
            let mut buf = Vec::new();
            while s.wants_write() {
                s.write_tls(&mut buf).unwrap();
            }
            let mut rd = &buf[..];
            while !rd.is_empty() {
                c.read_tls(&mut rd).unwrap();
            }
            c.process_new_packets()?;
            if !c.is_handshaking() && !s.is_handshaking() {
                return Ok(());
            }
        }
        Err(Error::General("the handshake did not finish".into()))
    }

    #[test]
    fn a_key_round_trips_through_its_spki_and_its_text() {
        let (_, key) = team_key();
        let der = spki(&key);
        assert_eq!(der.len(), 44);
        assert_eq!(key_of(&der), Some(key));
        assert_eq!(key_of(&der[..43]), None);
        assert_eq!(key_from_text(&key_text(&key)), Some(key));
        assert_eq!(key_from_text("not base64!"), None);
        assert_eq!(key_from_text(&URL_SAFE_NO_PAD.encode([1u8; 16])), None);
    }

    #[test]
    fn a_launcher_takes_the_key_it_holds_and_no_other() {
        let (pkcs8, key) = team_key();
        let (server, shown) = server_config(&pkcs8).unwrap();
        assert_eq!(shown, key);
        assert!(handshake(client_config(Pin::to(key)), server.clone()).is_ok());

        let (other, _) = team_key();
        let (impostor, _) = server_config(&other).unwrap();
        let pin = Pin::to(key);
        assert!(handshake(client_config(pin.clone()), impostor).is_err());
        assert!(pin.saw_another());
    }

    #[test]
    fn a_launcher_that_learns_holds_every_later_connection_to_the_first_key() {
        let (pkcs8, key) = team_key();
        let (server, _) = server_config(&pkcs8).unwrap();
        let pin = Pin::learn();
        let cfg = client_config(pin.clone());
        assert!(handshake(cfg.clone(), server.clone()).is_ok());
        assert_eq!(pin.key(), Some(key));
        let (other, _) = team_key();
        assert!(handshake(cfg.clone(), server_config(&other).unwrap().0).is_err());
        assert!(pin.saw_another());
        assert!(handshake(cfg, server).is_ok());
    }

    #[test]
    fn a_server_proves_only_a_token_it_holds_and_only_for_its_own_key() {
        let (_, key) = team_key();
        let (_, other_key) = team_key();
        let token = "stm_abc";
        let c = challenge();
        let ok = Vouched::new(&token_hash(token), &c, &key);
        assert!(ok.holds(token, &c, &key));
        assert!(!ok.holds(token, &c, &other_key), "a proof for one key is not one for another");
        assert!(!ok.holds("stm_abd", &c, &key));
        assert!(!ok.holds(token, &challenge(), &key), "an old answer does not answer a new challenge");
        assert!(!Vouched { proof: "!!".into() }.holds(token, &c, &key));
    }

    #[test]
    fn a_vouch_names_a_member_token_by_its_id_and_the_admin_by_its_signed_part() {
        let c = [7u8; 32];
        let m = Vouch::new("stm_abc", &c);
        assert_eq!(m.member.as_deref(), Some(key_id(&token_hash("stm_abc")).as_str()));
        assert!(m.admin.is_none());
        assert!(!serde_json::to_string(&m).unwrap().contains("abc"));
        assert_eq!(m.challenge_bytes().as_deref(), Some(&c[..]));

        let a = Vouch::new("eyJh.eyJz.c2ln", &c);
        assert_eq!((a.member, a.admin.as_deref()), (None, Some("eyJh.eyJz")));
        assert!(Vouch { challenge: "short".into(), ..Vouch::new("stm_x", &c) }.challenge_bytes().is_none());
    }

    #[test]
    fn the_hash_is_the_one_the_server_keeps() {
        assert_eq!(token_hash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
