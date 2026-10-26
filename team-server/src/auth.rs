//! Who is asking, and what they are allowed to carry away as proof.
//!
//! Three credentials, each with one job:
//!
//! * The **admin JWT** says "I run this team". Signed with a secret that lives
//!   only in the server's own database, so the admin and the server share it
//!   and nobody else can mint one.
//! * A **member token** is the long-lived thing a person puts into their
//!   launcher. It is shown once and stored only as a hash.
//! * A **permission** is what the launcher actually enforces: a short-lived
//!   document, signed by the server, listing what this member may do right
//!   now. It is signed with a key pair rather than a shared secret, so a
//!   launcher can check it without being able to write one.

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use ed25519_dalek::SigningKey;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::Grant;

/// How long a permission is good for. Short, because this is also how long a
/// member keeps working after the server becomes unreachable — the answer the
/// owner chose: finish the stretch you were given, then stop.
pub const PERMISSION_TTL_SECS: u64 = 15 * 60;

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---- member tokens ----

/// A fresh member token. Shown to the admin once, then never again — what the
/// server keeps is [`token_hash`] of it.
pub fn new_member_token() -> String {
    use rand::RngCore;
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    format!("stm_{}", URL_SAFE_NO_PAD.encode(raw))
}

/// What goes in the database in place of the token.
pub fn token_hash(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    format!("{:x}", h.finalize())
}

// ---- the admin ----

#[derive(Serialize, Deserialize)]
struct AdminClaims {
    sub: String,
    iat: u64,
    exp: u64,
}

/// A secret for signing admin tokens, made once and kept in the database.
pub fn new_admin_secret() -> String {
    use rand::RngCore;
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}

pub fn mint_admin(secret: &str, ttl_secs: u64) -> Result<String> {
    let now = unix_now();
    let claims = AdminClaims {
        sub: "admin".into(),
        iat: now,
        exp: now.saturating_add(ttl_secs),
    };
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .context("sign the admin token")
}

/// The admin token this server would have signed for this signed part, while still good.
pub fn admin_token_of(secret: &str, signed: &str) -> Option<String> {
    let sig = jsonwebtoken::crypto::sign(signed.as_bytes(), &EncodingKey::from_secret(secret.as_bytes()), Algorithm::HS256).ok()?;
    let token = format!("{signed}.{sig}");
    is_admin(secret, &token).then_some(token)
}

pub fn is_admin(secret: &str, token: &str) -> bool {
    let mut v = Validation::new(Algorithm::HS256);
    v.set_required_spec_claims(&["exp"]);
    jsonwebtoken::decode::<AdminClaims>(token, &DecodingKey::from_secret(secret.as_bytes()), &v)
        .map(|d| d.claims.sub == "admin")
        .unwrap_or(false)
}

// ---- permissions ----

/// The document a launcher enforces. It carries the grants themselves, so a
/// launcher that has one can answer every question offline until it expires —
/// and `epoch` tells it, and us, which edition of the member's rights it is.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Permission {
    /// Member id.
    pub sub: String,
    pub team: String,
    pub epoch: u64,
    pub iat: u64,
    pub exp: u64,
    pub grants: Vec<Grant>,
}

/// The server's signing key for permissions. Private half stays here; the
/// public half is handed to every launcher when it binds, and is all they need
/// to check a permission.
pub struct PermissionKey {
    signing: SigningKey,
}

impl PermissionKey {
    pub fn generate() -> Self {
        let mut csprng = rand::rngs::OsRng;
        PermissionKey { signing: SigningKey::generate(&mut csprng) }
    }

    /// PKCS#8 PEM, which is what we keep in the database and what
    /// `jsonwebtoken` wants for EdDSA.
    pub fn to_pem(&self) -> Result<String> {
        Ok(self
            .signing
            .to_pkcs8_pem(ed25519_dalek::pkcs8::spki::der::pem::LineEnding::LF)
            .context("encode the signing key")?
            .to_string())
    }

    pub fn from_pem(pem: &str) -> Result<Self> {
        let signing = SigningKey::from_pkcs8_pem(pem).context("read the signing key")?;
        Ok(PermissionKey { signing })
    }

