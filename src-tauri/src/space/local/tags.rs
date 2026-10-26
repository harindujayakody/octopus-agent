//! Tags and which profiles carry them, in `tags.json` beside the settings.
//! `import` takes the copy the interface kept before, once, while there is no file.

use crate::store;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

const VERSION: u32 = 1;
/// Longest tag name, as the interface cuts it.
const NAME_MAX: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tag {
    /// A blank id gets a new one.
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// A palette color id: "blue", "violet" and so on.
    pub color: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TagState {
    /// In the order the list shows them.
    #[serde(default)]
    pub tags: Vec<Tag>,
    /// Tag ids by profile id. A profile with none is left out.
    #[serde(default)]
    pub by_profile: BTreeMap<String, Vec<String>>,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    version: u32,
    #[serde(flatten)]
    state: TagState,
}

/// Trimmed, inner runs of whitespace as one space, at most `NAME_MAX` characters.
fn clean(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(NAME_MAX).collect()
}

fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

impl TagState {
    /// Adds the tag, or changes the one with its id. A new tag goes at `at`
    /// when given (an undone delete), else last.
    pub(in crate::space) fn upsert(&mut self, tag: Tag, at: Option<usize>) -> Result<Tag> {
        let name = clean(&tag.name);
        if name.is_empty() {
            bail!("a tag needs a name");
        }
        if tag.color.trim().is_empty() {
            bail!("a tag needs a color");
        }
        if self.named(&name, &tag.id).is_some() {
            bail!("a tag named {name} already exists");
        }
        let id = if tag.id.trim().is_empty() {
            format!("t-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
        } else {
            tag.id
        };
        let tag = Tag { id, name, color: tag.color.trim().to_string() };
        match self.tags.iter_mut().find(|t| t.id == tag.id) {
            Some(slot) => *slot = tag.clone(),
            None => {
                let at = at.unwrap_or(self.tags.len()).min(self.tags.len());
                self.tags.insert(at, tag.clone());
            }
        }
        Ok(tag)
    }

    /// Another tag than `id` with this name, as names are told apart here.
    pub(in crate::space) fn named(&self, name: &str, id: &str) -> Option<&Tag> {
        let name = clean(name);
        self.tags.iter().find(|t| t.id != id && same(&t.name, &name))
    }

    /// Deletes the tag and takes it off every profile.
    fn remove(&mut self, id: &str) {
        self.tags.retain(|t| t.id != id);
        for ids in self.by_profile.values_mut() {
            ids.retain(|x| x != id);
        }
        self.by_profile.retain(|_, ids| !ids.is_empty());
    }

    /// Gives each profile exactly the tags listed for it: known ids, once each.
    fn assign(&mut self, changes: BTreeMap<String, Vec<String>>) {
        let known: HashSet<&str> = self.tags.iter().map(|t| t.id.as_str()).collect();
        let mut kept = Vec::new();
        for (profile, ids) in changes {
            let mut seen = HashSet::new();
            let ids: Vec<String> =
                ids.into_iter().filter(|id| known.contains(id.as_str()) && seen.insert(id.clone())).collect();
            kept.push((profile, ids));
        }
        for (profile, ids) in kept {
            if ids.is_empty() {
                self.by_profile.remove(&profile);
            } else {
                self.by_profile.insert(profile, ids);
            }
        }
    }

    /// What an import may keep: tags with an id, a name and a color, each id
    /// once, and only those ids on the profiles.
    fn tidy(mut self) -> Self {
        let mut ids = HashSet::new();
        self.tags.retain(|t| {
            !t.id.trim().is_empty() && !t.name.trim().is_empty() && !t.color.trim().is_empty() && ids.insert(t.id.clone())
        });
        let by_profile = std::mem::take(&mut self.by_profile);
        self.assign(by_profile);
        self
    }
}

/// Serialises writers: two windows, or a window and the API, never interleave.
static LOCK: Mutex<()> = Mutex::new(());

/// The saved tags, or None while nothing was ever saved.
fn read(path: &Path) -> Result<Option<TagState>> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let stored: Stored =
        serde_json::from_slice(&raw).with_context(|| format!("{} is not readable as tags", path.display()))?;
    if stored.version > VERSION {
        bail!("{} was written by a newer launcher", path.display());
    }
    Ok(Some(stored.state))
}

fn write(path: &Path, state: &TagState) -> Result<()> {
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
fn change_at<T>(path: &Path, f: impl FnOnce(&mut TagState) -> Result<T>) -> Result<T> {
    let before = read(path)?;
    let mut state = before.clone().unwrap_or_default();
    let out = f(&mut state)?;
    if before.unwrap_or_default() != state {
        write(path, &state)?;
    }
    Ok(out)
}

fn change<T>(f: impl FnOnce(&mut TagState) -> Result<T>) -> Result<T> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    change_at(&store::tags_path()?, f)
}

fn import_at(path: &Path, state: TagState) -> Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    write(path, &state.tidy())?;
    Ok(true)
}

