//! The `key` table on real folders: whatever the new manifest says, Chrome
//! must give the live folder the same id after the swap as before it.

use super::super::chrome_id::{chrome_id, id_from_key};
use super::*;
use serde_json::json;

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn temp() -> Dir {
    let d = std::env::temp_dir().join(format!("shardx-manifest-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&d).unwrap();
    Dir(d)
}

fn tree(base: &Dir, name: &str, manifest: &str) -> PathBuf {
    let d = base.0.join(name);
    fs::create_dir_all(&d).unwrap();
    fs::write(d.join("manifest.json"), manifest).unwrap();
    d
}

fn b64(der: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(der)
}

const K: &[u8] = b"key-of-the-live-extension";
const K2: &[u8] = b"someone-else's-key";

fn keyed(der: &[u8]) -> String {
    format!("{{\n  \"key\": \"{}\",\n  \"name\": \"X\",\n  \"version\": \"2.0\",\n  \"manifest_version\": 3\n}}\n", b64(der))
}

const PLAIN: &str = "{\n  \"name\": \"X\",\n  \"version\": \"2.0\",\n  \"manifest_version\": 3\n}\n";

/// Fits `new` against `live`, then puts the result where `live` is, as the
/// swap would: the id Chrome computes there must not move.
fn fit_at_live(live_manifest: &str, new_manifest: &str) -> (Result<KeyAction>, String, String) {
    let base = temp();
    let live = tree(&base, "live", live_manifest);
    let new = tree(&base, "staging", new_manifest);
    let before = chrome_id(&live).unwrap();
    let res = fit_manifest(&new, &id_basis(&live).unwrap());
    let fitted = fs::read_to_string(new.join("manifest.json")).unwrap();
    if res.is_ok() {
        fs::write(live.join("manifest.json"), &fitted).unwrap();
        assert_eq!(chrome_id(&live).unwrap(), before, "id moved for {new_manifest:?}");
    }
    (res, fitted, before)
}

#[test]
fn no_key_and_no_key() {
    let (res, fitted, _) = fit_at_live(PLAIN, PLAIN);
    assert_eq!(res.unwrap(), KeyAction::None);
    assert_eq!(fitted, PLAIN);
}

#[test]
fn same_key_kept() {
    let (res, fitted, id) = fit_at_live(&keyed(K), &keyed(K));
    assert_eq!(res.unwrap(), KeyAction::Kept);
    assert_eq!(fitted, keyed(K));
    assert_eq!(id, id_from_key(K));
    // The same DER spelled as PEM is the same key.
    let pem = format!("-----BEGIN PUBLIC KEY-----\\n{}\\n-----END PUBLIC KEY-----", b64(K));
    let live = format!("{{\"key\": \"{pem}\", \"name\": \"X\", \"version\": \"1.0\"}}");
    assert_eq!(fit_at_live(&live, &keyed(K)).0.unwrap(), KeyAction::Kept);
}

#[test]
fn lost_key_put_back() {
    let (res, fitted, id) = fit_at_live(&keyed(K), PLAIN);
    assert_eq!(res.unwrap(), KeyAction::Inserted);
    let v: Value = serde_json::from_str(&fitted).unwrap();
    assert_eq!(v["key"], b64(K));
    assert_eq!(v["version"], "2.0");
    assert!(fitted.ends_with(&PLAIN[1..]), "the rest is left as shipped: {fitted}");
    assert_eq!(id, id_from_key(K));
}

#[test]
fn new_key_taken_out() {
    let (res, fitted, _) = fit_at_live(PLAIN, &keyed(K));
    assert_eq!(res.unwrap(), KeyAction::Removed);
    let v: Value = serde_json::from_str(&fitted).unwrap();
    assert!(v.get("key").is_none());
    assert_eq!(v, json!({"name": "X", "version": "2.0", "manifest_version": 3}));
}

#[test]
fn another_key_refused() {
    let (res, fitted, _) = fit_at_live(&keyed(K), &keyed(K2));
    assert!(res.is_err());
    assert_eq!(fitted, keyed(K2), "left as it came");
}

#[test]
fn comments_insert_but_never_remove() {
    let commented = "// shipped with a comment\n{ /* a { brace */\n  \"name\": \"X\", // trailing\n  \"version\": \"2.0\"\n}\n";
    let (res, fitted, id) = fit_at_live(&keyed(K), commented);
    assert_eq!(res.unwrap(), KeyAction::Inserted);
    assert!(fitted.starts_with("// shipped with a comment\n{\n  \"key\": "), "{fitted}");
    assert_eq!(id, id_from_key(K));

    let commented_key = format!("{{ // keyed\n  \"key\": \"{}\",\n  \"name\": \"X\", \"version\": \"2.0\"\n}}", b64(K));
    let (res, fitted, _) = fit_at_live(PLAIN, &commented_key);
    assert!(res.unwrap_err().to_string().contains("not plain JSON"));
    assert_eq!(fitted, commented_key, "left as it came");
}

#[test]
fn strings_hide_comment_markers() {
    let tricky = r#"{"name": "a // b /* c", "version": "1.0", "homepage_url": "https://x.test/\"//"}"#;
    let base = temp();
    let d = tree(&base, "t", tricky);
    let m = read_manifest(&d).unwrap();
    assert_eq!(m["name"], "a // b /* c");
    assert_eq!(m["homepage_url"], "https://x.test/\"//");
    let bom = tree(&base, "bom", "\u{feff}{\"name\": \"Б\", /* é */ \"version\": \"1\"}");
    assert_eq!(read_manifest(&bom).unwrap()["name"], "Б");
    let empty = tree(&base, "empty", "{ }");
    assert!(insert_key(&empty, K).is_err());
}

#[test]
fn growth_is_what_the_new_version_adds() {
    let old = json!({
        "manifest_version": 3,
        "permissions": ["storage", "tabs"],
        "host_permissions": ["https://*.metamask.io/*"],
        "content_scripts": [{"matches": ["file://*/*", "http://*/*", "https://*/*"], "js": ["c.js"]}],
        "externally_connectable": {"matches": ["https://metamask.io/*"]},
        "web_accessible_resources": [{"resources": ["inpage.js"], "matches": ["*://*/*"]}]
    });
    assert!(perm_growth(&old, &old).is_empty());

    let mut new = old.clone();
    new["permissions"] = json!(["storage", "tabs", "debugger", {"fileSystem": ["write"]}]);
    new["host_permissions"] = json!(["https://*.metamask.io/*", "https://evil.test/*"]);
    new["content_scripts"] = json!([
        {"matches": ["file://*/*", "http://*/*", "https://*/*"], "js": ["c.js"]},
        {"matches": ["https://*/*"], "js": ["inpage.js"], "world": "MAIN"}
    ]);
    new["externally_connectable"] = json!({"matches": ["https://metamask.io/*", "https://*.evil.test/*"]});
    new["web_accessible_resources"] = json!([{"resources": ["x.js"], "matches": ["https://only.test/*"]}]);
    let got = perm_growth(&old, &new);
    let g = |kind: GrantKind, value: &str| Grant { kind, value: value.into() };
    assert_eq!(
        got,
        [
            g(GrantKind::Permission, "debugger"),
            g(GrantKind::Permission, r#"{"fileSystem":["write"]}"#),
            g(GrantKind::Host, "https://evil.test/*"),
            g(GrantKind::MainWorld, "https://*/*"),
            g(GrantKind::Connectable, "https://*.evil.test/*"),
        ],
        "the script site and the resource site are covered by what it had"
    );
    assert_eq!(serde_json::to_value(&got[3]).unwrap(), json!({"kind": "main_world", "value": "https://*/*"}));
}

#[test]
fn growth_across_manifest_versions() {
    let mv2 = json!({
        "manifest_version": 2,
        "permissions": ["storage", "<all_urls>"],
        "web_accessible_resources": ["inpage.js"]
    });
    let mv3 = json!({
        "manifest_version": 3,
        "permissions": ["storage", "scripting"],
        "host_permissions": ["https://*/*", "file:///*"],
        "web_accessible_resources": [{"resources": ["inpage.js"], "matches": ["<all_urls>"]}]
    });
    let g = |kind: GrantKind, value: &str| Grant { kind, value: value.into() };
    assert_eq!(perm_growth(&mv2, &mv3), [g(GrantKind::Permission, "scripting"), g(GrantKind::ManifestVersion, "3")]);
    // Less access is no growth.
    assert!(perm_growth(&mv3, &json!({"manifest_version": 3})).is_empty());
    // A new site among MV2 permissions is a host, not an API.
    let more = json!({"manifest_version": 2, "permissions": ["storage", "https://x.test/*"]});
    assert_eq!(perm_growth(&json!({"manifest_version": 2, "permissions": ["storage"]}), &more), [g(GrantKind::Host, "https://x.test/*")]);
}

fn files(base: &Dir, name: &str, list: &[(&str, &str)]) -> PathBuf {
    let d = base.0.join(name);
    for (rel, body) in list {
        let p = d.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }
    d
}

#[test]
fn overlap_counts_same_files() {
    let base = temp();
    let old = files(&base, "old", &[
        ("manifest.json", "{\"version\":\"1\"}"),
        ("a.js", "a"),
        ("b.js", "b"),
        ("img/x.png", "png"),
        ("_metadata/verified_contents.json", "[]"),
        (".added", "@1"),
        (".DS_Store", "litter"),
    ]);
    let new = files(&base, "new", &[("manifest.json", "{\"version\":\"2\"}"), ("a.js", "a"), ("b.js", "b2"), ("img/x.png", "png")]);
    let r = overlap(&old, &new).unwrap();
    assert!((r - 2.0 / 3.0).abs() < 1e-9, "{r}");
    let other = files(&base, "other", &[("manifest.json", "{}"), ("z.js", "z")]);
    assert_eq!(overlap(&old, &other).unwrap(), 0.0);
    let bare = files(&base, "bare", &[("manifest.json", "{}")]);
    assert_eq!(overlap(&bare, &new).unwrap(), 0.0, "nothing to compare is no evidence");
    assert_eq!(overlap(&new, &new).unwrap(), 1.0);
}

#[test]
fn names_compared_as_shown() {
    let base = temp();
    let msg = |name: &str, key: &str, value: &str| {
        files(&base, name, &[
            ("manifest.json", &format!(r#"{{"name": "__MSG_{key}__", "default_locale": "en", "version": "1"}}"#)),
            ("_locales/en/messages.json", &format!(r#"{{"{key}": {{"message": "{value}"}}}}"#)),
        ])
    };
    let a = msg("a", "appName", "MetaMask");
    let b = msg("b", "appName", "METAMASK ");
    assert!(name_same(&a, &b));
    let lower = files(&base, "lower", &[
        ("manifest.json", r#"{"name": "__MSG_appName__", "default_locale": "en", "version": "1"}"#),
        ("_locales/en/messages.json", r#"{"appname": {"message": "MetaMask"}}"#),
    ]);
    assert_eq!(display_name(&lower).as_deref(), Some("MetaMask"), "message names ignore case");
    let clone = msg("c", "appName", "MetaMask Wallet");
    assert!(!name_same(&a, &clone));
    // Placeholders nobody can resolve prove nothing.
    let lost = files(&base, "lost", &[("manifest.json", r#"{"name": "__MSG_appName__", "version": "1"}"#)]);
    assert!(!name_same(&lost, &lost));
    let plain = files(&base, "plain", &[("manifest.json", r#"{"name": "Rabby Wallet", "version": "1"}"#)]);
    let plain2 = files(&base, "plain2", &[("manifest.json", r#"{"name": "rabby wallet", "version": "2"}"#)]);
    assert!(name_same(&plain, &plain2));
}

/// The owner's four wallets against their store versions (24.10.2026), and against each other.
#[test]
fn thresholds_fit_the_calibrated_pairs() {
    for (overlap, name) in [(0.4418, true), (0.9567, true), (0.1196, true), (0.7245, true)] {
        assert_eq!(kinship(overlap, name), Kinship::Same, "{overlap}");
    }
    assert_eq!(kinship(0.0, false), Kinship::Other, "different extensions share no file");
    assert_eq!(kinship(0.1196, false), Kinship::Unsure, "renamed and mostly rebuilt: the person decides");
    assert_eq!(kinship(0.04, true), Kinship::Other);
}

/// Taking over search, the start pages, a page of its own or DevTools needs
/// no permission, so it is growth too; and so is another extension let in.
#[test]
fn growth_counts_what_it_takes_over() {
    let old = json!({
        "manifest_version": 3,
        "chrome_settings_overrides": {"homepage": "https://wallet.test"},
        "chrome_url_overrides": {"newtab": "tab.html"},
        "externally_connectable": {"ids": ["abc"]}
    });
    assert!(perm_growth(&old, &old).is_empty());
    let mut same_pages = old.clone();
    same_pages["chrome_url_overrides"] = json!({"newtab": "tab2.html"});
    assert!(perm_growth(&old, &same_pages).is_empty(), "its own new tab page, moved: nothing new");

    let mut new = old.clone();
    new["chrome_settings_overrides"] = json!({
        "homepage": "https://evil.test",
        "search_provider": {"is_default": true, "search_url": "https://evil.test/?q={searchTerms}"}
    });
    new["chrome_url_overrides"] = json!({"newtab": "tab.html", "history": "h.html"});
    new["devtools_page"] = json!("dt.html");
    new["omnibox"] = json!({"keyword": "w"});
    new["externally_connectable"] = json!({"ids": ["abc", "*"]});
    let g = |kind: GrantKind, value: &str| Grant { kind, value: value.into() };
    assert_eq!(
        perm_growth(&old, &new),
        [
            g(GrantKind::Connectable, "extension:*"),
            g(GrantKind::Override, "chrome_settings_overrides.homepage"),
            g(GrantKind::Override, "chrome_settings_overrides.search_provider"),
            g(GrantKind::Override, "chrome_url_overrides.history"),
            g(GrantKind::Override, "devtools_page"),
            g(GrantKind::Override, "omnibox"),
        ]
    );
    // Any extension let in already covers one more.
    let any = json!({"externally_connectable": {"ids": ["*"]}});
    assert!(perm_growth(&any, &json!({"externally_connectable": {"ids": ["*", "def"]}})).is_empty());
}
