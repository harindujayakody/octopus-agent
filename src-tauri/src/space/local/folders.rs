//! Folders kept while no profile is in them, and each folder's color and icon,
//! in `folders.json` beside the settings. A profile's own folder stays on it.

use crate::store;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

const VERSION: u32 = 1;

fn default_icon() -> String {
    "folder".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FolderMeta {
    /// A palette color id, or none.
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_icon")]
    pub icon: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FolderState {
    /// Folders kept even while empty, in the order they were made.
    #[serde(default)]
    pub registry: Vec<String>,
    /// Each folder's look, by name.
    #[serde(default)]
    pub meta: BTreeMap<String, FolderMeta>,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    version: u32,
    #[serde(flatten)]
    state: FolderState,
}

fn named(name: &str) -> Result<&str> {
    if name.trim().is_empty() {
        bail!("a folder needs a name");
    }
    Ok(name)
}

impl FolderState {
    fn add(&mut self, name: &str) -> Result<()> {
        let name = named(name)?;
        if !self.registry.iter().any(|f| f == name) {
            self.registry.push(name.to_string());
        }
        Ok(())
    }

    fn set_meta(&mut self, name: &str, meta: FolderMeta) -> Result<()> {
        self.meta.insert(named(name)?.to_string(), meta);
        Ok(())
    }

    /// A kept entry and the look move to the new name, as the profiles take
    /// it; a folder never kept stays unkept. An empty new name unfiles them.
    fn rename(&mut self, old: &str, new: &str) {
        let new = new.trim();
        if new.is_empty() {
            self.forget(old);
            return;
        }
        let mut registry = Vec::new();
        for f in self.registry.drain(..).map(|f| if f == old { new.to_string() } else { f }) {
            if !registry.contains(&f) {
                registry.push(f);
            }
        }
        self.registry = registry;
        if let Some(meta) = self.meta.remove(old) {
            self.meta.insert(new.to_string(), meta);
        }
    }

    fn forget(&mut self, name: &str) {
        self.registry.retain(|f| f != name);
        self.meta.remove(name);
    }

    /// What an import may keep: named folders, each once.
    fn tidy(mut self) -> Self {
        let mut registry: Vec<String> = Vec::new();
        for f in self.registry.drain(..) {
            if !f.trim().is_empty() && !registry.contains(&f) {
                registry.push(f);
            }
        }
        self.registry = registry;
        self.meta.retain(|name, _| !name.trim().is_empty());
        self
    }
}

/// Serialises writers: the API renames folders too.
static LOCK: Mutex<()> = Mutex::new(());

/// The saved folders, or None while nothing was ever saved.
fn read(path: &Path) -> Result<Option<FolderState>> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let stored: Stored =
        serde_json::from_slice(&raw).with_context(|| format!("{} is not readable as folders", path.display()))?;
    if stored.version > VERSION {
        bail!("{} was written by a newer launcher", path.display());
    }
    Ok(Some(stored.state))
}

fn write(path: &Path, state: &FolderState) -> Result<()> {
    let body = serde_json::to_vec_pretty(&Stored { version: VERSION, state: state.clone() })?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).with_context(|| format!("write {}", tmp.display()))?;
        f.write_all(&body)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("replace {}", path.display()))
}

/// A change that changes nothing writes nothing: no file is made before the import.
fn change_at(path: &Path, f: impl FnOnce(&mut FolderState) -> Result<()>) -> Result<()> {
    let before = read(path)?;
    let mut state = before.clone().unwrap_or_default();
    f(&mut state)?;
    if before.unwrap_or_default() == state {
        return Ok(());
    }
    write(path, &state)
}

fn change(f: impl FnOnce(&mut FolderState) -> Result<()>) -> Result<()> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    change_at(&store::folders_path()?, f)
}

fn import_at(path: &Path, state: FolderState) -> Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    write(path, &state.tidy())?;
    Ok(true)
}

pub(in crate::space) fn list() -> Result<FolderState> {
    Ok(read(&store::folders_path()?)?.unwrap_or_default())
}

pub(in crate::space) fn add(name: &str) -> Result<()> {
    change(|s| s.add(name))
}

pub(in crate::space) fn set_meta(name: &str, meta: FolderMeta) -> Result<()> {
    change(|s| s.set_meta(name, meta))
}

