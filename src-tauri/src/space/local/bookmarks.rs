//! Folder-scoped bookmarks, written into the profile's `Bookmarks` just before
//! launch, inside a folder tagged as ours so the operator's own are untouched.

use crate::store;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

/// Marker on the managed folder node. Anything carrying it is ours to replace.
const MANAGED_KEY: &str = "shardx_managed";
/// What the managed folder is called inside the browser.
const MANAGED_FOLDER: &str = "Octopus Agent";
/// Its name before the rename to Octopus Agent. Builds that old may have
/// written it without the marker, so the name alone still makes it ours; the
/// new name never does, because every folder this build writes carries the
/// marker, and a folder the person made and called "Octopus Agent" is theirs.
const LEGACY_MANAGED_FOLDER: &str = "ShardX";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    #[serde(default)]
    pub id: String,
    pub title: String,
    pub url: String,
    /// Launcher folder this belongs to; empty means every profile.
    #[serde(default)]
    pub folder: String,
    /// The bookmark set it is in ("Facebook", "Pinterest"…); a profile takes
    /// the sets it picks. Empty: in no set, so every profile its folder reaches.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub set: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct BookmarkStore {
    #[serde(default)]
    bookmarks: Vec<Bookmark>,
}

fn load_store() -> Result<BookmarkStore> {
    let path = store::bookmarks_path()?;
    if !path.exists() {
        return Ok(BookmarkStore::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default())
}

fn save_store(s: &BookmarkStore) -> Result<()> {
    fs::write(store::bookmarks_path()?, serde_json::to_string_pretty(s)?)?;
    Ok(())
}

pub(in crate::space) fn list() -> Result<Vec<Bookmark>> {
    Ok(load_store()?.bookmarks)
}

/// Insert or update by id; a blank id mints one.
pub(in crate::space) fn save(b: Bookmark) -> Result<Bookmark> {
    let mut b = cleaned(b)?;
    let mut s = load_store()?;
    if b.id.is_empty() {
        b.id = uuid::Uuid::new_v4().to_string();
        s.bookmarks.push(b.clone());
    } else if let Some(slot) = s.bookmarks.iter_mut().find(|x| x.id == b.id) {
        *slot = b.clone();
    } else {
        s.bookmarks.push(b.clone());
    }
    save_store(&s)?;
    Ok(b)
}

/// Trimmed, the address made whole, the title the address when blank.
pub(in crate::space) fn cleaned(mut b: Bookmark) -> Result<Bookmark> {
    b.title = b.title.trim().to_string();
    b.url = normalise_url(&b.url);
    b.folder = b.folder.trim().to_string();
    b.set = b.set.trim().to_string();
    if b.url.is_empty() {
        anyhow::bail!("a bookmark needs a URL");
    }
    if b.title.is_empty() {
        b.title = b.url.clone();
    }
    Ok(b)
}

pub(in crate::space) fn delete(id: &str) -> Result<()> {
    let mut s = load_store()?;
    s.bookmarks.retain(|b| b.id != id);
    save_store(&s)
}

fn normalise_url(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() || t.contains("://") {
        return t.to_string();
    }
    format!("https://{t}")
}

/// Chromium timestamps are microseconds since 1601-01-01.
fn chrome_now() -> String {
    let unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    ((unix + 11_644_473_600) * 1_000_000).to_string()
}

fn empty_tree() -> Value {
    let ts = chrome_now();
    let root = |id: &str, name: &str| {
        json!({
            "children": [], "date_added": ts, "date_modified": ts,
            "guid": uuid::Uuid::new_v4().to_string(),
            "id": id, "name": name, "type": "folder"
        })
    };
    json!({
        "checksum": "",
        "roots": {
            "bookmark_bar": root("1", "Bookmarks bar"),
            "other": root("2", "Other bookmarks"),
            "synced": root("3", "Mobile bookmarks"),
        },
        "version": 1
    })
}

fn max_id(node: &Value, cur: &mut u64) {
    if let Some(id) = node.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()) {
        *cur = (*cur).max(id);
    }
    if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
        for c in children {
            max_id(c, cur);
        }
    }
}