pub(in crate::space) fn list() -> Result<TagState> {
    Ok(read(&store::tags_path()?)?.unwrap_or_default())
}

pub(in crate::space) fn save(tag: Tag, at: Option<usize>) -> Result<Tag> {
    change(|s| s.upsert(tag, at))
}

pub(in crate::space) fn delete(id: &str) -> Result<()> {
    change(|s| {
        s.remove(id);
        Ok(())
    })
}

pub(in crate::space) fn assign(changes: BTreeMap<String, Vec<String>>) -> Result<()> {
    change(|s| {
        s.assign(changes);
        Ok(())
    })
}

/// Takes the interface's old copy only while nothing was ever saved here, so
/// a second import changes nothing. True when it was taken.
pub(in crate::space) fn import(state: TagState) -> Result<bool> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    import_at(&store::tags_path()?, state)
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
        let d = std::env::temp_dir().join(format!("shardx-tags-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&d).unwrap();
        Dir(d)
    }
    fn tag(id: &str, name: &str, color: &str) -> Tag {
        Tag { id: id.into(), name: name.into(), color: color.into() }
    }
    fn on(pairs: &[(&str, &[&str])]) -> BTreeMap<String, Vec<String>> {
        pairs.iter().map(|(p, ids)| (p.to_string(), ids.iter().map(|s| s.to_string()).collect())).collect()
    }

    #[test]
    fn tags_and_their_profiles_round_trip_through_the_file() {
        let d = dir();
        let path = d.0.join("tags.json");
        assert_eq!(read(&path).unwrap(), None);
        change_at(&path, |s| {
            s.upsert(tag("t-vip", "VIP", "violet"), None)?;
            s.upsert(tag("t-warm", "Warm-up", "orange"), None)?;
            s.assign(on(&[("p1", &["t-vip", "t-warm"]), ("p2", &["t-warm"])]));
            Ok(())
        })
        .unwrap();
        let back = read(&path).unwrap().unwrap();
        assert_eq!(back.tags, vec![tag("t-vip", "VIP", "violet"), tag("t-warm", "Warm-up", "orange")]);
        assert_eq!(back.by_profile, on(&[("p1", &["t-vip", "t-warm"]), ("p2", &["t-warm"])]));
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["version"], 1);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn a_second_import_changes_nothing() {
        let d = dir();
        let path = d.0.join("tags.json");
        let first = TagState { tags: vec![tag("t-a", "A", "blue")], by_profile: on(&[("p1", &["t-a"])]) };
        assert!(import_at(&path, first.clone()).unwrap());
        let other = TagState { tags: vec![tag("t-b", "B", "red")], by_profile: BTreeMap::new() };
        assert!(!import_at(&path, other.clone()).unwrap());
        assert_eq!(read(&path).unwrap().unwrap(), first);

        // Nor after the tags were changed here first.
        let d2 = dir();
        let path2 = d2.0.join("tags.json");
        change_at(&path2, |s| s.upsert(tag("t-c", "C", "green"), None).map(|_| ())).unwrap();
        assert!(!import_at(&path2, other).unwrap());
        assert_eq!(read(&path2).unwrap().unwrap().tags, vec![tag("t-c", "C", "green")]);
    }

    #[test]
    fn an_import_keeps_only_what_holds_together() {
        let d = dir();
        let path = d.0.join("tags.json");
        let messy = TagState {
            tags: vec![tag("t-a", "A", "blue"), tag("t-a", "A again", "red"), tag("", "No id", "red")],
            by_profile: on(&[("p1", &["t-a", "t-gone", "t-a"]), ("p2", &["t-gone"])]),
        };
        assert!(import_at(&path, messy).unwrap());
        let back = read(&path).unwrap().unwrap();
        assert_eq!(back.tags, vec![tag("t-a", "A", "blue")]);
        assert_eq!(back.by_profile, on(&[("p1", &["t-a"])]));
    }

    #[test]
    fn a_name_is_cleaned_and_no_two_tags_share_one() {
        let mut s = TagState::default();
        let made = s.upsert(tag("", "  VIP   club ", "violet"), None).unwrap();
        assert_eq!(made.name, "VIP club");
        assert!(made.id.starts_with("t-"));
        assert!(s.upsert(tag("t-other", "vip CLUB", "red"), None).is_err());
        assert!(s.upsert(tag("t-other", "   ", "red"), None).is_err());
        // Renaming a tag to its own name in another case is fine.
        assert_eq!(s.upsert(tag(&made.id, "Vip Club", "blue"), None).unwrap().name, "Vip Club");
        assert_eq!(s.tags.len(), 1);
        assert_eq!(clean(&"x".repeat(40)).len(), NAME_MAX);
    }

    #[test]
    fn a_deleted_tag_leaves_every_profile_and_comes_back_in_its_place() {
        let mut s = TagState::default();
        for (id, name) in [("t-a", "A"), ("t-b", "B"), ("t-c", "C")] {
            s.upsert(tag(id, name, "blue"), None).unwrap();
        }
        s.assign(on(&[("p1", &["t-b"]), ("p2", &["t-a", "t-b"])]));
        s.remove("t-b");
        assert_eq!(s.tags.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t-a", "t-c"]);
        assert_eq!(s.by_profile, on(&[("p2", &["t-a"])]));
        s.upsert(tag("t-b", "B", "blue"), Some(1)).unwrap();
        assert_eq!(s.tags.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t-a", "t-b", "t-c"]);
    }

    #[test]
    fn assigning_keeps_known_tags_once_and_an_empty_list_clears() {
        let mut s = TagState::default();
        s.upsert(tag("t-a", "A", "blue"), None).unwrap();
        s.assign(on(&[("p1", &["t-a", "t-gone", "t-a"]), ("p2", &["t-a"])]));
        assert_eq!(s.by_profile, on(&[("p1", &["t-a"]), ("p2", &["t-a"])]));
        s.assign(on(&[("p1", &[])]));
        assert_eq!(s.by_profile, on(&[("p2", &["t-a"])]));
    }

    #[test]
    fn a_change_that_changes_nothing_makes_no_file() {
        let d = dir();
        let path = d.0.join("tags.json");
        change_at(&path, |s| {
            s.assign(on(&[("p1", &[])]));
            s.remove("t-none");
            Ok(())
        })
        .unwrap();
        assert!(!path.exists());
        assert!(import_at(&path, TagState { tags: vec![tag("t-a", "A", "blue")], by_profile: BTreeMap::new() }).unwrap());
    }

    #[test]
    fn an_unreadable_file_is_an_error_and_stays_as_it_was() {
        let d = dir();
        let path = d.0.join("tags.json");
        fs::write(&path, "{not json").unwrap();
        assert!(read(&path).is_err());
        assert!(change_at(&path, |s| s.upsert(tag("t-a", "A", "blue"), None)).is_err());
        assert!(!import_at(&path, TagState::default()).unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{not json");
    }
}
