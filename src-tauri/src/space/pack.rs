//! A profile's session as one archive: the browser data that carries the
//! account, its cookies and saved passwords in a form any machine takes back,
//! and a manifest. Packed once the browser has closed, unpacked before it starts.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::local::cookies;

/// The format this launcher writes; a newer one is refused, not half-read.
const FORMAT: u32 = 1;
/// Where the browser data sits in the archive.
const UDD: &str = "udd/";
const MANIFEST: &str = "manifest.json";
const COOKIES: &str = "cookies.json";
const LOGINS: &str = "passwords.json";
/// The most an archive may unpack to, whatever it claims.
const UNPACK_MAX: u64 = 4 * 1024 * 1024 * 1024;
/// Files this big are stored as they are: they are mostly compressed already.
const STORE_FROM: u64 = 8 * 1024 * 1024;

/// What of the browser data travels; the rest is cache, made again on the next start.
const KEEP: &[&str] = &[
    "Local State",
    "Default/Preferences",
    "Default/Secure Preferences",
    "Default/Bookmarks",
    "Default/Cookies",
    "Default/Cookies-journal",
    "Default/Network/Cookies",
    "Default/Network/Cookies-journal",
    "Default/Network/TransportSecurity",
    "Default/Network/Network Persistent State",
    "Default/Network/Trust Tokens",
    "Default/Network/Trust Tokens-journal",
    "Default/Login Data",
    "Default/Login Data-journal",
    "Default/Login Data For Account",
    "Default/Login Data For Account-journal",
    "Default/Web Data",
    "Default/Web Data-journal",
    "Default/History",
    "Default/History-journal",
    "Default/Favicons",
    "Default/Favicons-journal",
    "Default/Top Sites",
    "Default/Top Sites-journal",
    "Default/Shortcuts",
    "Default/Shortcuts-journal",
    "Default/Visited Links",
    "Default/Sessions",
    "Default/Session Storage",
    "Default/Local Storage",
    "Default/IndexedDB",
    "Default/databases",
    "Default/File System",
    "Default/Service Worker",
    "Default/shared_proto_db",
    "Default/Extension State",
    "Default/Local Extension Settings",
    "Default/Sync Extension Settings",
    "Default/Extension Rules",
    "Default/Extension Scripts",
    // declarativeNetRequest dynamic rules; their checksum travels in
    // Preferences, so without the files they fail to load.
    "Default/DNR Extension Rules",
];

/// Caches inside kept folders: never packed.
const NOT_INSIDE: &[&str] = &["CacheStorage", "Cache", "Code Cache", "GPUCache"];

/// The cookie store as this OS encrypts it: taken raw only by the same OS.
const RAW_COOKIES: &[&str] = &[
    "Default/Cookies",
    "Default/Cookies-journal",
    "Default/Network/Cookies",
    "Default/Network/Cookies-journal",
];

/// Site storage left out first, an origin at a time, when a session is past its budget.
const BULKY: &[&str] = &[
    "Default/IndexedDB",
    "Default/File System",
    "Default/Service Worker",
    "Default/databases",
];

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    format: u32,
    /// `std::env::consts::OS` of the machine that packed it.
    os: String,
    made_at: u64,
    launcher: String,
    #[serde(default)]
    cookies: usize,
    #[serde(default)]
    logins: usize,
    /// Site storage left out for the budget.
    #[serde(default)]
    left_out: Vec<String>,
}

/// What a pack made.
#[derive(Debug)]
pub struct Packed {
    pub size: u64,
    /// Site storage left out to stay within the budget.
    pub left_out: Vec<String>,
}

/// What an unpack did.
#[derive(Debug, PartialEq, Eq)]
pub struct Unpacked {
    /// The same OS packed it: the cookie store came as it was.
    pub raw: bool,
    pub cookies: usize,
    pub logins: usize,
}

struct Item {
    /// Under the data folder, with `/`.
    rel: String,
    path: PathBuf,
    size: u64,
}

/// Pack the browser data at `udd` into `out`, at most `budget` bytes of it.
pub fn pack(udd: &Path, out: &Path, budget: u64) -> Result<Packed> {
    pack_as(udd, out, budget, std::env::consts::OS)
}

