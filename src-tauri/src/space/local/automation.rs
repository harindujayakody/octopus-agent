//! Automation projects: the blocks an operator recorded, and their run
//! settings. Storage only — running them lives elsewhere.
//!
//! Storage compiles unconditionally — it is a few hundred lines and Tauri
//! takes only one command list, so cfg-ing it out would mean maintaining two
//! copies of a two-hundred-entry macro. The `automation` feature gates what
//! actually costs something: the section in the UI, and later the CDP client
//! and the WASM runtime.

use crate::store;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// One recorded step. `kind` and `params` are deliberately open: the block
/// palette grows without a storage migration, and a WASM module can add a kind
/// this build has never heard of.
/// What to do when a step does not work out.
///
/// A flat list cannot express a real script: half of what an operator writes is
/// "and if this is not there, do that instead". Every step therefore carries
/// its own branch, and the runner follows it rather than always falling to the
/// next line.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Branch {
    /// Fall through to the step below. The default.
    Next,
    /// End this profile's whole run.
    Stop,
    /// End this pass; the next one starts from the top.
    EndPass,
    /// Jump to a step by id. An id that no longer exists behaves as Next, so
    /// deleting a step cannot strand the run.
    Goto(String),
    /// Try this same step again, up to `0` more times, then take Next.
    Retry(u32),
}

