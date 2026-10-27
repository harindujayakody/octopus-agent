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
    Ok(cache_dirs(&udd(id)?).iter().map(|p| size_of(p)).sum())
}

/// Empties the profile's cache; returns the bytes freed.
pub fn clear(id: &str) -> Result<u64> {
    if crate::process::Tracker::shared().is_running(id) {
        bail!("Close the profile first: a running browser keeps its cache open.");
    }
    let mut freed = 0;
    for dir in cache_dirs(&udd(id)?) {
        let bytes = size_of(&dir);
        fs::remove_dir_all(&dir).with_context(|| format!("empty {}", dir.display()))?;
        freed += bytes;
    }
    Ok(freed)
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
