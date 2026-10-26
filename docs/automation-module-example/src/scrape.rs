//! Two blocks that read as they go.
//!
//! Neither can be a finished plan: the module has to see the result of one
//! action before it knows what the next one is.

use crate::sdk::*;
use serde_json::json;

/// A scratch variable. The name is the module's, so it cannot collide with
/// something the operator keeps in the run.
const TMP: &str = "_shx_tmp";

/// Reads text out of one element and answers with it.
fn read(selector: &str, timeout: f64) -> Option<String> {
    let done = act(
        "readText",
        json!({ "selector": selector, "into": TMP, "timeout": timeout }),
    );
    done.ok.then(|| done.var(TMP))
}

/// How many elements match.
fn count(selector: &str) -> i64 {
    let done = act("count", json!({ "selector": selector, "into": TMP }));
    done.var(TMP).parse().unwrap_or(0)
}

/// Whether an element is on the page. `if.exists` never fails — a missing
/// element comes back as the "else" branch, which is an answer, not an error.
fn present(selector: &str) -> bool {
    let done = act("if.exists", json!({ "selector": selector }));
    done.ok && done.flow != "else"
}

/// Builds the selector for the n-th row: `{i}` where the operator put it, or
/// `:nth-of-type(n)` appended when they did not.
fn nth(item: &str, i: i64) -> String {
    if item.contains("{i}") {
        item.replace("{i}", &i.to_string())
    } else {
        format!("{item}:nth-of-type({i})")
    }
}

/// Walk a paginated list and bring back every row.
///
/// The pagination is the point: after clicking "next" the module WAITS until
/// the first row's text actually changes, so it never reads the old page
/// twice. A fixed sleep is the only alternative, and it is wrong in both
/// directions — too short on a slow site, wasted time on a fast one.
pub fn harvest(input: &Input) -> i64 {
    let item = input.param("item");
    let next = input.param("next");
    let into = input.param("into");
    if item.is_empty() || into.is_empty() {
        return finish("a row selector and a name to save under are both required");
    }
    let pages = input.number("pages", 5.0).clamp(1.0, 200.0) as i64;
    let patience = input.number("patience", 10.0).clamp(1.0, 120.0);

    // A block inside a loop — once per category, once per city — wants to add
    // to what it already collected rather than replace it.
    let mut rows: Vec<String> = if input.param("append").eq_ignore_ascii_case("yes") {
        var(&into).lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect()
    } else {
        Vec::new()
    };
    let mut page = 1;
    loop {
        if stopping() {
            say("stopped by the operator");
            break;
        }
        // The first row is also the marker for "the page turned", so wait for
        // it properly rather than assuming it is there.
        if !act("waitFor", json!({ "selector": nth(&item, 1), "timeout": patience })).ok {
            if page == 1 {
                return finish(&format!("no rows matched {item}"));
            }
            say("the next page never drew any rows — stopping here");
            break;
        }
        let first = read(&nth(&item, 1), patience).unwrap_or_default();

        let n = count(&item);
        say(format!("page {page}: {n} rows"));
        for i in 1..=n {
            if stopping() {
                break;
            }
            if let Some(text) = read(&nth(&item, i), 1.0) {
                let text = text.trim().to_string();
                if !text.is_empty() {
                    rows.push(text);
                }
            }
        }

        if page >= pages || next.is_empty() || !present(&next) {
            break;
        }
        let click = act("click", json!({ "selector": next }));
        if !click.ok {
            say(format!("could not click through to the next page: {}", click.error));
            break;
        }
        // Turned, or gave up on it. Either is a real answer; a sleep is not.
        if !changed(&nth(&item, 1), &first, patience) {
            say("the first row never changed — treating this as the last page");
            break;
        }
        page += 1;
    }

    set(&into, &rows.join("\n"));
    set(&format!("{into}_count"), &rows.len().to_string());
    say(format!("{} rows over {page} page(s)", rows.len()));
    finish("")
}

/// Polls one element until its text differs from `was`.
fn changed(selector: &str, was: &str, seconds: f64) -> bool {
    let deadline = now() + (seconds * 1000.0) as i64;
    while now() < deadline {
        if stopping() {
            return false;
        }
        if let Some(text) = read(selector, 0.5) {
            if text != was {
                return true;
            }
        }
        wait(200);
    }
    false
}

/// Walk an API page by page, with a real reaction to what comes back.
///
/// Every request goes out through the profile's own proxy, like the built-in
/// step — a call that left on the host address beside a browser that did not
/// is two visitors, and the site can see both.
pub fn api_pages(input: &Input) -> i64 {
    let template = input.param("url");
    let into = input.param("into");
    if template.is_empty() || into.is_empty() {
        return finish("an address and a name to save under are both required");
    }
    if !template.contains("{page}") {
        return finish("put {page} in the address where the page number goes");
    }
    let first = input.number("from", 1.0) as i64;
    let pages = input.number("pages", 10.0).clamp(1.0, 500.0) as i64;
    let needle = input.param("while_contains");
    let retries = input.number("retries", 3.0).clamp(0.0, 10.0) as i64;
    let pause = input.number("pause", 0.4).clamp(0.0, 30.0);

    // Where the last run of this block got to, so a walk that was stopped
    // half-way does not start from the beginning tomorrow. Keyed by the address
    // template: two different APIs are two different walks.
    let key = format!("cursor:{template}");
    let first = if input.param("resume").eq_ignore_ascii_case("yes") {
        let seen: i64 = recall(&key).parse().unwrap_or(0);
        if seen >= first {
            say(format!("carrying on from page {}", seen + 1));
            seen + 1
        } else {
            first
        }
    } else {
        first
    };

    let mut bodies: Vec<String> = Vec::new();
    for page in first..first + pages {
        if stopping() {
            break;
        }
        let url = template.replace("{page}", &page.to_string());
        let mut body = String::new();
        let mut got = false;
        for attempt in 0..=retries {
            let done = act(
                "http.request",
                json!({ "url": url, "method": "GET", "into": TMP,
                        "headers": input.param("headers"),
                        "session": "api-pages" }),
            );
            if !done.ok {
                say(format!("{url}: {}", done.error));
                break;
            }
            let status: i64 = done.var(&format!("{TMP}_status")).parse().unwrap_or(0);
            body = done.var(TMP);
            // The whole reason this block has to drive: a module that hands
            // over a finished plan never learns that the answer was 429.
            if status == 429 || (500..600).contains(&status) {
                if attempt == retries {
                    say(format!("page {page} kept answering {status} — giving up"));
                    break;
                }
                // Back off, with a little spread so a fleet does not retry in
                // lockstep.
                let backoff = 500 * (1 << attempt) + roll(400) as i64;
                say(format!("page {page} answered {status} — waiting {backoff}ms"));
                wait(backoff);
                continue;
            }
            if status < 200 || status >= 300 {
                say(format!("page {page} answered {status} — stopping"));
                break;
            }
            got = true;
            break;
        }
        if !got {
            break;
        }
        if !needle.is_empty() && !body.contains(&needle) {
            say(format!("page {page} no longer holds \"{needle}\" — that was the last one"));
            break;
        }
        bodies.push(body);
        remember(&key, &page.to_string());
        if pause > 0.0 {
            wait((pause * 1000.0) as i64 + roll(250) as i64);
        }
    }

    set(&into, &bodies.join("\n"));
    set(&format!("{into}_pages"), &bodies.len().to_string());
    finish("")
}