pub(in crate::space) fn rename(old: &str, new: &str) -> Result<()> {
    change(|s| {
        s.rename(old, new);
        Ok(())
    })
}

pub(in crate::space) fn forget(name: &str) -> Result<()> {
    change(|s| {
        s.forget(name);
        Ok(())
    })
}

/// Takes the interface's old copy only while nothing was ever saved here, so
/// a second import changes nothing. True when it was taken.
pub(in crate::space) fn import(state: FolderState) -> Result<bool> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    import_at(&store::folders_path()?, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn dir() -> Dir {
        let d = std::env::temp_dir().join(format!("shardx-folders-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&d).unwrap();
        Dir(d)
    }
    fn look(color: Option<&str>, icon: &str) -> FolderMeta {
        FolderMeta { color: color.map(String::from), icon: icon.into() }
    }

    #[test]
    fn folders_and_their_looks_round_trip_through_the_file() {
        let d = dir();
        let path = d.0.join("folders.json");
        assert_eq!(read(&path).unwrap(), None);
        change_at(&path, |s| {
            s.add("Empty1")?;
            s.add("Shops")?;
            s.add("Empty1")?;
            s.set_meta("Shops", look(Some("green"), "cart"))?;
            s.set_meta("Ads", look(None, "folder"))
        })
        .unwrap();
        let back = read(&path).unwrap().unwrap();
        assert_eq!(back.registry, ["Empty1", "Shops"]);
        assert_eq!(back.meta.get("Shops"), Some(&look(Some("green"), "cart")));
        assert_eq!(back.meta.get("Ads"), Some(&look(None, "folder")));
        assert!(change_at(&path, |s| s.add("  ")).is_err());
    }

    #[test]
    fn a_second_import_changes_nothing() {
        let d = dir();
        let path = d.0.join("folders.json");
        let first = FolderState {
            registry: vec!["Empty1".into(), "".into(), "Empty1".into()],
            meta: [("Shops".to_string(), look(Some("green"), "cart"))].into(),
        };
        assert!(import_at(&path, first).unwrap());
        let other = FolderState { registry: vec!["Other".into()], meta: BTreeMap::new() };
        assert!(!import_at(&path, other).unwrap());
        let back = read(&path).unwrap().unwrap();
        assert_eq!(back.registry, ["Empty1"]);
        assert_eq!(back.meta.len(), 1);
    }

    #[test]
    fn a_renamed_folder_keeps_its_place_and_its_look() {
        let mut s = FolderState::default();
        s.add("A").unwrap();
        s.add("B").unwrap();
        s.set_meta("A", look(Some("red"), "cart")).unwrap();
        s.rename("A", " C ");
        assert_eq!(s.registry, ["C", "B"]);
        assert_eq!(s.meta.get("C"), Some(&look(Some("red"), "cart")));
        assert!(!s.meta.contains_key("A"));
        // A folder that only its profiles held is not kept by a rename.
        s.rename("Held", "D");
        assert_eq!(s.registry, ["C", "B"]);
        // Onto a name that is there already: one entry.
        s.rename("C", "B");
        assert_eq!(s.registry, ["B"]);
        s.rename("B", "");
        assert!(s.registry.is_empty());
    }

    #[test]
    fn renaming_a_folder_never_kept_makes_no_file() {
        let d = dir();
        let path = d.0.join("folders.json");
        change_at(&path, |s| {
            s.rename("Ads", "Shops");
            Ok(())
        })
        .unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn forgetting_a_folder_never_kept_makes_no_file() {
        let d = dir();
        let path = d.0.join("folders.json");
        change_at(&path, |s| {
            s.forget("Ads");
            Ok(())
        })
        .unwrap();
        assert!(!path.exists());
        assert!(import_at(&path, FolderState { registry: vec!["Ads".into()], meta: BTreeMap::new() }).unwrap());
    }

    #[test]
    fn a_forgotten_folder_loses_its_look_too() {
        let mut s = FolderState::default();
        s.add("A").unwrap();
        s.set_meta("A", look(Some("red"), "folder")).unwrap();
        s.forget("A");
        assert_eq!(s, FolderState::default());
    }
}
