//! A profile in one file, to keep or to move to another computer: its
//! settings and its whole browser folder (cookies, logins, history, site
//! storage, extensions' data, for every browser it ran in), caches left out.
//! Restoring brings it back with the same id, or as a copy when that id is
//! still here. Personal profiles only; the profile must be closed, since a
//! running browser holds its cookie and login files open.

use crate::space::profile::{self, ProfileMeta, SaveOpts, StoredProfile};
use crate::store;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// The backup's own note, first in the archive, so a stray zip is told apart.
const MANIFEST: &str = "octopus-backup.json";
const FORMAT: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Manifest {
    format: u32,
    app: String,
    app_version: String,
    /// Unix seconds.
    created: u64,
    id: String,
    name: String,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn add_dir<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    src: &Path,
    prefix: &str,
    skip: &[PathBuf],
    opts: zip::write::SimpleFileOptions,
) -> Result<()> {
    let Ok(rd) = fs::read_dir(src) else { return Ok(()) };
    for entry in rd.flatten() {
        let path = entry.path();
        if store::is_os_litter(&entry.file_name()) || skip.contains(&path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // The browser's single-instance locks name a process that is gone.
        if name.starts_with("Singleton") || name == "lockfile" || name == "parent.lock" {
            continue;
        }
        let child = format!("{prefix}/{name}");
        match entry.file_type() {
            Ok(t) if t.is_dir() => add_dir(zip, &path, &child, skip, opts)?,
            Ok(t) if t.is_file() => {
                let bytes = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
                zip.start_file(&child, opts)?;
                zip.write_all(&bytes)?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn personal() -> Result<()> {
    if crate::team::active_team().is_some() {
        bail!("Backups are for profiles in your own space. Switch to Personal to back up or restore.");
    }
    Ok(())
}

/// Writes the profile to `dest`; returns the backup's size in bytes.
pub fn backup(id: &str, dest: &Path) -> Result<u64> {
    personal()?;
    if crate::process::Tracker::shared().is_running(id) {
        bail!("Close the profile first: a running browser holds its cookies and logins open.");
    }
    let stored = profile::load_raw(id)?;
    if stored.meta.temporary {
        bail!("A temporary profile can't be backed up.");
    }
    let name = stored.config.get("name").and_then(|v| v.as_str()).unwrap_or("(unnamed)").to_string();
    let udd = store::user_data_root()?.join(id);

    // Written beside the target first, so a failed backup never leaves half a file under its name.
    let partial = dest.with_extension("partial");
    let file = fs::File::create(&partial).with_context(|| format!("create {}", partial.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    let written = (|| -> Result<()> {
        let manifest = Manifest {
            format: FORMAT,
            app: "Octopus Agent".into(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            created: now(),
            id: id.to_string(),
            name: name.clone(),
        };
        zip.start_file(MANIFEST, opts)?;
        zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
        zip.start_file("profile.json", opts)?;
        zip.write_all(serde_json::to_string_pretty(&stored)?.as_bytes())?;
        if udd.is_dir() {
            add_dir(&mut zip, &udd, "user-data", &crate::profile_cache::cache_dirs(&udd), opts)?;
        }
        zip.finish()?;
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&partial);
        return Err(e);
    }
    let _ = fs::remove_file(dest);
    fs::rename(&partial, dest).with_context(|| format!("write {}", dest.display()))?;
    Ok(fs::metadata(dest).map(|m| m.len()).unwrap_or(0))
}

/// Brings a backup back: under its own id when that is free, else as a copy
/// with a new id and "(restored)" after its name.
pub fn restore(src: &Path) -> Result<ProfileMeta> {
    personal()?;
    let file = fs::File::open(src).with_context(|| format!("open {}", src.display()))?;
    let mut zip = zip::ZipArchive::new(file).context("This file is not an Octopus Agent profile backup.")?;
    let manifest: Manifest = {
        let mut f = zip.by_name(MANIFEST).context("This file is not an Octopus Agent profile backup.")?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        serde_json::from_str(&s).context("This backup's description can't be read.")?
    };
    if manifest.format > FORMAT {
        bail!("This backup was made by a newer Octopus Agent ({}). Update this one to restore it.", manifest.app_version);
    }
    let mut stored: StoredProfile = {
        let mut f = zip.by_name("profile.json").context("This backup holds no profile.")?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        serde_json::from_str(&s).context("This backup's profile can't be read.")?
    };

    let taken = stored.meta.id.trim().is_empty() || profile::in_active_space(&stored.meta.id);
    if taken {
        stored.meta.id = uuid::Uuid::new_v4().to_string();
        let name = stored.config.get("name").and_then(|v| v.as_str()).unwrap_or("(unnamed)").to_string();
        stored.config.insert("name".into(), serde_json::Value::String(format!("{name} (restored)")));
    }
    stored.meta.pinned = false;
    stored.meta.temporary = false;
    let id = stored.meta.id.clone();
    let udd = store::user_data_root()?.join(&id);
    if udd.exists() {
        fs::remove_dir_all(&udd).with_context(|| format!("clear {}", udd.display()))?;
    }

    let unpacked = (|| -> Result<()> {
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            if f.is_dir() {
                continue;
            }
            let Some(rel) = f.enclosed_name() else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let Some(sub) = rel.strip_prefix("user-data/") else { continue };
            let out = udd.join(sub);
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut w = fs::File::create(&out).with_context(|| format!("write {}", out.display()))?;
            std::io::copy(&mut f, &mut w)?;
        }
        Ok(())
    })();
    if let Err(e) = unpacked {
        let _ = fs::remove_dir_all(&udd);
        return Err(e);
    }
    match profile::save_here(stored, SaveOpts::default()) {
        Ok(row) => Ok(row),
        Err(e) => {
            let _ = fs::remove_dir_all(&udd);
            Err(e)
        }
    }
}

/// Backs the profile up to the file the person chose.
#[tauri::command]
pub async fn profile_backup(id: String, path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || backup(&id, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

/// Restores a profile from a backup file; returns its row.
#[tauri::command]
pub async fn profile_restore(path: String) -> Result<ProfileMeta, String> {
    tokio::task::spawn_blocking(move || restore(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
