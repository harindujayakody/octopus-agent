//! CRX3 packages checked as Chrome's `crx_verifier.cc` checks them: every
//! proof must verify, one must be the developer's key for the signed id, and
//! a Web Store package must also carry the store's publisher proof.

use super::chrome_id::{from_hash, id_from_key};
use base64::Engine;
use ring::signature::{self, UnparsedPublicKey, VerificationAlgorithm};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::Read;
use std::path::Path;

/// SHA-256 of the store's "ecdsa_2017_public" key (`kPublisherKeyHash`).
pub const PUBLISHER_KEY_HASH: [u8; 32] = [
    0x61, 0xf7, 0xf2, 0xa6, 0xbf, 0xcf, 0x74, 0xcd, 0x0b, 0xc1, 0xfe, 0x24, 0x97, 0xcc, 0x9b, 0x04, 0x25, 0x4c, 0x65, 0x8f,
    0x79, 0xf2, 0x14, 0x53, 0x92, 0x86, 0x7e, 0xa8, 0x36, 0x63, 0x67, 0xcf,
];
/// The store's publisher hash; a test on this thread may stand its own key in.
pub fn publisher() -> [u8; 32] {
    #[cfg(test)]
    if let Some(h) = TEST_PUBLISHER.with(|c| c.get()) {
        return h;
    }
    PUBLISHER_KEY_HASH
}

#[cfg(test)]
thread_local! {
    pub static TEST_PUBLISHER: std::cell::Cell<Option<[u8; 32]>> = const { std::cell::Cell::new(None) };
}

/// A header bigger than this is not a real one.
const MAX_HEADER: usize = 1 << 20;
const SIGNATURE_CONTEXT: &[u8] = b"CRX3 SignedData\x00";
/// Zip end-of-directory tokens: in a header they could make unzip see another archive.
const ZIP_TOKENS: [&[u8]; 3] = [b"PK\x05\x06", b"PK\x06\x07", b"PK\x06\x06"];
const VERIFIED_CONTENTS_MAX: u64 = 32 << 20;

/// Why a package was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reject {
    NotCrx3,
    HeaderSize,
    ZipTokenInHeader,
    BadHeader,
    BadKey,
    BadSignature,
    NoDeveloperProof,
    NoPublisherProof,
    WrongId { want: String, got: String },
    WrongHash,
    WrongSize { want: u64, got: u64 },
}

impl fmt::Display for Reject {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Reject::NotCrx3 => f.write_str("not a CRX3 package"),
            Reject::HeaderSize => f.write_str("the CRX header's size is wrong"),
            Reject::ZipTokenInHeader => f.write_str("the CRX header holds a zip marker"),
            Reject::BadHeader => f.write_str("the CRX header cannot be read"),
            Reject::BadKey => f.write_str("a key in the CRX cannot be read"),
            Reject::BadSignature => f.write_str("the CRX signature does not match its contents"),
            Reject::NoDeveloperProof => f.write_str("the CRX is not signed by its developer's key"),
            Reject::NoPublisherProof => f.write_str("the CRX is not signed by the Web Store"),
            Reject::WrongId { want, got } => write!(f, "the package is extension {got}, not {want}"),
            Reject::WrongHash => f.write_str("the download does not match the Web Store's hash"),
            Reject::WrongSize { want, got } => write!(f, "the download is {got} bytes, the Web Store said {want}"),
        }
    }
}

impl std::error::Error for Reject {}

/// What the package must be, beyond a valid CRX3.
#[derive(Debug, Clone, Default)]
pub struct Expect<'a> {
    /// The id it must be signed for.
    pub id: Option<&'a str>,
    /// SHA-256 of a key that must have signed it too.
    pub publisher: Option<[u8; 32]>,
    /// Hex SHA-256 and size of the whole file, as update2 gave them.
    pub sha256: Option<&'a str>,
    pub size: Option<u64>,
}

impl<'a> Expect<'a> {
    /// A Web Store package for `id`: the store's own proof is required.
    pub fn store(id: &'a str, sha256: Option<&'a str>, size: Option<u64>) -> Expect<'a> {
        Expect { id: Some(id), publisher: Some(publisher()), sha256, size }
    }
}

