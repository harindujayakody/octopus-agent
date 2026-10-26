//! A block that works on a phone profile and on a desktop one, without being
//! told which it is standing on.

use crate::sdk::*;
use serde_json::json;

const TMP: &str = "_shx_tmp";

fn count(selector: &str) -> i64 {
    let done = act("count", json!({ "selector": selector, "into": TMP }));
    done.var(TMP).parse().unwrap_or(0)
}

fn present(selector: &str) -> bool {
    let done = act("if.exists", json!({ "selector": selector }));
    done.ok && done.flow != "else"
}

/// Which hand this profile has — a finger or a wheel.
///
/// Nothing needs to be asked and nothing is wasted probing: the first swipe is
/// one we wanted anyway, and if the runner refuses it because the profile has
/// no touchscreen, that refusal IS the answer and the same movement goes out
/// through the wheel instead.
struct Hand {
    wheel: bool,
}

impl Hand {
    fn new() -> Hand {
        Hand { wheel: false }
    }

    /// Advance the page by `px`. A finger drags the content the other way,
    /// which is why the sign flips; the runner's own scroll step does the same.
    fn advance(&mut self, px: f64) -> bool {
        if !self.wheel {
            let done = act("touch.swipe", json!({ "dy": -px }));
            if done.ok {
                return true;
            }
            if !done.error.contains("touchscreen") {
                say(format!("swipe failed: {}", done.error));
                return false;
            }
            say("no touchscreen on this profile — using the wheel instead");
            self.wheel = true;
        }
        act("scroll", json!({ "deltaY": px })).ok
    }
}

/// Scroll a feed that loads more as you go, and stop when it stops giving.
///
/// The end of an endless feed has no marker on the page — the only way to know
/// is that the count stopped moving after a swipe. That is a read between two
/// actions, so it belongs in a module and not in a chain of blocks.
pub fn feed(input: &Input) -> i64 {
    let item = input.param("item");
    let into = input.param("into");
    if item.is_empty() || into.is_empty() {
        return finish("a card selector and a name to save under are both required");
    }
    let swipes = input.number("swipes", 20.0).clamp(1.0, 500.0) as i64;
    let distance = input.number("distance", 600.0).clamp(50.0, 4000.0);
    let until = input.param("until");
    let want = input.number("want", 0.0).max(0.0) as i64;

    let mut hand = Hand::new();
    let mut seen = count(&item);
    let mut idle = 0;
    let mut done_swipes = 0;

    for _ in 0..swipes {
        if stopping() {
            break;
        }
        if want > 0 && seen >= want {
            break;
        }
        if !until.is_empty() && present(&until) {
            say("found what we were scrolling for");
            set(&format!("{into}_found"), "yes");
            break;
        }
        // Never twice the same distance: a feed scrolled in exact multiples is
        // a machine, and it reads that way in the telemetry a site collects.
        if !hand.advance(distance + roll(120) as f64 - 60.0) {
            say("could not scroll any further");
            break;
        }
        done_swipes += 1;
        // Let the feed load. Then look — the loading is what we are counting.
        wait(500 + roll(400) as i64);
        let now_seen = count(&item);
        if now_seen <= seen {
            idle += 1;
            // Twice, not once: a feed often skips one round while it fetches.
            if idle >= 2 {
                say(format!("the feed stopped growing at {now_seen}"));
                break;
            }
            wait(900 + roll(600) as i64);
        } else {
            idle = 0;
        }
        seen = seen.max(now_seen);
    }

    set(&into, &seen.to_string());
    set(&format!("{into}_swipes"), &done_swipes.to_string());
    say(format!("{seen} cards after {done_swipes} swipe(s)"));
    finish("")
}