    /// PKCS#8 DER: the same key is what the server shows launchers on the wire.
    pub fn to_pkcs8_der(&self) -> Result<Vec<u8>> {
        Ok(self.signing.to_pkcs8_der().context("encode the signing key")?.as_bytes().to_vec())
    }

    pub fn public_raw(&self) -> [u8; 32] {
        self.signing.verifying_key().to_bytes()
    }

    /// What a launcher is given at bind time. Base64 of the raw 32 bytes:
    /// short enough to sit in a settings file, and unambiguous.
    pub fn public_b64(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.signing.verifying_key().to_bytes())
    }

    pub fn sign(&self, p: &Permission) -> Result<String> {
        let pem = self.to_pem()?;
        let key = EncodingKey::from_ed_pem(pem.as_bytes()).context("load the signing key")?;
        jsonwebtoken::encode(&Header::new(Algorithm::EdDSA), p, &key).context("sign the permission")
    }
}

/// Check a permission with nothing but the public key. The launcher does
/// exactly this, which is why it cannot forge one. Nothing in the server calls
/// it: it is kept here, under test, as the reference the launcher's own check
/// has to agree with.
#[cfg_attr(not(test), allow(dead_code))]
pub fn verify_permission(public_b64: &str, token: &str) -> Result<Permission> {
    let raw = URL_SAFE_NO_PAD
        .decode(public_b64.as_bytes())
        .context("the public key is not base64")?;
    if raw.len() != 32 {
        bail!("a public key is 32 bytes, this one is {}", raw.len());
    }
    let key = DecodingKey::from_ed_der(&raw);
    let mut v = Validation::new(Algorithm::EdDSA);
    v.set_required_spec_claims(&["exp"]);
    // Nothing here is addressed to an audience or an issuer; the signature and
    // the expiry are the whole check.
    v.validate_aud = false;
    let data = jsonwebtoken::decode::<Permission>(token, &key, &v)
        .context("the permission did not check out")?;
    Ok(data.claims)
}