fn pack_as(udd: &Path, out: &Path, budget: u64, os: &str) -> Result<Packed> {
    // A store that cannot be read costs its own part of the session, not the rest.
    let jar = cookies::export(udd).unwrap_or_else(|e| {
        eprintln!("[launcher] session: cookies not read for the portable copy: {e:#}");
        Vec::new()
    });
    let logins = cookies::export_logins(udd).unwrap_or_else(|e| {
        eprintln!("[launcher] session: saved passwords not read for the portable copy: {e:#}");
        Vec::new()
    });
    let jar_json = serde_json::to_vec(&jar)?;
    let logins_json = serde_json::to_vec(&logins)?;
    let mut items = gather(udd);
    let room = budget.saturating_sub((jar_json.len() + logins_json.len()) as u64);
    let left_out = trim(&mut items, room);
    let total: u64 = items.iter().map(|i| i.size).sum();
    if total > room {
        bail!("the session is {} MB, more than the {} MB the server keeps", mb(total), mb(budget));
    }
    let manifest = Manifest {
        format: FORMAT,
        os: os.to_string(),
        made_at: now(),
        launcher: env!("CARGO_PKG_VERSION").to_string(),
        cookies: jar.len(),
        logins: logins.len(),
        left_out: left_out.clone(),
    };

    let file = fs::File::create(out).with_context(|| format!("create {}", out.display()))?;
    let mut zip = zip::ZipWriter::new(io::BufWriter::new(file));
    let small = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(1));
    let big = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file(MANIFEST, small)?;
    zip.write_all(&serde_json::to_vec(&manifest)?)?;
    zip.start_file(COOKIES, small)?;
    zip.write_all(&jar_json)?;
    zip.start_file(LOGINS, small)?;
    zip.write_all(&logins_json)?;
    for item in &items {
        // Gone since it was listed: the rest still goes.
        let Ok(mut src) = fs::File::open(&item.path) else { continue };
        zip.start_file(format!("{UDD}{}", item.rel), if item.size >= STORE_FROM { big } else { small })?;
        io::copy(&mut src, &mut zip).with_context(|| format!("pack {}", item.rel))?;
    }
    let mut w = zip.finish()?;
    w.flush()?;
    w.into_inner().map_err(|e| e.into_error())?.sync_all()?;
    Ok(Packed { size: fs::metadata(out)?.len(), left_out })
}

/// Every kept file under `udd`; links are never followed.
fn gather(udd: &Path) -> Vec<Item> {
    let mut out = Vec::new();
    for rel in KEEP {
        let path = udd.join(rel);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() => out.push(Item { rel: rel.to_string(), path, size: m.len() }),
            Ok(m) if m.is_dir() => walk(&path, rel, &mut out),
            _ => {}
        }
    }
    out
}

fn walk(dir: &Path, rel: &str, out: &mut Vec<Item>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name();
        if crate::store::is_os_litter(&name) || NOT_INSIDE.iter().any(|n| name == *n) {
            continue;
        }
        let child = format!("{rel}/{}", name.to_string_lossy());
        match e.file_type() {
            Ok(t) if t.is_dir() => walk(&e.path(), &child, out),
            Ok(t) if t.is_file() => {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(Item { rel: child, path: e.path(), size });
            }
            _ => {}
        }
    }
}

/// Leave out site storage, the largest origin first, until the rest fits `room`.
fn trim(items: &mut Vec<Item>, room: u64) -> Vec<String> {
    let mut total: u64 = items.iter().map(|i| i.size).sum();
    let mut left_out = Vec::new();
    if total <= room {
        return left_out;
    }
    let mut groups: Vec<(String, u64)> = Vec::new();
    for i in items.iter() {
        if let Some(g) = group(&i.rel) {
            match groups.iter_mut().find(|(k, _)| *k == g) {
                Some((_, n)) => *n += i.size,
                None => groups.push((g, i.size)),
            }
        }
    }
    groups.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for (g, size) in groups {
        if total <= room {
            break;
        }
        total -= size;
        items.retain(|i| group(&i.rel).as_deref() != Some(g.as_str()));
        left_out.push(g);
    }
    left_out
}

