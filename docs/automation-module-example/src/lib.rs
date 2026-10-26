//! An example module for the Octopus Agent automation runner.
//!
//! The module DRIVES: it asks for one action at a time and is told the result,
//! so it can read a page, count what it found, notice a 429, and decide what to
//! do next. Everything here needs that; none of it could be written as a chain
//! of built-in blocks, nor by the older contract that hands over a finished
//! plan and learns nothing about how it went.
//!
//! What that does NOT change: the module still touches nothing itself. Every
//! action it asks for is built into an ordinary block and performed by the
//! runner through the Motion domain, exactly as if the operator had placed it
//! by hand. A module cannot run script in the page, and its clicks are human
//! clicks like every other click the launcher makes.
//!
//! Layout is the point of splitting this across files: a real module is large,
//! and `lib.rs` should stay a manifest and a switch. See README.md.

mod compose;
mod forms;
mod mobile;
mod scrape;
mod sdk;

use sdk::*;
use serde_json::json;

/// The blocks this module contributes to the library.
///
/// `group` places each one: a built-in group by id or label ("data", "Flow",
/// "Touch"…), any other name to start a new group with that title, or omitted
/// to land in this module's own group. `params` is the form the operator fills
/// in — the same shape the built-in blocks use, so they look native.
#[no_mangle]
pub extern "C" fn blocks() -> i64 {
    pack(
        json!([
            {
                "kind": "harvest",
                "label": "Harvest a paginated list",
                "about": "Reads every row on every page, following the next-page link.",
                "group": "data",
                "params": [
                    { "name": "item", "label": "Each row", "kind": "text",
                      "hint": "CSS selector; put {i} in it for the index, or leave it off" },
                    { "name": "next", "label": "Next page", "kind": "text",
                      "hint": "CSS selector — empty means a single page" },
                    { "name": "pages", "label": "At most this many pages", "kind": "number", "default": 5 },
                    { "name": "patience", "label": "Wait for a page (s)", "kind": "number", "default": 10 },
                    { "name": "append", "label": "Add to what is already saved", "kind": "select", "options": ["no", "yes"] },
                    { "name": "into", "label": "Save the rows as", "kind": "text",
                      "hint": "one row per line; the count lands in <name>_count" }
                ]
            },
            {
                "kind": "api_pages",
                "label": "Walk an API",
                "about": "Requests page after page through the profile's proxy, backing off on 429.",
                "group": "requests",
                "params": [
                    { "name": "url", "label": "Address", "kind": "url",
                      "hint": "https://site/api/items?page={page}" },
                    { "name": "from", "label": "First page", "kind": "number", "default": 1 },
                    { "name": "pages", "label": "At most this many", "kind": "number", "default": 10 },
                    { "name": "while_contains", "label": "Keep going while the answer holds", "kind": "text",
                      "hint": "a word that disappears on the empty page" },
                    { "name": "headers", "label": "Headers", "kind": "textarea", "hint": "Name: value, one per line" },
                    { "name": "retries", "label": "Retries on 429/5xx", "kind": "number", "default": 3 },
                    { "name": "pause", "label": "Pause between pages (s)", "kind": "number", "default": 0.4 },
                    { "name": "resume", "label": "Carry on where it stopped", "kind": "select", "options": ["no", "yes"] },
                    { "name": "into", "label": "Save the bodies as", "kind": "text",
                      "hint": "one body per line; the page count lands in <name>_pages" }
                ]
            },
            {
                "kind": "submit",
                "label": "Submit and recover",
                "about": "Presses submit, reads the complaint, and retries only what retrying can fix.",
                "group": "flow",
                "params": [
                    { "name": "submit", "label": "Submit button", "kind": "text", "hint": "CSS selector" },
                    { "name": "success", "label": "Sign that it worked", "kind": "text", "hint": "CSS selector" },
                    { "name": "error", "label": "Where the error appears", "kind": "text", "hint": "CSS selector" },
                    { "name": "give_up_on", "label": "Do not retry when it says", "kind": "textarea",
                      "hint": "one phrase per line — captcha, blocked, incorrect password…" },
                    { "name": "attempts", "label": "Attempts", "kind": "number", "default": 3 },
                    { "name": "patience", "label": "Wait for an answer (s)", "kind": "number", "default": 15 },
                    { "name": "into", "label": "Save the last error as", "kind": "text" }
                ]
            },
            {
                "kind": "race",
                "label": "Whichever appears first",
                "about": "Waits on several selectors at once and saves the one that won.",
                "group": "flow",
                "params": [
                    { "name": "selectors", "label": "Selectors", "kind": "textarea", "hint": "one per line" },
                    { "name": "patience", "label": "Give up after (s)", "kind": "number", "default": 30 },
                    { "name": "required", "label": "Fail if none appear", "kind": "select", "options": ["no", "yes"] },
                    { "name": "into", "label": "Save the winner as", "kind": "text",
                      "hint": "its position lands in <name>_index, 0 for none" }
                ]
            },
            {
                "kind": "compose",
                "label": "Sign in, harvest, parse",
                "about": "Calls the operator's own login flow, reads the page, and hands the rows to another module.",
                "group": "data",
                "params": [
                    { "name": "login_flow", "label": "Sign in with", "kind": "text",
                      "hint": "the name of a saved project — leave empty to skip" },
                    { "name": "login_entry", "label": "Starting at", "kind": "text",
                      "hint": "an entry point inside it, optional" },
                    { "name": "user", "label": "Account", "kind": "text" },
                    { "name": "pass", "label": "Password", "kind": "text", "secret": true },
                    { "name": "item", "label": "Each row", "kind": "text", "hint": "CSS selector" },
                    { "name": "parser", "label": "Parse with", "kind": "text",
                      "hint": "another module's id — leave empty to keep the raw rows" },
                    { "name": "parser_block", "label": "Its block", "kind": "text" },
                    { "name": "into", "label": "Save as", "kind": "text" }
                ]
            },
            {
                "kind": "feed",
                "label": "Scroll a feed to the end",
                "about": "Swipes until the feed stops growing. Uses the wheel when there is no touchscreen.",
                "group": "touch",
                "params": [
                    { "name": "item", "label": "Each card", "kind": "text", "hint": "CSS selector" },
                    { "name": "until", "label": "Stop when this appears", "kind": "text", "hint": "CSS selector, optional" },
                    { "name": "want", "label": "Stop at this many cards", "kind": "number", "default": 0 },
                    { "name": "swipes", "label": "At most this many swipes", "kind": "number", "default": 20 },
                    { "name": "distance", "label": "How far each swipe (px)", "kind": "number", "default": 600 },
                    { "name": "into", "label": "Save the count as", "kind": "text",
                      "hint": "the swipes taken land in <name>_swipes" }
                ]
            }
        ])
        .to_string(),
    )
}

