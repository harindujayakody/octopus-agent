//! Two blocks that decide what to do from what the page said.

use crate::sdk::*;
use serde_json::json;

const TMP: &str = "_shx_tmp";

fn present(selector: &str) -> bool {
    let done = act("if.exists", json!({ "selector": selector }));
    done.ok && done.flow != "else"
}

fn text_of(selector: &str) -> String {
    let done = act(
        "readText",
        json!({ "selector": selector, "into": TMP, "timeout": 2.0 }),
    );
    if done.ok { done.var(TMP).trim().to_string() } else { String::new() }
}

/// Submit, read the complaint, and try again only when trying again can work.
///
/// A retry loop built out of built-in blocks retries everything the same way,
/// including a wrong password and a captcha. This one reads the error and
/// decides: a rate limit is worth waiting out, a wrong field is not.
pub fn submit_and_recover(input: &Input) -> i64 {
    let submit = input.param("submit");
    let success = input.param("success");
    let error = input.param("error");
    if submit.is_empty() || success.is_empty() {
        return finish("the submit button and the sign that it worked are both required");
    }
    let attempts = input.number("attempts", 3.0).clamp(1.0, 10.0) as i64;
    let patience = input.number("patience", 15.0).clamp(1.0, 300.0);
    // Words that mean "no amount of retrying will help", one per line.
    let fatal: Vec<String> = input
        .param("give_up_on")
        .lines()
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty())
        .collect();
    let into = input.param("into");

    for attempt in 1..=attempts {
        if stopping() {
            return finish("stopped");
        }
        let click = act("click", json!({ "selector": submit }));
        if !click.ok {
            return finish(&format!("could not press submit: {}", click.error));
        }

        // Whichever answer arrives first ends the wait. Waiting for the good
        // one alone means every failure costs the full timeout.
        let deadline = now() + (patience * 1000.0) as i64;
        let mut outcome = String::new();
        while now() < deadline {
            if stopping() {
                return finish("stopped");
            }
            if present(&success) {
                outcome = "ok".into();
                break;
            }
            if !error.is_empty() && present(&error) {
                outcome = "error".into();
                break;
            }
            wait(250);
        }

        match outcome.as_str() {
            "ok" => {
                if !into.is_empty() {
                    set(&into, "");
                    set(&format!("{into}_attempts"), &attempt.to_string());
                }
                say(format!("submitted on attempt {attempt}"));
                return finish("");
            }
            "error" => {
                let why = text_of(&error);
                say(format!("attempt {attempt}: {why}"));
                if !into.is_empty() {
                    set(&into, &why);
                }
                let lower = why.to_lowercase();
                if fatal.iter().any(|f| lower.contains(f)) {
                    return finish(&format!("the form said: {why}"));
                }
                if attempt == attempts {
                    return finish(&format!("gave up after {attempts}: {why}"));
                }
                // Human-sized, and not the same on every profile of a fleet.
                wait(1_200 * attempt + roll(900) as i64);
            }
            _ => {
                if attempt == attempts {
                    return finish("the form neither worked nor complained");
                }
                say(format!("attempt {attempt}: no answer at all — trying again"));
            }
        }
    }
    finish("out of attempts")
}

/// Wait for whichever of several things happens first, and say which.
///
/// One of these covers what the built-in blocks need a branch each for: the
/// dialog, the captcha, the "we sent you a code" page and the error banner all
/// arrive at the same place, and only one of them will.
pub fn race(input: &Input) -> i64 {
    let selectors: Vec<String> = input
        .param("selectors")
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let into = input.param("into");
    if selectors.len() < 2 {
        return finish("give at least two selectors, one per line");
    }
    if into.is_empty() {
        return finish("a name to save the winner under is required");
    }
    let patience = input.number("patience", 30.0).clamp(1.0, 600.0);
    let deadline = now() + (patience * 1000.0) as i64;

    while now() < deadline {
        if stopping() {
            return finish("stopped");
        }
        for (i, selector) in selectors.iter().enumerate() {
            if present(selector) {
                set(&into, selector);
                set(&format!("{into}_index"), &(i + 1).to_string());
                say(format!("#{} won: {selector}", i + 1));
                return finish("");
            }
        }
        wait(200);
    }

    set(&into, "");
    set(&format!("{into}_index"), "0");
    if input.param("required").eq_ignore_ascii_case("yes") {
        return finish(&format!("none of the {} appeared in {patience}s", selectors.len()));
    }
    say("nothing appeared — carrying on with an empty answer");
    finish("")
}