/// The site storage a file belongs to: an origin's folder, or the whole store.
/// An origin's IndexedDB is two folders, its database and its blobs: one group.
fn group(rel: &str) -> Option<String> {
    let base = BULKY.iter().find(|b| rel.starts_with(&format!("{b}/")))?;
    let rest = &rel[base.len() + 1..];
    match rest.split_once('/') {
        Some((origin, _)) if *base == "Default/IndexedDB" => {
            let origin = [".indexeddb.leveldb", ".indexeddb.blob"]
                .iter()
                .find_map(|s| origin.strip_suffix(s))
                .unwrap_or(origin);
            Some(format!("{base}/{origin}"))
        }
        Some((origin, _)) if *base == "Default/File System" => Some(format!("{base}/{origin}")),
        _ => Some(base.to_string()),
    }
}

/// Unpack a session into `udd`. From another OS, or any Windows, the cookie
/// store is rebuilt from the portable copy and the passwords sealed with this
/// machine's key: the raw ones are bound to the machine that wrote them.
pub fn unpack(zip: &Path, udd: &Path) -> Result<Unpacked> {
    unpack_on(zip, udd, std::env::consts::OS)
}

fn unpack_on(zip_path: &Path, udd: &Path, os: &str) -> Result<Unpacked> {
    fs::create_dir_all(udd)?;
    let file = fs::File::open(zip_path).with_context(|| format!("open {}", zip_path.display()))?;
    let mut zip = zip::ZipArchive::new(io::BufReader::new(file)).context("the session is not an archive")?;
    let manifest: Manifest = {
        let entry = zip.by_name(MANIFEST).context("the session has no manifest")?;
        serde_json::from_reader(entry).context("the session's manifest is not readable")?
    };
    if manifest.format > FORMAT {
        bail!("this session was saved by a newer launcher: update this one to open it");
    }
    let raw = manifest.os == os && os != "windows";
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        if entry.is_dir() {
            continue;
        }
        // A name that climbs out of the folder is not one of ours.
        let Some(name) = entry.enclosed_name() else { continue };
        let name = name.to_string_lossy().replace('\\', "/");
        let Some(rel) = name.strip_prefix(UDD) else { continue };
        if rel.is_empty() || (!raw && RAW_COOKIES.contains(&rel)) {
            continue;
        }
        let size = entry.size();
        total += size;
        if total > UNPACK_MAX {
            bail!("the session unpacks to more than {} MB", mb(UNPACK_MAX));
        }
        let dest = udd.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&dest).with_context(|| format!("unpack {rel}"))?;
        let n = io::copy(&mut entry.by_ref().take(size + 1), &mut out)?;
        if n != size {
            bail!("{rel} in the session is not the size it says");
        }
    }
    if raw {
        return Ok(Unpacked { raw: true, cookies: 0, logins: 0 });
    }
    cookies::forget_key(udd)?;
    let jar: Vec<cookies::Cookie> = read_json(&mut zip, COOKIES)?;
    let jar_n = if jar.is_empty() { 0 } else { cookies::import(udd, &jar)? };
    let logins: Vec<cookies::SavedLogin> = read_json(&mut zip, LOGINS)?;
    let logins_n = cookies::reseal_logins(udd, &logins)?;
    Ok(Unpacked { raw: false, cookies: jar_n, logins: logins_n })
}

