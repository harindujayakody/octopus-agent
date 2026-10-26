//! Signed CRX3 packages for tests, with a key made per test standing in for
//! the Web Store's on the test's thread.

use super::chrome_id::id_from_key;
use super::crx;
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING};
use sha2::{Digest, Sha256};
use std::io::Write;

pub struct Key {
    pair: EcdsaKeyPair,
    pub spki: Vec<u8>,
}

impl Key {
    pub fn new() -> Key {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).unwrap();
        let pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng).unwrap();
        // SubjectPublicKeyInfo { id-ecPublicKey, prime256v1 } around the point.
        let mut spki = vec![
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
            0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
        ];
        spki.extend_from_slice(pair.public_key().as_ref());
        Key { pair, spki }
    }

    /// The extension id this key gives.
    pub fn id(&self) -> String {
        id_from_key(&self.spki)
    }

    fn sign(&self, msg: &[u8]) -> Vec<u8> {
        self.pair.sign(&SystemRandom::new(), msg).unwrap().as_ref().to_vec()
    }
}

/// While held, `store` signs for the Web Store on this thread.
pub struct StandIn;

pub fn stand_in(store: &Key) -> StandIn {
    crx::TEST_PUBLISHER.with(|c| c.set(Some(Sha256::digest(&store.spki).into())));
    StandIn
}

impl Drop for StandIn {
    fn drop(&mut self) {
        crx::TEST_PUBLISHER.with(|c| c.set(None));
    }
}

pub fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, body) in files {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(body).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn field(n: u64, data: &[u8]) -> Vec<u8> {
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        while v >= 0x80 {
            out.push((v as u8) | 0x80);
            v >>= 7;
        }
        out.push(v as u8);
    }
    let mut out = Vec::new();
    varint(n << 3 | 2, &mut out);
    varint(data.len() as u64, &mut out);
    out.extend_from_slice(data);
    out
}

/// A CRX3 of `archive` signed by the developer's key, and by `store` when given.
pub fn crx3(dev: &Key, store: Option<&Key>, archive: &[u8]) -> Vec<u8> {
    let signed = field(1, &Sha256::digest(&dev.spki)[..16]);
    let mut msg = b"CRX3 SignedData\x00".to_vec();
    msg.extend_from_slice(&(signed.len() as u32).to_le_bytes());
    msg.extend_from_slice(&signed);
    msg.extend_from_slice(archive);
    let mut header = Vec::new();
    for k in std::iter::once(dev).chain(store) {
        header.extend(field(3, &[field(1, &k.spki), field(2, &k.sign(&msg))].concat()));
    }
    header.extend(field(10000, &signed));
    let mut out = b"Cr24".to_vec();
    out.extend_from_slice(&3u32.to_le_bytes());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(archive);
    out
}

/// A store `verified_contents.json` naming `id` at `version` (signature not checked).
pub fn verified_contents(id: &str, version: &str) -> String {
    use base64::Engine;
    let payload = serde_json::json!({ "item_id": id, "item_version": version, "content_hashes": [] });
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string());
    serde_json::json!([{ "description": "treehash per file", "signed_content": { "payload": b64, "signatures": [] } }]).to_string()
}

/// A folder of the test's own, removed when dropped.
pub struct Tmp(pub std::path::PathBuf);

impl Tmp {
    pub fn new(tag: &str) -> Tmp {
        let p = std::env::temp_dir().join(format!("shardx-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// `files` written under `dir`, folders made as needed.
pub fn write_tree(dir: &std::path::Path, files: &[(&str, &[u8])]) {
    for (rel, body) in files {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
}

/// A manifest at `version`, with `extra` keys over the plain ones.
pub fn manifest(version: &str, extra: serde_json::Value) -> String {
    let mut m = serde_json::json!({ "name": "Wallet", "version": version, "manifest_version": 3 });
    if let (Some(m), Some(x)) = (m.as_object_mut(), extra.as_object()) {
        m.extend(x.clone());
    }
    serde_json::to_string_pretty(&m).unwrap()
}
