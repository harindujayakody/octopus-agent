//! A profile's browser cache: how much disk it takes, and emptying it. Only
//! what the browser rebuilds on its own is touched (the HTTP cache, compiled
//! code, shader caches, service worker caches); cookies, logins, history,
//! local storage and extensions stay. The profile must be closed: a running
//! browser holds these files open.

use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Cache folders a Chromium-family browser keeps in its user-data folder.
const CHROMIUM: &[&str] = &[
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnGraphiteCache",
    "Default/DawnWebGPUCache",
    "Default/Service Worker/CacheStorage",
    "Default/Service Worker/ScriptCache",
    "GrShaderCache",
    "GraphiteDawnCache",
    "ShaderCache",
];

/// A profile's cache past this is emptied before it starts (2 GiB).
pub const LIMIT: u64 = 2 * 1024 * 1024 * 1024;

/// When the cache was last emptied, in seconds, beside the profile's data.
const CLEARED: &str = ".octopus-cache-cleared";

/// Cache folders Firefox keeps in its profile folder.
const FIREFOX: &[&str] = &["cache2", "startupCache", "shader-cache", "jumpListCache", "thumbnails"];

/// The profile's own browser folder, if it has one on this computer.
fn udd(id: &str) -> Result<PathBuf> {
    let id = id.trim();
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") {
        bail!("not a profile id: {id}");
    }
    Ok(crate::store::user_data_root()?.join(id))
}

/// Every cache folder the profile has, across the engines it may have run in.
pub fn cache_dirs(udd: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut chromium_roots = vec![udd.to_path_buf()];
    chromium_roots.extend(["chrome", "chromium", "brave", "thorium", "helium"].iter().map(|e| udd.join("engines").join(e)));
    for root in &chromium_roots {
        out.extend(CHROMIUM.iter().map(|rel| root.join(rel)));
    }
    let firefox = udd.join("engines").join("firefox");
    out.extend(FIREFOX.iter().map(|rel| firefox.join(rel)));
    out.into_iter().filter(|p| p.exists()).collect()
}

/// Bytes in an entry, links not followed.
fn size_of(p: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(p) else { return 0 };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if !meta.is_dir() {
        return meta.len();
    }
    fs::read_dir(p).map(|it| it.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0)
}

/// What the profile's cache takes now, in bytes.
pub fn size(id: &str) -> Result<u64> {
    Ok(cache_size(&udd(id)?))
}

fn cache_size(udd: &Path) -> u64 {
    cache_dirs(udd).iter().map(|p| size_of(p)).sum()
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// When the cache in `udd` was last emptied (seconds), if ever.
fn cleared_at(udd: &Path) -> Option<i64> {
    fs::read_to_string(udd.join(CLEARED)).ok()?.trim().parse().ok()
}

/// Empties the cache folders under `udd` and notes when; the bytes freed.
fn clear_dir(udd: &Path) -> Result<u64> {
    let mut freed = 0;
    for dir in cache_dirs(udd) {
        let bytes = size_of(&dir);
        fs::remove_dir_all(&dir).with_context(|| format!("empty {}", dir.display()))?;
        freed += bytes;
    }
    if udd.is_dir() {
        let _ = fs::write(udd.join(CLEARED), now().to_string());
    }
    Ok(freed)
}

/// Empties the profile's cache; returns the bytes freed.
pub fn clear(id: &str) -> Result<u64> {
    if crate::process::Tracker::shared().is_running(id) {
        bail!("Close the profile first: a running browser keeps its cache open.");
    }
    clear_dir(&udd(id)?)
}

/// Before a profile starts: a cache past `LIMIT` is emptied. Never fails the start.
pub fn trim_before_start(udd: &Path) {
    let bytes = cache_size(udd);
    if bytes <= LIMIT {
        return;
    }
    match clear_dir(udd) {
        Ok(freed) => eprintln!("[cache] {} was over 2 GB: {freed} bytes freed", udd.display()),
        Err(e) => eprintln!("[cache] {} not emptied: {e:#}", udd.display()),
    }
}

/// A profile's cache for its editor and Peek.
#[derive(serde::Serialize)]
pub struct CacheInfo {
    pub bytes: u64,
    pub limit: u64,
    /// When it was last emptied (seconds), by hand or by the limit.
    pub cleared_at: Option<i64>,
    /// All the profile's browser data on disk, cache included.
    pub data_bytes: u64,
}

pub fn info(id: &str) -> Result<CacheInfo> {
    let dir = udd(id)?;
    Ok(CacheInfo { bytes: cache_size(&dir), limit: LIMIT, cleared_at: cleared_at(&dir), data_bytes: size_of(&dir) })
}

/// What Octopus Agent keeps on this computer, by kind, for Settings > Storage.
#[derive(serde::Serialize, Default)]
pub struct StorageUsage {
    /// Profiles' browser data, their caches left out.
    pub profiles: u64,
    /// Every profile's cache.
    pub cache: u64,
    /// The browser engine and the installed browsers.
    pub browsers: u64,
    pub extensions: u64,
    pub trash: u64,
    /// Settings, lists, fingerprints and the rest.
    pub other: u64,
    pub profile_count: usize,
}

pub fn usage() -> Result<StorageUsage> {
    let root = crate::store::data_root()?;
    let profiles_root = crate::store::user_data_root()?;
    let mut u = StorageUsage::default();
    let mut all_profiles = 0;
    if let Ok(it) = fs::read_dir(&profiles_root) {
        for e in it.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            u.profile_count += 1;
            all_profiles += size_of(&p);
            u.cache += cache_size(&p);
        }
    }
    u.profiles = all_profiles.saturating_sub(u.cache);
    let ext = crate::store::extensions_dir().map(|d| size_of(&d)).unwrap_or(0) + size_of(&root.join("firefox-addons"));
    u.extensions = ext;
    u.trash = crate::store::trash_dir().map(|d| size_of(&d)).unwrap_or(0);
    let runtime = crate::runtime::runtime_dir().ok();
    u.browsers = runtime.as_deref().map(size_of).unwrap_or(0);
    let total = size_of(&root);
    // What is not counted above, inside the data folder (the runtime may live elsewhere).
    let inside_runtime = runtime.filter(|r| r.starts_with(&root)).map(|r| size_of(&r)).unwrap_or(0);
    u.other = total.saturating_sub(all_profiles + u.extensions + u.trash + inside_runtime);
    Ok(u)
}