#[derive(Debug, Clone)]
pub struct Verified {
    /// The id the package is signed for, a..p.
    pub crx_id: String,
    /// The developer's public key (SPKI DER): what goes into manifest.json's `key`.
    pub developer_key: Vec<u8>,
    /// SHA-256 of every key whose proof verified.
    pub proof_keys: Vec<[u8; 32]>,
    /// The store's `verified_contents.json`, unzipped, when the header carries it.
    pub verified_contents: Option<Vec<u8>>,
    /// Where the zip starts.
    pub archive_offset: usize,
    /// Hex SHA-256 of the whole file.
    pub sha256: String,
}

impl Verified {
    /// Signed by the Web Store, so it came from there.
    pub fn store_signed(&self) -> bool {
        self.proof_keys.contains(&publisher())
    }

    /// The manifest `key` Chrome writes when it installs this package.
    pub fn key_b64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(&self.developer_key)
    }
}

/// The item a store `verified_contents.json` names.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StoreItem {
    pub id: String,
    pub version: String,
}

pub fn verify_file(path: &Path, expect: &Expect) -> anyhow::Result<Verified> {
    let bytes = std::fs::read(path).map_err(|e| anyhow::anyhow!("read {}: {e}", path.display()))?;
    Ok(verify(&bytes, expect)?)
}

pub fn verify(bytes: &[u8], expect: &Expect) -> Result<Verified, Reject> {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    let sha256: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(want) = expect.size {
        if want != bytes.len() as u64 {
            return Err(Reject::WrongSize { want, got: bytes.len() as u64 });
        }
    }
    if let Some(want) = expect.sha256 {
        if !want.eq_ignore_ascii_case(&sha256) {
            return Err(Reject::WrongHash);
        }
    }
    if bytes.len() < 12 || &bytes[..4] != b"Cr24" || bytes[4..8] != 3u32.to_le_bytes() {
        return Err(Reject::NotCrx3);
    }
    let header_size = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if header_size > MAX_HEADER || bytes.len() - 12 < header_size {
        return Err(Reject::HeaderSize);
    }
    let header = &bytes[12..12 + header_size];
    let archive_offset = 12 + header_size;
    if ZIP_TOKENS.iter().any(|t| header.windows(4).any(|w| w == *t)) {
        return Err(Reject::ZipTokenInHeader);
    }

    // CrxFileHeader: proofs 2 (RSA) and 3 (ECDSA), verified_contents 4, signed_header_data 10000.
    let (mut proofs, mut compressed_vc, mut signed) = (Vec::new(), None, &[][..]);
    for (field, data) in fields(header).ok_or(Reject::BadHeader)? {
        match field {
            2 | 3 => {
                let (mut key, mut sig) = (&[][..], &[][..]);
                for (f, d) in fields(data).ok_or(Reject::BadHeader)? {
                    match f {
                        1 => key = d,
                        2 => sig = d,
                        _ => {}
                    }
                }
                proofs.push((field == 2, key, sig));
            }
            4 => compressed_vc = Some(data),
            10000 => signed = data,
            _ => {}
        }
    }
    let mut crx_id = None;
    for (f, d) in fields(signed).ok_or(Reject::BadHeader)? {
        if f == 1 {
            crx_id = Some(d);
        }
    }
    // Chrome compares 32 letters; any other length matches no key.
    let declared = crx_id.filter(|id| id.len() == 16).map(from_hash);

    let mut developer_key = None;
    let mut checks = Vec::new();
    for (rsa, key, sig) in proofs {
        if declared.as_deref() == Some(id_from_key(key).as_str()) {
            developer_key = Some(key);
        }
        let (alg, raw) = spki(key, rsa).ok_or(Reject::BadKey)?;
        checks.push((alg, raw, sig, <[u8; 32]>::from(Sha256::digest(key))));
    }
    let (Some(crx_id), Some(developer_key)) = (declared, developer_key) else {
        return Err(Reject::NoDeveloperProof);
    };
    if let Some(p) = expect.publisher {
        if !checks.iter().any(|c| c.3 == p) {
            return Err(Reject::NoPublisherProof);
        }
    }

    // Every proof covers context, le32(len), signed_header_data and the archive.
    let archive = &bytes[archive_offset..];
    let mut msg = Vec::with_capacity(SIGNATURE_CONTEXT.len() + 4 + signed.len() + archive.len());
    msg.extend_from_slice(SIGNATURE_CONTEXT);
    msg.extend_from_slice(&(signed.len() as u32).to_le_bytes());
    msg.extend_from_slice(signed);
    msg.extend_from_slice(archive);
    for (alg, raw, sig, _) in &checks {
        UnparsedPublicKey::new(*alg, raw).verify(&msg, sig).map_err(|_| Reject::BadSignature)?;
    }

    if let Some(want) = expect.id {
        if want != crx_id {
            return Err(Reject::WrongId { want: want.to_string(), got: crx_id });
        }
    }
    let verified_contents = compressed_vc.and_then(|gz| {
        let mut out = Vec::new();
        let mut d = flate2::read::GzDecoder::new(gz).take(VERIFIED_CONTENTS_MAX + 1);
        d.read_to_end(&mut out).ok()?;
        (out.len() as u64 <= VERIFIED_CONTENTS_MAX).then_some(out)
    });
    Ok(Verified {
        crx_id,
        developer_key: developer_key.to_vec(),
        proof_keys: checks.iter().map(|c| c.3).collect(),
        verified_contents,
        archive_offset,
        sha256,
    })
}