/// Rewrite `<udd>/Default/Bookmarks` so it carries exactly the bookmarks of
/// `all` this launcher folder defines, leaving everything the operator added untouched.
pub(in crate::space) fn apply_to_profile(udd: &Path, folder: &str, sets: &[String], all: &[Bookmark]) -> Result<usize> {
    let wanted: Vec<&Bookmark> = all
        .iter()
        .filter(|b| (b.folder.is_empty() || b.folder == folder) && (b.set.is_empty() || sets.iter().any(|s| s == &b.set)))
        .collect();

    let default_dir = udd.join("Default");
    let path = default_dir.join("Bookmarks");
    let existing = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());

    // Nothing to add and nothing of ours to clean out — leave the file alone
    // rather than rewriting a profile that never had managed bookmarks.
    if wanted.is_empty() && existing.is_none() {
        return Ok(0);
    }
    let mut tree = existing.unwrap_or_else(empty_tree);

    // Highest id in use, before anything is borrowed mutably.
    let mut next_id = 0u64;
    max_id(&tree, &mut next_id);

    let Some(bar) = tree
        .get_mut("roots")
        .and_then(|r| r.get_mut("bookmark_bar"))
        .and_then(|b| b.as_object_mut())
    else {
        return Ok(0);
    };
    let Some(list) = bar
        .entry("children")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
    else {
        return Ok(0);
    };

    let had_ours = list.iter().any(is_managed);
    list.retain(|n| !is_managed(n));
    if wanted.is_empty() && !had_ours {
        return Ok(0);
    }
    if !wanted.is_empty() {
        let ts = chrome_now();
        let mut kids = Vec::with_capacity(wanted.len());
        for b in &wanted {
            next_id += 1;
            kids.push(json!({
                "date_added": ts,
                "guid": uuid::Uuid::new_v4().to_string(),
                "id": next_id.to_string(),
                "name": b.title,
                "type": "url",
                "url": b.url,
            }));
        }
        next_id += 1;
        list.insert(
            0,
            json!({
                "children": kids,
                "date_added": ts, "date_modified": ts,
                "guid": uuid::Uuid::new_v4().to_string(),
                "id": next_id.to_string(),
                "name": MANAGED_FOLDER,
                "type": "folder",
                "meta_info": { MANAGED_KEY: "1" },
            }),
        );
    }

    // The checksum no longer matches. Chromium notices, keeps the bookmarks and
    // rewrites the file itself — blanking it is how we say "recompute".
    tree["checksum"] = json!("");

    fs::create_dir_all(&default_dir)?;
    fs::write(&path, serde_json::to_string(&tree)?)?;
    Ok(wanted.len())
}

fn is_managed(node: &Value) -> bool {
    node.get("meta_info")
        .and_then(|m| m.get(MANAGED_KEY))
        .is_some()
        || node.get("name").and_then(|v| v.as_str()) == Some(LEGACY_MANAGED_FOLDER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_managed_folder_is_ours_under_its_new_name_its_old_one_or_its_marker() {
        // Written by this build.
        assert!(is_managed(&json!({ "name": MANAGED_FOLDER, "type": "folder", "meta_info": { MANAGED_KEY: "1" } })));
        // The person's own folder that happens to share the new name stays.
        assert!(!is_managed(&json!({ "name": "Octopus Agent", "type": "folder" })));
        // Written before the rename: replaced, so a profile never shows both.
        assert!(is_managed(&json!({ "name": "ShardX", "type": "folder" })));
        // Renamed by the person: the marker still says it is ours.
        assert!(is_managed(&json!({ "name": "Work", "type": "folder", "meta_info": { MANAGED_KEY: "1" } })));
        // The person's own folder stays.
        assert!(!is_managed(&json!({ "name": "Work", "type": "folder" })));
    }
}
