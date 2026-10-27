//! The library's extensions on every Chromium-family profile's toolbar: each
//! one is pinned the first time a profile starts with it, so one the person
//! unpins later stays where they put it.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Ids this launcher already pinned in a profile, one per line, beside its data.
const PINNED: &str = ".octopus-pinned";

/// Pins in `<dir>/Default/Preferences` the extensions at `roots` this profile
/// has not had pinned yet. Before the browser starts; a Preferences that does
/// not read is left as it is.
pub fn pin_new(dir: &Path, roots: &[PathBuf]) {
    if roots.is_empty() {
        return;
    }
    let done: BTreeSet<String> = std::fs::read_to_string(dir.join(PINNED))
        .map(|t| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect())
        .unwrap_or_default();
    let new: Vec<String> = roots
        .iter()
        .filter_map(|r| crate::space::extensions::chrome_id(r))
        .filter(|id| !done.contains(id))
        .collect();
    if new.is_empty() {
        return;
    }
    if let Err(e) = write_pins(dir, &new) {
        eprintln!("[extensions] not pinned in {}: {e:#}", dir.display());
        return;
    }
    let all: Vec<String> = done.into_iter().chain(new).collect();
    let _ = std::fs::write(dir.join(PINNED), all.join("\n") + "\n");
}

fn write_pins(dir: &Path, ids: &[String]) -> anyhow::Result<()> {
    let file = dir.join("Default").join("Preferences");
    let mut prefs: serde_json::Value = match std::fs::read_to_string(&file) {
        Ok(text) => serde_json::from_str(&text)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e.into()),
    };
    let root = prefs.as_object_mut().ok_or_else(|| anyhow::anyhow!("Preferences is not an object"))?;
    let ext = root.entry("extensions").or_insert_with(|| serde_json::json!({}));
    let ext = ext.as_object_mut().ok_or_else(|| anyhow::anyhow!("extensions is not an object"))?;
    let pinned = ext.entry("pinned_extensions").or_insert_with(|| serde_json::json!([]));
    let list = pinned.as_array_mut().ok_or_else(|| anyhow::anyhow!("pinned_extensions is not a list"))?;
    for id in ids {
        if !list.iter().any(|v| v.as_str() == Some(id)) {
            list.push(serde_json::Value::String(id.clone()));
        }
    }
    std::fs::create_dir_all(file.parent().unwrap_or(dir))?;
    std::fs::write(&file, serde_json::to_vec(&prefs)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_once_and_keeps_what_was_there() {
        let dir = std::env::temp_dir().join(format!("octopus-pin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Default")).unwrap();
        std::fs::write(dir.join("Default/Preferences"), r#"{"extensions":{"pinned_extensions":["mine"]},"x":1}"#).unwrap();
        write_pins(&dir, &["a".into(), "mine".into()]).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("Default/Preferences")).unwrap()).unwrap();
        assert_eq!(v["extensions"]["pinned_extensions"], serde_json::json!(["mine", "a"]));
        assert_eq!(v["x"], 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