impl Default for Branch {
    fn default() -> Self {
        Branch::Next
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Where the block sits on the canvas. Layout only — the run follows the
    /// connections, never the coordinates.
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Where to go when the step succeeds.
    #[serde(default)]
    pub on_done: Branch,
    /// Parameter names whose values must never leave this machine. Emptied on
    /// export and asked for again on import, because a project shared with a
    /// password still in it is a password published.
    #[serde(default)]
    pub secrets: Vec<String>,
    /// Where to go when it fails. Defaults to stopping, because silently
    /// carrying on after a click that found nothing is how a run ends up
    /// typing a password into the wrong page.
    #[serde(default = "stop_branch")]
    pub on_fail: Branch,
}

fn stop_branch() -> Branch {
    Branch::Stop
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSettings {
    /// Browsers running at once.
    #[serde(default = "one")]
    pub threads: u32,
    /// Passes over the block list. 0 means run until `hours` is up.
    #[serde(default = "one")]
    pub loops: u32,
    /// Only meaningful when `loops` is 0.
    #[serde(default)]
    pub hours: f64,
    /// Kept for projects saved before profiles became blocks; ignored.
    #[serde(default)]
    pub profiles: Vec<String>,
    /// Which block the run starts at. Empty means the first in the list, which
    /// is what a project built before the canvas expects.
    #[serde(default)]
    pub start: String,
}

fn one() -> u32 {
    1
}

impl Default for RunSettings {
    fn default() -> Self {
        Self { threads: 1, loops: 1, hours: 0.0, profiles: Vec::new(), start: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub blocks: Vec<Block>,
    #[serde(default)]
    pub run: RunSettings,
    /// Request-interception rules mounted (profile-scoped) before the first
    /// navigation of every profile this project drives. Each entry is a rule in
    /// the Traffic domain's JSON format; the launcher never interprets them, it
    /// hands the array to Traffic.mount.
    #[serde(default)]
    pub rules: Vec<Value>,
    /// Unix seconds.
    pub created_at: u64,
    pub updated_at: u64,
    /// A team's revision of it, as read; a save from an older one is stale. None here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Db {
    #[serde(default)]
    projects: Vec<Project>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Serialises writers, so two windows saving at once cannot interleave.
fn lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

fn write_atomic(path: &Path, body: &[u8]) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(body)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("rename {}", path.display()))?;
    Ok(())
}

fn read_db() -> Result<Db> {
    let path = store::automation_path()?;
    if !path.exists() {
        return Ok(Db::default());
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(Db::default());
    }
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write_db(db: &Db) -> Result<()> {
    write_atomic(&store::automation_path()?, serde_json::to_vec_pretty(db)?.as_slice())
}

pub(in crate::space) fn list() -> Result<Vec<Project>> {
    Ok(read_db()?.projects)
}

pub(in crate::space) fn create(name: &str) -> Result<Project> {
    let _g = lock().lock().unwrap();
    let mut db = read_db()?;
    let project = new_project(name);
    db.projects.push(project.clone());
    write_db(&db)?;
    Ok(project)
}

/// A project with nothing in it yet, under a new id.
pub(in crate::space) fn new_project(name: &str) -> Project {
    let t = now();
    Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: if name.trim().is_empty() { "Untitled".into() } else { name.trim().into() },
        notes: String::new(),
        blocks: Vec::new(),
        run: RunSettings::default(),
        rules: Vec::new(),
        created_at: t,
        updated_at: t,
        revision: None,
    }
}

/// Two steps with one id are one step to every branch that names it: the
/// first keeps the id, a later one gets a fresh id of its own.
pub(in crate::space) fn unique_block_ids(project: &mut Project) {
    let mut seen = std::collections::HashSet::new();
    for b in &mut project.blocks {
        if b.id.is_empty() || !seen.insert(b.id.clone()) {
            b.id = uuid::Uuid::new_v4().to_string();
            seen.insert(b.id.clone());
        }
    }
}

pub(in crate::space) fn save(mut project: Project) -> Result<Project> {
    let _g = lock().lock().unwrap();
    let mut db = read_db()?;
    project.updated_at = now();
    project.revision = None;
    unique_block_ids(&mut project);
    match db.projects.iter_mut().find(|p| p.id == project.id) {
        Some(slot) => *slot = project.clone(),
        None => db.projects.push(project.clone()),
    }
    write_db(&db)?;
    Ok(project)
}

pub(in crate::space) fn delete(id: &str) -> Result<()> {
    let _g = lock().lock().unwrap();
    let mut db = read_db()?;
    db.projects.retain(|p| p.id != id);
    write_db(&db)
}

pub(in crate::space) fn duplicate(id: &str) -> Result<Project> {
    let _g = lock().lock().unwrap();
    let mut db = read_db()?;
    let src = db
        .projects
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .context("no such project")?;
    let copy = copy_of(src);
    db.projects.push(copy.clone());
    write_db(&db)?;
    Ok(copy)
}

/// A copy beside the project, under a new id.
pub(in crate::space) fn copy_of(src: Project) -> Project {
    let t = now();
    Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: format!("{} copy", src.name),
        created_at: t,
        updated_at: t,
        revision: None,
        ..src
    }
}

// ---- Export / import ----

/// A project on its way somewhere else.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    /// Bumped when the shape changes; an import refusing an unknown number is
    /// better than one guessing at it.
    pub format: u32,
    pub exported_at: u64,
    pub project: Project,
    /// Modules the project's steps need, by id.
    #[serde(default)]
    pub modules: Vec<String>,
    /// Those modules' .wasm files, travelling inside the bundle. A project
    /// whose steps call a module and arrives without it is a project that does
    /// not run, so the files come along rather than being chased down
    /// separately. Empty on a bundle written before they travelled, and on any
    /// module whose file was missing at export — `modules` still names every
    /// one, so the far end can say which are absent.
    #[serde(default)]
    pub module_files: Vec<BundledModule>,
    /// "step label" -> parameter names that were blanked, so an import can ask
    /// for exactly what is missing instead of making the operator hunt.
    #[serde(default)]
    pub needs: Vec<NeedsSecret>,
}

/// One module inside a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundledModule {
    pub id: String,
    /// The .wasm deflated and then base64'd: a module is a binary and a bundle
    /// is JSON. Deflate first because a release module is mostly padding and
    /// base64 would otherwise add a third on top of the full size.
    pub wasm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeedsSecret {
    pub block_id: String,
    pub label: String,
    pub params: Vec<String>,
}

pub const BUNDLE_FORMAT: u32 = 1;

/// Strips every value the project marked secret and records what was stripped.
pub(in crate::space) fn export(project_id: &str) -> Result<Bundle> {
    let project = read_db()?
        .projects
        .into_iter()
        .find(|p| p.id == project_id)
        .context("no such project")?;
    Ok(bundle(project))
}

/// The bundle a project leaves as, from wherever it was read.
pub(in crate::space) fn bundle(mut project: Project) -> Bundle {
    let mut needs = Vec::new();
    let mut modules: Vec<String> = Vec::new();
    for block in &mut project.blocks {
        // A module block's kind is "module:<id>:<block>"; the file it needs
        // travels with the bundle.
        if let Some(rest) = block.kind.strip_prefix("module:") {
            if let Some((id, _)) = rest.split_once(':') {
                if !modules.iter().any(|m| m == id) {
                    modules.push(id.to_string());
                }
            }
        }
        if block.secrets.is_empty() {
            continue;
        }
        let mut cleared = Vec::new();
        if let Value::Object(map) = &mut block.params {
            for name in &block.secrets {
                if let Some(slot) = map.get_mut(name) {
                    *slot = Value::String(String::new());
                    cleared.push(name.clone());
                }
            }
        }
        if !cleared.is_empty() {
            needs.push(NeedsSecret {
                block_id: block.id.clone(),
                label: if block.label.is_empty() { block.kind.clone() } else { block.label.clone() },
                params: cleared,
            });
        }
    }

    // The run's profile list is this machine's ids and means nothing anywhere
    // else, so it does not travel.
    project.run.profiles.clear();
    project.revision = None;

    Bundle {
        format: BUNDLE_FORMAT,
        exported_at: now(),
        project,
        module_files: collect_modules(&modules),
        modules,
        needs,
    }
}

/// Reads each module's .wasm and packs it for the bundle. A module that is not
/// on disk is skipped rather than fatal: exporting a project should not be
/// blocked by a module the operator already removed, and `modules` still names
/// it so the far end can say what is missing.
#[cfg(feature = "automation")]
fn collect_modules(ids: &[String]) -> Vec<BundledModule> {
    use base64::Engine as _;
    use std::io::Write as _;
    let Ok(dir) = crate::wasm::modules_dir() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for id in ids {
        let Ok(bytes) = fs::read(dir.join(format!("{id}.wasm"))) else {
            eprintln!("[launcher] export: module {id} is not installed — bundling its id only");
            continue;
        };
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        if enc.write_all(&bytes).is_err() {
            continue;
        }
        let Ok(gz) = enc.finish() else { continue };
        out.push(BundledModule {
            id: id.clone(),
            wasm: base64::engine::general_purpose::STANDARD.encode(gz),
        });
    }
    out
}

#[cfg(not(feature = "automation"))]
fn collect_modules(_ids: &[String]) -> Vec<BundledModule> {
    Vec::new()
}

/// Puts the bundle's modules on disk, one by one, before the project that needs
/// them exists. A module already installed under that id is LEFT ALONE — other
/// projects may be using it, and quietly swapping the file under them is worse
/// than importing a project that turns out to need a newer one.
#[cfg(feature = "automation")]
fn restore_modules(files: &[BundledModule]) {
    use base64::Engine as _;
    use std::io::Read as _;
    let Ok(dir) = crate::wasm::modules_dir() else {
        return;
    };
    for m in files {
        if dir.join(format!("{}.wasm", m.id)).exists() {
            eprintln!("[launcher] import: module {} is already installed — kept", m.id);
            continue;
        }
        let Ok(gz) = base64::engine::general_purpose::STANDARD.decode(&m.wasm) else {
            eprintln!("[launcher] import: module {} is not readable — skipped", m.id);
            continue;
        };
        let mut wasm = Vec::new();
        if flate2::read::GzDecoder::new(gz.as_slice())
            .read_to_end(&mut wasm)
            .is_err()
        {
            eprintln!("[launcher] import: module {} did not unpack — skipped", m.id);
            continue;
        }
        // Through install(), so an imported module passes the same name and
        // load checks as one added by hand and a broken one never lands.
        let tmp = std::env::temp_dir().join(format!("shardx-import-{}.wasm", m.id));
        if fs::write(&tmp, &wasm).is_err() {
            continue;
        }
        if let Err(e) = crate::wasm::install(&tmp.to_string_lossy()) {
            eprintln!("[launcher] import: module {} did not install: {e}", m.id);
        }
        let _ = fs::remove_file(&tmp);
    }
}

#[cfg(not(feature = "automation"))]
fn restore_modules(_files: &[BundledModule]) {}

/// Brings a bundle in as a NEW project — never overwriting one, because two
/// people trading projects will collide on ids sooner or later.
pub(in crate::space) fn import(bundle: Bundle) -> Result<Project> {
    let project = unbundle(bundle)?;
    let _g = lock().lock().unwrap();
    let mut db = read_db()?;
    db.projects.push(project.clone());
    write_db(&db)?;
    Ok(project)
}

/// The bundle's project under a new id, its modules installed on this machine.
pub(in crate::space) fn unbundle(bundle: Bundle) -> Result<Project> {
    if bundle.format != BUNDLE_FORMAT {
        return Err(anyhow::anyhow!(
            "this bundle is format {} and this launcher reads {}",
            bundle.format,
            BUNDLE_FORMAT
        ));
    }
    // Before the project, so its steps have something to call the moment it
    // appears in the list.
    restore_modules(&bundle.module_files);
    let t = now();
    let mut project = bundle.project;
    project.id = uuid::Uuid::new_v4().to_string();
    project.created_at = t;
    project.updated_at = t;
    project.revision = None;
    project.run.profiles.clear();
    unique_block_ids(&mut project);
    Ok(project)
}

/// Unix seconds, for a team's save.
pub(in crate::space) fn stamp() -> u64 {
    now()
}

#[cfg(test)]
mod block_id_tests {
    use super::*;

    #[test]
    fn a_repeated_step_id_is_given_a_new_one_and_the_first_keeps_its_own() {
        let mut p: Project = serde_json::from_value(serde_json::json!({
            "id": "p", "name": "x", "created_at": 0, "updated_at": 0,
            "blocks": [
                { "id": "a", "kind": "wait" },
                { "id": "a", "kind": "click" },
                { "id": "", "kind": "type" },
                { "id": "b", "kind": "wait" }
            ]
        }))
        .unwrap();
        unique_block_ids(&mut p);
        let ids: Vec<&str> = p.blocks.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids[0], "a");
        assert_eq!(p.blocks[0].kind, "wait", "the first one keeps the id");
        assert_eq!(ids[3], "b");
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 4, "{ids:?}");
        assert!(ids.iter().all(|i| !i.is_empty()));
    }
}
