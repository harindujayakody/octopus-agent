//! This machine's values of a team project's secret step parameters. The team
//! keeps each one blank; the value stays here, in
//! `<local data>/team-secrets/<team>.json` (in no backup, never sent), and is
//! put back into the project for the editor and for runs started here.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde_json::Value;

use super::automation::Project;

/// Values by step id, then parameter name.
pub type Steps = BTreeMap<String, BTreeMap<String, Value>>;

/// Steps by project id.
type Kept = BTreeMap<String, Steps>;

const DIR: &str = "team-secrets";

/// Serialises writers: two saves never interleave.
static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn dir() -> Result<PathBuf> {
    Ok(crate::store::local_root()?.join(DIR))
}

fn path(team: &str) -> Result<PathBuf> {
    Ok(dir()?.join(format!("{}.json", super::open::safe(team))))
}

fn read(team: &str) -> Result<Kept> {
    let p = path(team)?;
    match fs::read(&p) {
        Ok(b) => serde_json::from_slice(&b).with_context(|| format!("{} is not readable", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Kept::new()),
        Err(e) => Err(e).with_context(|| format!("read {}", p.display())),
    }
}

/// Written whole, readable by this account only; none left once empty.
fn write(team: &str, kept: &Kept) -> Result<()> {
    let p = path(team)?;
    if kept.is_empty() {
        return match fs::remove_file(&p) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e).with_context(|| format!("remove {}", p.display())),
            _ => Ok(()),
        };
    }
    fs::create_dir_all(dir()?)?;
    let tmp = p.with_extension("json.tmp");
    let mut o = fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    {
        let mut f = o.open(&tmp).with_context(|| format!("write {}", tmp.display()))?;
        f.write_all(&serde_json::to_vec(kept)?)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, &p).with_context(|| format!("replace {}", p.display()))
}

fn blank(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        _ => false,
    }
}

/// The values `p` marks secret, taken out of it and blanked there, as an export blanks them.
pub fn take(p: &mut Project) -> Steps {
    let mut steps = Steps::new();
    for b in &mut p.blocks {
        let Value::Object(map) = &mut b.params else { continue };
        let mut vals = BTreeMap::new();
        for name in &b.secrets {
            if let Some(slot) = map.get_mut(name) {
                let v = std::mem::replace(slot, Value::String(String::new()));
                if !blank(&v) {
                    vals.insert(name.clone(), v);
                }
            }
        }
        if !vals.is_empty() {
            steps.insert(b.id.clone(), vals);
        }
    }
    steps
}

/// Keep `steps` as the project's values on this machine; what it no longer has goes.
pub fn keep(team: &str, project_id: &str, steps: Steps) -> Result<()> {
    let _g = lock();
    let mut kept = read(team)?;
    let had = kept.get(project_id) == Some(&steps) || (steps.is_empty() && !kept.contains_key(project_id));
    if had {
        return Ok(());
    }
    if steps.is_empty() {
        kept.remove(project_id);
    } else {
        kept.insert(project_id.to_string(), steps);
    }
    write(team, &kept)
}

/// The values kept here, put back where the project's steps still mark them secret.
pub fn fill(team: &str, projects: &mut [Project]) {
    let kept = {
        let _g = lock();
        read(team)
    };
    let kept = match kept {
        Ok(k) => k,
        Err(e) => {
            eprintln!("[launcher] team {team}: secret values not read: {e:#}");
            return;
        }
    };
    for p in projects {
        let Some(steps) = kept.get(&p.id) else { continue };
        for b in &mut p.blocks {
            let Some(vals) = steps.get(&b.id) else { continue };
            let Value::Object(map) = &mut b.params else { continue };
            for name in &b.secrets {
                if let Some(v) = vals.get(name) {
                    map.insert(name.clone(), v.clone());
                }
            }
        }
    }
}

/// The project went: its values go too.
pub fn drop_project(team: &str, project_id: &str) {
    let _g = lock();
    let done = read(team).and_then(|mut kept| match kept.remove(project_id) {
        Some(_) => write(team, &kept),
        None => Ok(()),
    });
    if let Err(e) = done {
        eprintln!("[launcher] team {team}: secret values of {project_id} not removed: {e:#}");
    }
}

/// The team was left or withdrew this member: its values go.
pub fn forget(team: &str) {
    let _g = lock();
    if let Err(e) = write(team, &Kept::new()) {
        eprintln!("[launcher] team {team}: secret values not removed: {e:#}");
    }
}

/// Delete all data: every team's values.
pub fn forget_all() -> Result<()> {
    let _g = lock();
    let d = dir()?;
    match fs::remove_dir_all(&d) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e).with_context(|| format!("remove {}", d.display())),
        _ => Ok(()),
    }
}

#[cfg(test)]
pub fn kept_file(team: &str) -> PathBuf {
    path(team).unwrap()
}