/// Build the document for a member as they stand right now.
pub fn permission_for(
    member_id: &str,
    team: &str,
    epoch: u64,
    grants: Vec<Grant>,
    ttl_secs: u64,
) -> Permission {
    let now = unix_now();
    Permission {
        sub: member_id.into(),
        team: team.into(),
        epoch,
        iat: now,
        exp: now.saturating_add(ttl_secs),
        grants,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Action, Scope};

    fn some_grants() -> Vec<Grant> {
        vec![
            Grant { scope: Scope::Team, action: Action::See, allow: true },
            Grant {
                scope: Scope::Folder { name: "Ads".into() },
                action: Action::Start,
                allow: true,
            },
            Grant {
                scope: Scope::Profile { id: "p9".into() },
                action: Action::Start,
                allow: false,
            },
        ]
    }

    #[test]
    fn a_token_is_shown_once_and_stored_as_a_hash() {
        let t1 = new_member_token();
        let t2 = new_member_token();
        assert_ne!(t1, t2, "two tokens are never the same");
        assert!(t1.starts_with("stm_"));
        let h = token_hash(&t1);
        assert_eq!(h.len(), 64, "sha-256 in hex");
        assert_ne!(h, t1);
        assert_eq!(h, token_hash(&t1), "the same token always hashes the same");
        assert_ne!(h, token_hash(&t2));
    }

    #[test]
    fn only_our_own_secret_makes_an_admin() {
        let secret = new_admin_secret();
        let other = new_admin_secret();
        let token = mint_admin(&secret, 3600).unwrap();
        assert!(is_admin(&secret, &token));
        assert!(!is_admin(&other, &token), "another server's admin is not ours");
        assert!(!is_admin(&secret, "not-a-token"));
        assert!(!is_admin(&secret, ""));
    }

    #[test]
    fn the_wire_names_tokens_as_this_server_keeps_them() {
        let t = new_member_token();
        assert_eq!(token_hash(&t), team_wire::token_hash(&t));
        // The admin token is known again from its signed part; signed by another
        // server it comes out as another token, whose holder nobody is.
        let secret = new_admin_secret();
        let admin = mint_admin(&secret, 3600).unwrap();
        let (signed, _) = admin.rsplit_once('.').unwrap();
        assert_eq!(admin_token_of(&secret, signed).as_deref(), Some(admin.as_str()));
        assert_ne!(admin_token_of(&new_admin_secret(), signed).as_deref(), Some(admin.as_str()));
        assert_eq!(admin_token_of(&secret, "eyJhbGciOiJIUzI1NiJ9.e30"), None, "no expiry: not an admin token");
        let key = PermissionKey::generate();
        let (_, shown) = team_wire::server_config(&key.to_pkcs8_der().unwrap()).unwrap();
        assert_eq!(shown, key.public_raw());
        assert_eq!(team_wire::key_text(&shown), key.public_b64(), "the key launchers already keep");
    }

    #[test]
    fn an_expired_admin_token_is_refused() {
        let secret = new_admin_secret();
        // Expired well past the library's default leeway, so this is about the
        // expiry and not about clock slack.
        let now = unix_now();
        let claims = AdminClaims { sub: "admin".into(), iat: now - 7200, exp: now - 3600 };
        let token = jsonwebtoken::encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap();
        assert!(!is_admin(&secret, &token), "an expired admin token is not an admin");
    }

    #[test]
    fn a_permission_round_trips_through_the_public_key() {
        let key = PermissionKey::generate();
        let p = permission_for("m1", "team-1", 7, some_grants(), PERMISSION_TTL_SECS);
        let token = key.sign(&p).unwrap();
        let back = verify_permission(&key.public_b64(), &token).unwrap();
        assert_eq!(back, p, "what the launcher reads is what we signed");
        assert_eq!(back.epoch, 7);
        assert_eq!(back.grants.len(), 3);
        assert!(!back.grants[2].allow, "a refusal survives the trip");
    }

    #[test]
    fn another_servers_key_cannot_sign_for_this_one() {
        let ours = PermissionKey::generate();
        let theirs = PermissionKey::generate();
        let token = theirs.sign(&permission_for("m1", "t", 1, some_grants(), 600)).unwrap();
        assert!(
            verify_permission(&ours.public_b64(), &token).is_err(),
            "a permission signed elsewhere is not ours"
        );
    }

    #[test]
    fn a_tampered_permission_is_refused() {
        let key = PermissionKey::generate();
        let token = key.sign(&permission_for("m1", "t", 1, some_grants(), 600)).unwrap();
        // Flip one character of the payload: the signature stops matching.
        let mut parts: Vec<&str> = token.split('.').collect();
        let payload = parts[1].to_string();
        let mut bytes = payload.into_bytes();
        bytes[0] = if bytes[0] == b'A' { b'B' } else { b'A' };
        let swapped = String::from_utf8(bytes).unwrap();
        parts[1] = &swapped;
        let bad = parts.join(".");
        assert!(verify_permission(&key.public_b64(), &bad).is_err());
    }

    #[test]
    fn an_expired_permission_is_refused() {
        let key = PermissionKey::generate();
        // Issued already expired, and past the library's default leeway.
        let mut p = permission_for("m1", "t", 1, some_grants(), 0);
        p.exp = unix_now().saturating_sub(120);
        let token = key.sign(&p).unwrap();
        assert!(verify_permission(&key.public_b64(), &token).is_err());
    }

    #[test]
    fn the_signing_key_survives_a_restart() {
        let key = PermissionKey::generate();
        let pem = key.to_pem().unwrap();
        let pub_before = key.public_b64();
        let reopened = PermissionKey::from_pem(&pem).unwrap();
        assert_eq!(reopened.public_b64(), pub_before, "the same key, so old permissions still check out");
        let token = reopened.sign(&permission_for("m1", "t", 1, some_grants(), 600)).unwrap();
        assert!(verify_permission(&pub_before, &token).is_ok());
    }

    #[test]
    fn a_public_key_that_is_not_one_is_refused_rather_than_panicking() {
        let key = PermissionKey::generate();
        let token = key.sign(&permission_for("m1", "t", 1, vec![], 600)).unwrap();
        assert!(verify_permission("not base64 at all!!", &token).is_err());
        assert!(verify_permission(&URL_SAFE_NO_PAD.encode([0u8; 8]), &token).is_err());
    }
}