fn read_json<T: serde::de::DeserializeOwned + Default, R: Read + io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<T> {
    match zip.by_name(name) {
        Ok(entry) => serde_json::from_reader(entry).with_context(|| format!("the session's {name} is not readable")),
        Err(zip::result::ZipError::FileNotFound) => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mb(n: u64) -> u64 {
    n.div_ceil(1024 * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("shardx-pack-{tag}-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn put(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    fn jar() -> Vec<cookies::Cookie> {
        serde_json::from_value(serde_json::json!([
            { "domain": ".shop.example", "name": "sid", "value": "s3cret", "expires": 4000000000.0, "secure": true },
            { "domain": "mail.example", "name": "lang", "value": "de" },
        ]))
        .unwrap()
    }

    /// A password database as Chromium keeps it, as far as a re-seal reads it.
    fn logins_db(udd: &Path, sealed: &[u8]) {
        let path = udd.join("Default/Login Data");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let db = rusqlite::Connection::open(path).unwrap();
        db.execute_batch(
            "CREATE TABLE logins (id INTEGER PRIMARY KEY, origin_url TEXT, username_value TEXT, password_value BLOB);",
        )
        .unwrap();
        db.execute(
            "INSERT INTO logins (id, origin_url, username_value, password_value) VALUES (7, 'https://shop.example/', 'vera', ?1)",
            [sealed],
        )
        .unwrap();
    }

    fn b64(bytes: &[u8]) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn names(zip_path: &Path) -> Vec<String> {
        let mut z = zip::ZipArchive::new(fs::File::open(zip_path).unwrap()).unwrap();
        (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect()
    }

    #[test]
    fn a_session_from_another_os_brings_its_cookies_and_passwords_back() {
        let dir = temp("foreign");
        // Packed elsewhere: the raw stores and the key are that machine's, useless here.
        let other = if cfg!(windows) { "macos" } else { "windows" };
        let foreign = dir.join("foreign.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&foreign).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            let manifest = serde_json::json!({ "format": 1, "os": other, "made_at": 1, "launcher": "2.1.0", "cookies": 2, "logins": 1 });
            let files: Vec<(&str, Vec<u8>)> = vec![
                (MANIFEST, manifest.to_string().into_bytes()),
                (COOKIES, serde_json::to_vec(&jar()).unwrap()),
                (LOGINS, serde_json::to_vec(&serde_json::json!([{ "db": "Login Data", "id": 7, "value": b64(b"hunter2") }])).unwrap()),
                ("udd/Local State", br#"{"os_crypt":{"encrypted_key":"RFBBUElmb3JlaWdu"},"browser":{"x":1}}"#.to_vec()),
                ("udd/Default/Cookies", b"another machine's cookie store".to_vec()),
                ("udd/Default/Network/Cookies", b"and its newer one".to_vec()),
                ("udd/Default/Preferences", br#"{"profile":{"name":"x"}}"#.to_vec()),
                ("../escape.txt", b"outside".to_vec()),
                ("udd/../../climb.txt", b"outside".to_vec()),
            ];
            for (name, body) in files {
                z.start_file(name, o).unwrap();
                z.write_all(&body).unwrap();
            }
            // Its password database, with a value sealed by a key this machine never had.
            let src = dir.join("src");
            logins_db(&src, b"v10 sealed elsewhere, not readable here");
            z.start_file("udd/Default/Login Data", o).unwrap();
            z.write_all(&fs::read(src.join("Default/Login Data")).unwrap()).unwrap();
            z.finish().unwrap();
        }

        let udd = dir.join("udd");
        let got = unpack(&foreign, &udd).unwrap();
        assert_eq!(got, Unpacked { raw: false, cookies: 2, logins: 1 });
        let back = cookies::export(&udd).unwrap();
        let mut pairs: Vec<_> = back.iter().map(|c| (c.domain.as_str(), c.name.as_str(), c.value.as_str())).collect();
        pairs.sort();
        assert_eq!(pairs, [(".shop.example", "sid", "s3cret"), ("mail.example", "lang", "de")]);
        let logins = cookies::export_logins(&udd).unwrap();
        assert_eq!(logins.len(), 1);
        assert_eq!((logins[0].id, logins[0].value.as_str()), (7, b64(b"hunter2").as_str()));
        let state = fs::read_to_string(udd.join("Local State")).unwrap();
        assert!(!state.contains("RFBBUElmb3JlaWdu"), "the other machine's key stays out: {state}");
        assert!(state.contains("\"browser\""), "the rest of Local State stays");
        assert!(!udd.join("Default/Network/Cookies").exists());
        assert_eq!(fs::read(udd.join("Default/Preferences")).unwrap(), br#"{"profile":{"name":"x"}}"#);
        assert!(!dir.join("escape.txt").exists() && !dir.parent().unwrap().join("climb.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_same_os_takes_the_raw_stores_and_caches_never_travel() {
        let dir = temp("same");
        let src = dir.join("src");
        fs::create_dir_all(&src).unwrap();
        put(&src.join("Local State"), b"{}");
        cookies::import(&src, &jar()).unwrap();
        put(&src.join("Default/Local Storage/leveldb/000003.log"), b"site storage");
        put(&src.join("Default/Cache/Cache_Data/data_1"), b"cache");
        put(&src.join("Default/Service Worker/CacheStorage/x/1"), b"cache");
        put(&src.join("Default/Service Worker/Database/CURRENT"), b"registrations");
        put(&src.join("GPUCache/data_0"), b"cache");
        put(&src.join("fingerprint.json"), b"{}");
        let zip = dir.join("s.zip");
        pack(&src, &zip, 1 << 30).unwrap();
        let listed = names(&zip);
        for n in ["manifest.json", "cookies.json", "passwords.json", "udd/Default/Cookies", "udd/Default/Service Worker/Database/CURRENT"] {
            assert!(listed.iter().any(|l| l == n), "{n} missing: {listed:?}");
        }
        for n in ["Cache", "CacheStorage", "GPUCache", "fingerprint.json"] {
            assert!(!listed.iter().any(|l| l.contains(n)), "{n} packed: {listed:?}");
        }

        let udd = dir.join("udd");
        let got = unpack(&zip, &udd).unwrap();
        // Raw only between the same macOS or Linux; Windows always rebuilds.
        assert_eq!(got.raw, !cfg!(windows));
        if !cfg!(windows) {
            assert_eq!(fs::read(udd.join("Default/Cookies")).unwrap(), fs::read(src.join("Default/Cookies")).unwrap());
        }
        assert_eq!(cookies::export(&udd).unwrap().len(), 2);
        assert_eq!(fs::read(udd.join("Default/Local Storage/leveldb/000003.log")).unwrap(), b"site storage");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn past_its_budget_the_largest_site_storage_is_left_out_first() {
        let dir = temp("budget");
        let src = dir.join("src");
        put(&src.join("Local State"), b"{}");
        put(&src.join("Default/Preferences"), &[b'p'; 1000]);
        put(&src.join("Default/IndexedDB/https_big_0.indexeddb.leveldb/000005.ldb"), &[1; 60_000]);
        put(&src.join("Default/IndexedDB/https_small_0.indexeddb.leveldb/000005.ldb"), &[2; 10_000]);
        put(&src.join("Default/Service Worker/Database/CURRENT"), &[3; 30_000]);
        let zip = dir.join("s.zip");
        let packed = pack(&src, &zip, 50_000).unwrap();
        assert_eq!(packed.left_out, ["Default/IndexedDB/https_big_0"]);
        let listed = names(&zip);
        assert!(listed.iter().any(|n| n.contains("https_small_0")));
        assert!(!listed.iter().any(|n| n.contains("https_big_0")));
        // What is left is still too much: refused, never cut into the account itself.
        let err = pack(&src, &zip, 500).unwrap_err().to_string();
        assert!(err.contains("more than"), "{err}");
        fs::remove_dir_all(&dir).unwrap();
    }

    /// An origin's IndexedDB goes or stays whole: its records never travel
    /// without the blob files they point at.
    #[test]
    fn an_origins_indexeddb_and_its_blobs_are_left_out_together() {
        let dir = temp("idb-blobs");
        let src = dir.join("src");
        put(&src.join("Local State"), b"{}");
        put(&src.join("Default/IndexedDB/https_big_0.indexeddb.blob/1/00/1"), &[1; 60_000]);
        put(&src.join("Default/IndexedDB/https_big_0.indexeddb.leveldb/000005.ldb"), &[2; 1_000]);
        put(&src.join("Default/IndexedDB/https_other_0.indexeddb.leveldb/000005.ldb"), &[3; 20_000]);
        let zip = dir.join("s.zip");
        let packed = pack(&src, &zip, 40_000).unwrap();
        assert_eq!(packed.left_out, ["Default/IndexedDB/https_big_0"]);
        let listed = names(&zip);
        assert!(!listed.iter().any(|n| n.contains("https_big_0")), "{listed:?}");
        assert!(listed.iter().any(|n| n.contains("https_other_0")), "{listed:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_session_from_a_newer_launcher_is_refused_whole() {
        let dir = temp("newer");
        let zip_path = dir.join("n.zip");
        let mut z = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
        z.start_file(MANIFEST, zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(br#"{"format":99,"os":"macos","made_at":1,"launcher":"9"}"#).unwrap();
        z.finish().unwrap();
        let err = unpack(&zip_path, &dir.join("udd")).unwrap_err().to_string();
        assert!(err.contains("newer launcher"), "{err}");
        fs::remove_dir_all(&dir).unwrap();
    }
}
