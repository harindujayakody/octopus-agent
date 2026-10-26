//! CRX3 checks. `signed.crx3` was built outside Rust (Python and openssl)
//! with throwaway keys: an RSA developer key and an EC key standing in for
//! the store. Every other package here is signed by EC keys made per test.

use super::*;
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING};

const FIXTURE_ID: &str = "dgjpfpioonbhbdikcheeaacgchdkgodl";
const FIXTURE_KEY: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtFIn2HEqKIFrgb+6OmBhOFfma3xIblqkf3ZtcsCUwqO0qFqFOu6qZMF+OvJ0aCWqN+ZEY3cuY86UBkDFvvLmKluyujgd2God1Ioc4sFi2bAw+qfbBimQSJTEvlOOL0BiXwmEOMLylgrISE5bv+ewMWXFCGBQhZYY03kR7SwYOnKQ8+ddx72Jw80Sk6dqW4zUFCBq32Qxjt5xXUcl4YPcW/rUjTfdfWbvhwmvZNAJPUqtf81vEZdB3pS1tFRMv647VVHa+jZSBnOx4o+DRNlFWfhDEzpX0YyDn0FFRCdE3GJt3fLG79XjBZRbzY/gfr6N7dml2t3w+/GACcf9EjnxsQIDAQAB";
/// SHA-256 of the fixture's stand-in store key.
const FIXTURE_PUBLISHER: &str = "4f86f66c37eeb3129839e3aef81328747e7e624c4e048d3427a6f6082cbfba02";

fn fixture() -> Vec<u8> {
    std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ext/signed.crx3")).unwrap()
}

fn hash32(hex: &str) -> [u8; 32] {
    let v: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap()).collect();
    v.try_into().unwrap()
}

struct Key {
    pair: EcdsaKeyPair,
    spki: Vec<u8>,
}