/// What this module needs to be allowed to call.
///
/// Optional, and its ABSENCE is the compatibility signal: a module written
/// before nesting existed exports no `manifest` and therefore asks for nothing,
/// which is exactly what it should get. Asking is not being granted — the
/// operator ticks each line in Modules, and until they do, every call comes back
/// refused with a message naming what was missing.
#[no_mangle]
pub extern "C" fn manifest() -> i64 {
    pack(
        json!({
            "reason": "the login is the operator's own flow; the parsing is somebody else's module",
            "flows": ["Log in"],
            "modules": ["csv-tools"],
            // Naming what it reads is a claim the operator can see and the host
            // enforces. Say nothing and you get every variable of the run —
            // which is what the Modules list will then say about you.
            "vars": ["account", "order_*"]
        })
        .to_string(),
    )
}

/// One placed block, start to finish.
///
/// Exporting `step` is what puts this module on the driving path — a module
/// that exports only `run` keeps the older contract for ever. The return value is
/// `{"error": ""}` for a step that worked and the reason for one that did not;
/// a non-empty error stops the run the way any failed block does.
#[no_mangle]
pub extern "C" fn step(ptr: i32, len: i32) -> i64 {
    let text = unpack(ptr, len);
    let input: Input = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return finish(&format!("bad input: {e}")),
    };

    match input.block.as_str() {
        "harvest" => scrape::harvest(&input),
        "api_pages" => scrape::api_pages(&input),
        "submit" => forms::submit_and_recover(&input),
        "race" => forms::race(&input),
        "feed" => mobile::feed(&input),
        "compose" => compose::run(&input),
        other => finish(&format!("this module has no block called \"{other}\"")),
    }
}