/// `item_id` and `item_version` from a store `verified_contents.json`; the
/// store's signature over it is not checked.
pub fn verified_item(json: &[u8]) -> Option<StoreItem> {
    let top: serde_json::Value = serde_json::from_slice(json).ok()?;
    let entry = top.as_array()?.iter().find(|e| e.get("description").and_then(|d| d.as_str()) == Some("treehash per file"))?;
    let payload = entry.get("signed_content")?.get("payload")?.as_str()?;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let p: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let id = p.get("item_id")?.as_str()?;
    let version = p.get("item_version")?.as_str()?;
    super::chrome_id::is_id(id).then(|| StoreItem { id: id.to_string(), version: version.to_string() })
}

/// The length-delimited fields of a protobuf message, in order; others are
/// skipped as Chrome's parser skips unknown fields. None if malformed.
fn fields(mut b: &[u8]) -> Option<Vec<(u64, &[u8])>> {
    fn varint(b: &mut &[u8]) -> Option<u64> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = b.split_first()?;
            *b = rest;
            v |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(v);
            }
        }
        None
    }
    let mut out = Vec::new();
    while !b.is_empty() {
        let tag = varint(&mut b)?;
        if tag >> 3 == 0 {
            return None;
        }
        let skip = match tag & 7 {
            0 => {
                varint(&mut b)?;
                0
            }
            1 => 8,
            2 => {
                let len = usize::try_from(varint(&mut b)?).ok()?;
                out.push((tag >> 3, b.get(..len)?));
                len
            }
            5 => 4,
            _ => return None,
        };
        b = b.get(skip..)?;
    }
    Some(out)
}

/// One DER element: tag, contents, what follows. Strict lengths, as BoringSSL reads them.
fn der(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, b) = b.split_first()?;
    let (&first, mut b) = b.split_first()?;
    let len = if first < 0x80 {
        usize::from(first)
    } else {
        let n = usize::from(first & 0x7f);
        if n == 0 || n > 4 || *b.first()? == 0 {
            return None;
        }
        let mut len = 0usize;
        for &x in b.get(..n)? {
            len = len << 8 | usize::from(x);
        }
        b = &b[n..];
        if len < 0x80 {
            return None;
        }
        len
    };
    Some((tag, b.get(..len)?, &b[len..]))
}

const OID_RSA: &[u8] = &[0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const OID_EC: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const OID_P256: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
const OID_P384: &[u8] = &[0x2b, 0x81, 0x04, 0x00, 0x22];

/// A SubjectPublicKeyInfo as what ring verifies with: the algorithm for its
/// kind of key and the key's raw form. None if unreadable or of the other kind.
fn spki(key: &[u8], rsa: bool) -> Option<(&'static dyn VerificationAlgorithm, &[u8])> {
    let (0x30, body, []) = der(key)? else { return None };
    let (0x30, alg, rest) = der(body)? else { return None };
    let (0x03, bits, []) = der(rest)? else { return None };
    let (0x06, oid, params) = der(alg)? else { return None };
    let ([0], raw) = bits.split_at_checked(1)? else { return None };
    match (rsa, oid) {
        (true, OID_RSA) if params == [0x05, 0x00] => Some((&signature::RSA_PKCS1_1024_8192_SHA256_FOR_LEGACY_USE_ONLY, raw)),
        (false, OID_EC) => match der(params)? {
            (0x06, OID_P256, []) => Some((&signature::ECDSA_P256_SHA256_ASN1, raw)),
            (0x06, OID_P384, []) => Some((&signature::ECDSA_P384_SHA256_ASN1, raw)),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests;
