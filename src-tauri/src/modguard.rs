//! What a module may not do, whatever block it asks for.
//!
//! This is not a capability model. It is the shorter, harder list: the places
//! where the block vocabulary is itself a general-purpose escape, so that
//! labelling a block "page" or "data" would describe what it is called rather
//! than what it can reach. Four of them, found by reading the arms rather than
//! their names:
//!
//!   * `goto` takes any URL and never looks at the scheme, so `file:///…` plus
//!     `readText` is a disk read and `data:text/html,<script>` is code in the
//!     page — under a block the whole library calls navigation.
//!   * `file.readLine` and `file.append` take any absolute path, and readLine
//!     REWRITES the file without the line it took. That reaches the launcher's
//!     own settings, whose api_secret signs tokens for the local API.
//!   * `traffic.editResponse` and `traffic.fulfill` take an arbitrary response
//!     body, which the next navigation runs in the main world. `script.run` is
//!     not the only way to execute script; it is only the honest one.
//!   * `db.open` accepts a Postgres or MySQL connection string, which is
//!     outbound network, and SQLite's ATTACH reaches any path on the disk.
//!
//! The rule everywhere below: the OPERATOR may still do all of it, because they
//! can see the block they placed. A module chose the parameters itself, and
//! nobody saw them. So each refusal names what to do instead — place the block
//! by hand, or hand the module the value as a step field.
//!
//! Applies to every frame below a module's, not only to the module's own
//! actions: a module decides when to call a flow and what to pass into it, so a
//! flow that does `goto {{url}}` is the module's reach with an extra step.

#![cfg(feature = "automation")]

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

/// Schemes a module may navigate to. `about:blank` is here because clearing the
/// page is a reasonable thing to want; `about:` anything else is not.
const ALLOWED_SCHEMES: [&str; 2] = ["http", "https"];

/// Checks one block a module is about to run.
///
/// `params` are already expanded, so what is checked is what will be used —
/// checking the template would miss a `{{var}}` holding `file:///`.
pub fn check(
    module: &str,
    kind: &str,
    params: &Value,
    vars: &HashMap<String, String>,
    data_dir: &Path,
) -> Result<()> {
    let get = |name: &str| -> String {
        params
            .get(name)
            .and_then(|v| v.as_str())
            .map(|s| expand(s, vars))
            .unwrap_or_default()
    };

    match kind {
        "goto" => {
            let url = get("url");
            let scheme = url.split(':').next().unwrap_or("").to_ascii_lowercase();
            if url.trim().eq_ignore_ascii_case("about:blank") {
                return Ok(());
            }
            if !ALLOWED_SCHEMES.contains(&scheme.as_str()) {
                return Err(anyhow!(
                    "\"{module}\" may only open http and https addresses, not \"{scheme}\" — \
                     place the step yourself if that is what you meant"
                ));
            }
        }

        // Reading a line REMOVES it, so both of these are writes.
        "file.readLine" | "file.append" => {
            confine(module, &get("path"), data_dir, "file")?;
        }

        // An empty path means the default place beside the run's logs, which is
        // the launcher's own and fine.
        "screenshot" => {
            let path = get("path");
            if !path.trim().is_empty() {
                confine(module, &path, data_dir, "picture")?;
            }
        }

        // A module that could run script in the page would make the guarantee
        // the whole subsystem is built on — that a module never touches the
        // page — untrue. There is no parameter that makes this safe.
        "script.run" => {
            return Err(anyhow!(
                "\"{module}\" may not run script in the page — that is the one thing a module \
                 never does; place the step yourself if the project needs it"
            ));
        }

        // Both take a response body, and a body is script.
        "traffic.editResponse" | "traffic.fulfill" => {
            return Err(anyhow!(
                "\"{module}\" may not rewrite a response body — the page would run whatever it \
                 returned; blocking, redirecting and headers are still available"
            ));
        }

        "db.open" => {
            let driver = {
                let d = get("driver");
                if d.trim().is_empty() { "sqlite".to_string() } else { d.to_ascii_lowercase() }
            };
            if driver != "sqlite" {
                return Err(anyhow!(
                    "\"{module}\" may only open a local SQLite file — a \"{driver}\" connection \
                     string is an outbound connection nobody saw"
                ));
            }
            let target = {
                let t = get("target");
                if t.trim().is_empty() { get("path") } else { t }
            };
            confine(module, &target, data_dir, "database")?;
        }

        // A request that leaves on the host address beside a browser that did
        // not is two visitors, and the site sees both. The operator may decide
        // that; a module may not decide it for them.
        "http.request" => {
            let via = get("via");
            if !via.is_empty() && via != "profile" {
                return Err(anyhow!(
                    "\"{module}\" may only send requests through the profile's own proxy"
                ));
            }
        }

        _ => {}
    }
    Ok(())
}

/// Refuses a path that does not sit inside the module's own folder.
///
/// Resolved before it is compared, so `..` and a symlink both land where they
/// actually point rather than where they read.
fn confine(module: &str, raw: &str, data_dir: &Path, what: &str) -> Result<()> {
    if raw.trim().is_empty() {
        return Err(anyhow!("\"{module}\" asked for a {what} with no path"));
    }
    let wanted = resolve(Path::new(raw));
    let root = resolve(data_dir);
    if !wanted.starts_with(&root) {
        return Err(anyhow!(
            "\"{module}\" may only reach its own folder ({}), not {} — pass the value in as a \
             step field if it should come from elsewhere",
            root.display(),
            wanted.display()
        ));
    }
    Ok(())
}

