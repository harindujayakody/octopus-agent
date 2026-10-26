//! A block that is mostly other people's work.
//!
//! This is what nesting is for: the login is a flow the operator already built
//! and keeps working, the parsing lives in a module somebody else wrote, and
//! what is left here is the part that is actually this module's own.

use crate::sdk::*;
use serde_json::json;

/// Sign in through the operator's own flow, then harvest, then hand the rows to
/// a parser module.
///
/// Nothing here is reachable by default. The manifest below asks for the flow
/// and the module by name; until the operator ticks them in Modules every call
/// comes back refused, with a message naming what was not granted.
pub fn run(input: &Input) -> i64 {
    let flow = input.param("login_flow");
    let parser = input.param("parser");
    let item = input.param("item");
    let into = input.param("into");
    if into.is_empty() {
        return finish("a name to save the result under is required");
    }

    // 1. The operator's own login, called like a function: it is given the
    //    account and hands back the session it ended up with.
    if !flow.is_empty() {
        let done = call_flow(
            &flow,
            input.param("login_entry").as_str(),
            &[("user", &input.param("user")), ("pass", &input.param("pass"))],
            &["session"],
        );
        if !done.ok {
            return finish(&format!("could not sign in: {}", done.error));
        }
        say(format!("signed in as {}", input.param("user")));
    }

    // 2. This module's own part: read what is on the page.
    let mut rows: Vec<String> = Vec::new();
    let count = act("count", json!({ "selector": item, "into": "_shx_n" }));
    let n: i64 = count.var("_shx_n").parse().unwrap_or(0);
    for i in 1..=n {
        if stopping() {
            break;
        }
        let one = act(
            "readText",
            json!({ "selector": format!("{item}:nth-of-type({i})"), "into": "_shx_t", "timeout": 1.0 }),
        );
        if one.ok {
            let t = one.var("_shx_t").trim().to_string();
            if !t.is_empty() {
                rows.push(t);
            }
        }
    }
    say(format!("read {} rows", rows.len()));

    // 3. Somebody else's parser, called as a block. It is an ordinary module
    //    with ordinary blocks — the only difference is who is asking.
    if parser.is_empty() {
        set(&into, &rows.join("\n"));
        return finish("");
    }
    set("_shx_rows", &rows.join("\n"));
    let done = call_module(
        &parser,
        &input.param("parser_block"),
        json!({ "text": "{{_shx_rows}}", "into": into }),
    );
    if !done.ok {
        return finish(&format!("the parser refused: {}", done.error));
    }
    // Whatever it wrote is already in the run's variables; say what came back so
    // a failure here is visible in the log rather than as an empty result.
    say(format!("{into} = {} characters", done.var(&into).len()));
    finish("")
}