/// Empties every closed profile's cache; a running one is left as it is.
#[derive(serde::Serialize)]
pub struct ClearedAll {
    pub freed: u64,
    pub cleared: usize,
    pub skipped_running: usize,
}

pub fn clear_all() -> Result<ClearedAll> {
    let root = crate::store::user_data_root()?;
    let tracker = crate::process::Tracker::shared();
    let mut out = ClearedAll { freed: 0, cleared: 0, skipped_running: 0 };
    for e in fs::read_dir(&root)?.flatten() {
        let p = e.path();
        let Some(id) = p.file_name().and_then(|n| n.to_str()).map(str::to_owned) else { continue };
        if !p.is_dir() {
            continue;
        }
        if tracker.is_running(&id) {
            out.skipped_running += 1;
            continue;
        }
        if cache_size(&p) == 0 {
            continue;
        }
        match clear_dir(&p) {
            Ok(n) => {
                out.freed += n;
                out.cleared += 1;
            }
            Err(e) => eprintln!("[cache] {id} not emptied: {e:#}"),
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn profile_cache_info(id: String) -> Result<CacheInfo, String> {
    tokio::task::spawn_blocking(move || info(&id)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn storage_usage() -> Result<StorageUsage, String> {
    tokio::task::spawn_blocking(usage).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn cache_clear_all() -> Result<ClearedAll, String> {
    tokio::task::spawn_blocking(clear_all).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

/// How much disk the profile's browser cache takes.
#[tauri::command]
pub async fn profile_cache_size(id: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || size(&id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Empties the profile's browser cache; cookies, logins and history stay.
#[tauri::command]
pub async fn profile_cache_clear(id: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || clear(&id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cache_folders_are_found() {
        let dir = std::env::temp_dir().join(format!("octopus-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Default/Cache/Cache_Data")).unwrap();
        fs::write(dir.join("Default/Cache/Cache_Data/f"), [0u8; 10]).unwrap();
        fs::create_dir_all(dir.join("Default/Local Storage")).unwrap();
        fs::create_dir_all(dir.join("engines/firefox/cache2")).unwrap();
        let found = cache_dirs(&dir);
        assert!(found.contains(&dir.join("Default/Cache")));
        assert!(found.contains(&dir.join("engines/firefox/cache2")));
        assert!(!found.iter().any(|p| p.ends_with("Local Storage")));
        assert_eq!(found.iter().map(|p| size_of(p)).sum::<u64>(), 10);
        let _ = fs::remove_dir_all(&dir);
    }
}