impl Key {
    fn new() -> Key {
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

    fn sign(&self, msg: &[u8]) -> Vec<u8> {
        self.pair.sign(&SystemRandom::new(), msg).unwrap().as_ref().to_vec()
    }

    fn id_bytes(&self) -> Vec<u8> {
        Sha256::digest(&self.spki)[..16].to_vec()
    }

    fn hash(&self) -> [u8; 32] {
        Sha256::digest(&self.spki).into()
    }
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

fn zip(files: &[(&str, &str)]) -> Vec<u8> {
    use std::io::Write;
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, body) in files {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(body.as_bytes()).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn archive() -> Vec<u8> {
    zip(&[("manifest.json", r#"{"name":"t","version":"1.0","manifest_version":3}"#), ("a.js", "1;")])
}

fn package(header: &[u8], archive: &[u8]) -> Vec<u8> {
    let mut out = b"Cr24".to_vec();
    out.extend_from_slice(&3u32.to_le_bytes());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(header);
    out.extend_from_slice(archive);
    out
}

/// A CRX3 signed by `proofs` (field 2 or 3, key) for the id `crx_id`;
/// `extra` goes into the header as is.
fn crx(proofs: &[(u64, &Key)], crx_id: &[u8], archive: &[u8], extra: &[u8]) -> Vec<u8> {
    let signed = field(1, crx_id);
    let mut msg = SIGNATURE_CONTEXT.to_vec();
    msg.extend_from_slice(&(signed.len() as u32).to_le_bytes());
    msg.extend_from_slice(&signed);
    msg.extend_from_slice(archive);
    let mut header = Vec::new();
    for (f, k) in proofs {
        header.extend(field(*f, &[field(1, &k.spki), field(2, &k.sign(&msg))].concat()));
    }
    header.extend_from_slice(extra);
    header.extend(field(10000, &signed));
    package(&header, archive)
}

fn just(id: Option<&str>) -> Expect<'_> {
    Expect { id, ..Default::default() }
}

#[test]
fn fixture_built_elsewhere_verifies() {
    let bytes = fixture();
    let sha = format!("{:x}", Sha256::digest(&bytes));
    let expect = Expect { id: Some(FIXTURE_ID), publisher: Some(hash32(FIXTURE_PUBLISHER)), sha256: Some(&sha), size: Some(bytes.len() as u64) };
    let v = verify(&bytes, &expect).unwrap();
    assert_eq!(v.crx_id, FIXTURE_ID);
    assert_eq!(v.key_b64(), FIXTURE_KEY);
    assert_eq!(super::super::chrome_id::id_from_key(&v.developer_key), FIXTURE_ID);
    assert_eq!(v.sha256, sha);
    assert!(!v.store_signed(), "a stand-in key is not the store's");
    assert!(v.proof_keys.contains(&hash32(FIXTURE_PUBLISHER)));
    let item = verified_item(v.verified_contents.as_deref().unwrap()).unwrap();
    assert_eq!(item, StoreItem { id: FIXTURE_ID.into(), version: "1.2.3".into() });
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(&bytes[v.archive_offset..])).unwrap();
    let mut manifest = String::new();
    z.by_name("manifest.json").unwrap().read_to_string(&mut manifest).unwrap();
    assert!(manifest.contains("\"version\": \"1.2.3\""));
}

#[test]
fn fixture_lacks_the_real_store_proof() {
    let bytes = fixture();
    assert_eq!(verify(&bytes, &Expect::store(FIXTURE_ID, None, None)).unwrap_err(), Reject::NoPublisherProof);
    // As a direct link it needs no store proof.
    assert!(verify(&bytes, &just(Some(FIXTURE_ID))).is_ok());
}

#[test]
fn fixture_tampered() {
    let bytes = fixture();
    let ok = verify(&bytes, &Expect::default()).unwrap();
    let mut archive_byte = bytes.clone();
    *archive_byte.last_mut().unwrap() ^= 1;
    assert_eq!(verify(&archive_byte, &Expect::default()).unwrap_err(), Reject::BadSignature);
    // Inside the RSA proof's signature.
    let header = &bytes[12..ok.archive_offset];
    let (_, proof) = fields(header).unwrap().into_iter().find(|f| f.0 == 2).unwrap();
    let (_, sig) = fields(proof).unwrap().into_iter().find(|f| f.0 == 2).unwrap();
    let at = sig.as_ptr() as usize - bytes.as_ptr() as usize + 10;
    let mut sig_byte = bytes.clone();
    sig_byte[at] ^= 1;
    assert_eq!(verify(&sig_byte, &Expect::default()).unwrap_err(), Reject::BadSignature);
}

#[test]
fn hash_size_and_id_from_the_answer() {
    let bytes = fixture();
    let zeros = "0".repeat(64);
    assert_eq!(verify(&bytes, &Expect { sha256: Some(&zeros), ..Default::default() }).unwrap_err(), Reject::WrongHash);
    let upper = format!("{:X}", Sha256::digest(&bytes));
    assert!(verify(&bytes, &Expect { sha256: Some(&upper), ..Default::default() }).is_ok());
    assert_eq!(
        verify(&bytes, &Expect { size: Some(1), ..Default::default() }).unwrap_err(),
        Reject::WrongSize { want: 1, got: bytes.len() as u64 }
    );
    let other = "nkbihfbeogaeaoehlefnkodbefgpgknn";
    assert_eq!(
        verify(&bytes, &just(Some(other))).unwrap_err(),
        Reject::WrongId { want: other.into(), got: FIXTURE_ID.into() }
    );
}

#[test]
fn ecdsa_developer_and_publisher() {
    let (dev, store) = (Key::new(), Key::new());
    let a = archive();
    let both = crx(&[(3, &store), (3, &dev)], &dev.id_bytes(), &a, &[]);
    let want = super::super::chrome_id::id_from_key(&dev.spki);
    let v = verify(&both, &Expect { id: Some(&want), publisher: Some(store.hash()), ..Default::default() }).unwrap();
    assert_eq!(v.crx_id, want);
    assert_eq!(v.developer_key, dev.spki);
    assert_eq!(v.proof_keys.len(), 2);
    assert!(v.verified_contents.is_none());

    let alone = crx(&[(3, &dev)], &dev.id_bytes(), &a, &[]);
    assert_eq!(
        verify(&alone, &Expect { publisher: Some(store.hash()), ..Default::default() }).unwrap_err(),
        Reject::NoPublisherProof
    );
    assert!(verify(&alone, &Expect::default()).is_ok());
}

#[test]
fn the_signed_id_must_be_a_signers() {
    let (dev, other) = (Key::new(), Key::new());
    let a = archive();
    let wrong = crx(&[(3, &dev)], &other.id_bytes(), &a, &[]);
    assert_eq!(verify(&wrong, &Expect::default()).unwrap_err(), Reject::NoDeveloperProof);
    let short = crx(&[(3, &dev)], &dev.id_bytes()[..15], &a, &[]);
    assert_eq!(verify(&short, &Expect::default()).unwrap_err(), Reject::NoDeveloperProof);
    let unsigned = package(&field(10000, &field(1, &dev.id_bytes())), &a);
    assert_eq!(verify(&unsigned, &Expect::default()).unwrap_err(), Reject::NoDeveloperProof);
}

#[test]
fn every_proof_must_verify() {
    let (dev, stranger) = (Key::new(), Key::new());
    let a = archive();
    let mut bytes = crx(&[(3, &dev), (3, &stranger)], &dev.id_bytes(), &a, &[]);
    assert!(verify(&bytes, &Expect::default()).is_ok());
    // The stranger's signature, spoiled: its last byte before the signed header.
    let header_size = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let (_, proof) = fields(&bytes[12..12 + header_size]).unwrap().into_iter().filter(|f| f.0 == 3).nth(1).unwrap();
    let at = proof.as_ptr() as usize - bytes.as_ptr() as usize + proof.len() - 1;
    bytes[at] ^= 1;
    assert_eq!(verify(&bytes, &Expect::default()).unwrap_err(), Reject::BadSignature);
}

#[test]
fn keys_of_the_wrong_kind() {
    let dev = Key::new();
    let a = archive();
    let as_rsa = crx(&[(2, &dev)], &dev.id_bytes(), &a, &[]);
    assert_eq!(verify(&as_rsa, &Expect::default()).unwrap_err(), Reject::BadKey);
    let junk = field(3, &[field(1, b"not a key"), field(2, b"sig")].concat());
    let with_junk = crx(&[(3, &dev)], &dev.id_bytes(), &a, &junk);
    assert_eq!(verify(&with_junk, &Expect::default()).unwrap_err(), Reject::BadKey);
}

#[test]
fn not_crx3() {
    let a = archive();
    assert_eq!(verify(&a, &Expect::default()).unwrap_err(), Reject::NotCrx3);
    let mut crx2 = b"Cr24".to_vec();
    for n in [2u32, 3, 3] {
        crx2.extend_from_slice(&n.to_le_bytes());
    }
    crx2.extend_from_slice(b"keysig");
    assert_eq!(verify(&crx2, &Expect::default()).unwrap_err(), Reject::NotCrx3);
    let mut diff = fixture();
    diff[..4].copy_from_slice(b"CrOD");
    assert_eq!(verify(&diff, &Expect::default()).unwrap_err(), Reject::NotCrx3);
    assert_eq!(verify(b"Cr24", &Expect::default()).unwrap_err(), Reject::NotCrx3);
}

#[test]
fn header_size_out_of_bounds() {
    let mut past = fixture();
    let len = past.len() as u32;
    past[8..12].copy_from_slice(&(len - 11).to_le_bytes());
    assert_eq!(verify(&past, &Expect::default()).unwrap_err(), Reject::HeaderSize);
    let huge = package(&vec![0u8; MAX_HEADER + 1], b"");
    assert_eq!(verify(&huge, &Expect::default()).unwrap_err(), Reject::HeaderSize);
}

#[test]
fn zip_markers_in_the_header() {
    let dev = Key::new();
    let a = archive();
    for token in ZIP_TOKENS {
        let in_unknown = crx(&[(3, &dev)], &dev.id_bytes(), &a, &field(7, &[b"x", token, b"y"].concat()));
        assert_eq!(verify(&in_unknown, &Expect::default()).unwrap_err(), Reject::ZipTokenInHeader, "{token:?}");
        let in_contents = crx(&[(3, &dev)], &dev.id_bytes(), &a, &field(4, token));
        assert_eq!(verify(&in_contents, &Expect::default()).unwrap_err(), Reject::ZipTokenInHeader, "{token:?}");
    }
}

#[test]
fn malformed_header() {
    let truncated = package(&[0x12, 0x05, 0x01], &archive());
    assert_eq!(verify(&truncated, &Expect::default()).unwrap_err(), Reject::BadHeader);
    let group = package(&[0x0b], &archive());
    assert_eq!(verify(&group, &Expect::default()).unwrap_err(), Reject::BadHeader);
}

#[test]
fn the_last_signed_header_counts() {
    let (dev, other) = (Key::new(), Key::new());
    let a = archive();
    let first = field(10000, &field(1, &other.id_bytes()));
    let bytes = crx(&[(3, &dev)], &dev.id_bytes(), &a, &first);
    assert_eq!(verify(&bytes, &Expect::default()).unwrap().crx_id, super::super::chrome_id::id_from_key(&dev.spki));
}

#[test]
fn verified_contents_in_the_header() {
    use std::io::Write;
    let dev = Key::new();
    let id = super::super::chrome_id::id_from_key(&dev.spki);
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(format!(r#"{{"item_id":"{id}","item_version":"1.0","content_hashes":[]}}"#));
    let json = format!(r#"[{{"description":"treehash per file","signed_content":{{"payload":"{payload}","signatures":[]}}}}]"#);
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(json.as_bytes()).unwrap();
    let bytes = crx(&[(3, &dev)], &dev.id_bytes(), &archive(), &field(4, &gz.finish().unwrap()));
    let v = verify(&bytes, &Expect::default()).unwrap();
    assert_eq!(v.verified_contents.as_deref(), Some(json.as_bytes()));
    assert_eq!(verified_item(json.as_bytes()), Some(StoreItem { id, version: "1.0".into() }));
    // Not gzip: no contents, the package itself is still fine.
    let bytes = crx(&[(3, &dev)], &dev.id_bytes(), &archive(), &field(4, b"plain"));
    assert!(verify(&bytes, &Expect::default()).unwrap().verified_contents.is_none());
}

#[test]
fn verified_item_reads_only_the_tree_hashes() {
    let id = "dmkamcknogkgcdfhhbddcghachkejeap";
    let p = |s: &str| base64::engine::general_purpose::URL_SAFE.encode(s);
    let doc = |desc: &str, payload: &str| format!(r#"[{{"description":"{desc}","signed_content":{{"payload":"{payload}"}}}}]"#);
    let good = p(&format!(r#"{{"item_id":"{id}","item_version":"0.13.45"}}"#));
    assert_eq!(verified_item(doc("treehash per file", &good).as_bytes()).unwrap().version, "0.13.45", "padded payload");
    assert!(verified_item(doc("something else", &good).as_bytes()).is_none());
    assert!(verified_item(doc("treehash per file", &p(r#"{"item_id":"NOT-AN-ID","item_version":"1"}"#)).as_bytes()).is_none());
    assert!(verified_item(b"{}").is_none());
    assert!(verified_item(b"not json").is_none());
}