/// An absolute, `..`-free path. The file need not exist: the deepest ancestor
/// that does is canonicalised, and the rest is appended.
fn resolve(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    let mut real = PathBuf::new();
    let mut rest: Vec<Component> = Vec::new();
    let comps: Vec<Component> = absolute.components().collect();
    for i in (0..=comps.len()).rev() {
        let head: PathBuf = comps[..i].iter().collect();
        if let Ok(c) = head.canonicalize() {
            real = c;
            rest = comps[i..].to_vec();
            break;
        }
    }
    if real.as_os_str().is_empty() {
        real = absolute.clone();
        rest.clear();
    }
    for c in rest {
        match c {
            Component::ParentDir => {
                real.pop();
            }
            Component::CurDir => {}
            other => real.push(other.as_os_str()),
        }
    }
    real
}

/// The same substitution the runner does, so a check sees the real value.
fn expand(text: &str, vars: &HashMap<String, String>) -> String {
    let mut out = text.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn no_vars() -> HashMap<String, String> {
        HashMap::new()
    }

    fn dir() -> PathBuf {
        std::env::temp_dir().join("shardx-modguard-test")
    }

    #[test]
    fn only_http_and_https_are_navigable() {
        let d = dir();
        for ok in ["https://example.com/x", "http://example.com", "about:blank", "ABOUT:BLANK"] {
            assert!(
                check("m", "goto", &json!({ "url": ok }), &no_vars(), &d).is_ok(),
                "{ok} should be allowed"
            );
        }
        for bad in [
            "file:///etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "javascript:alert(1)",
            "chrome://settings",
            "about:config",
        ] {
            assert!(
                check("m", "goto", &json!({ "url": bad }), &no_vars(), &d).is_err(),
                "{bad} should be refused"
            );
        }
    }

    #[test]
    fn a_variable_cannot_smuggle_a_scheme_past_the_check() {
        let mut vars = no_vars();
        vars.insert("target".into(), "file:///etc/passwd".into());
        let err = check("m", "goto", &json!({ "url": "{{target}}" }), &vars, &dir()).unwrap_err();
        assert!(err.to_string().contains("http"), "{err}");
    }

    #[test]
    fn files_are_confined_to_the_modules_own_folder() {
        let d = dir();
        std::fs::create_dir_all(&d).ok();
        let inside = d.join("accounts.txt");
        assert!(check("m", "file.append",
                      &json!({ "path": inside.to_string_lossy(), "line": "x" }),
                      &no_vars(), &d).is_ok());
        // Straight out.
        assert!(check("m", "file.readLine",
                      &json!({ "path": "/etc/hosts", "into": "v" }), &no_vars(), &d).is_err());
        // And out the back way.
        let sneaky = d.join("..").join("..").join("settings.json");
        let err = check("m", "file.readLine",
                        &json!({ "path": sneaky.to_string_lossy(), "into": "v" }),
                        &no_vars(), &d).unwrap_err();
        assert!(err.to_string().contains("own folder"), "{err}");
    }

    #[test]
    fn script_and_response_bodies_are_refused_outright() {
        let d = dir();
        assert!(check("m", "script.run", &json!({ "source": "1" }), &no_vars(), &d).is_err());
        assert!(check("m", "traffic.fulfill", &json!({}), &no_vars(), &d).is_err());
        assert!(check("m", "traffic.editResponse", &json!({}), &no_vars(), &d).is_err());
        // The ones that cannot carry a body are still available.
        assert!(check("m", "traffic.block", &json!({}), &no_vars(), &d).is_ok());
        assert!(check("m", "traffic.redirect", &json!({}), &no_vars(), &d).is_ok());
        assert!(check("m", "traffic.setHeaders", &json!({}), &no_vars(), &d).is_ok());
    }

    #[test]
    fn only_a_local_sqlite_file_can_be_opened() {
        let d = dir();
        std::fs::create_dir_all(&d).ok();
        let mine = d.join("notes.sqlite");
        assert!(check("m", "db.open",
                      &json!({ "driver": "sqlite", "path": mine.to_string_lossy() }),
                      &no_vars(), &d).is_ok());
        let outbound = check("m", "db.open",
                             &json!({ "driver": "postgres", "target": "host=elsewhere user=x" }),
                             &no_vars(), &d).unwrap_err();
        assert!(outbound.to_string().contains("outbound"), "{outbound}");
        // The default driver is sqlite, and the path still has to be ours.
        assert!(check("m", "db.open",
                      &json!({ "path": "/Users/x/Library/Application Support/Google/Chrome/Default/Cookies" }),
                      &no_vars(), &d).is_err());
    }

    #[test]
    fn a_request_leaves_through_the_profiles_proxy() {
        let d = dir();
        assert!(check("m", "http.request", &json!({ "url": "https://x/" }), &no_vars(), &d).is_ok());
        assert!(check("m", "http.request",
                      &json!({ "url": "https://x/", "via": "profile" }), &no_vars(), &d).is_ok());
        assert!(check("m", "http.request",
                      &json!({ "url": "https://x/", "via": "host" }), &no_vars(), &d).is_err());
    }

    #[test]
    fn everything_else_is_untouched() {
        let d = dir();
        for kind in ["click", "type", "readText", "count", "waitFor", "var.set", "if.exists", "touch.tap"] {
            assert!(check("m", kind, &json!({}), &no_vars(), &d).is_ok(), "{kind}");
        }
    }
}
