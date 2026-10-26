//! The engine's `Motion` domain — pointer movement, keystrokes, finger
//! gestures and turning the handset. Everything is produced inside the browser
//! process; nothing is injected into the page.
//!
//! The domain is deliberately absent from `/json/protocol` and
//! `Schema.getDomains`, so a page that enumerates the protocol cannot find
//! it. That also means chromiumoxide has no generated type for it, so the
//! calls go out through [`RawCommand`] below.
//!
//! It attaches to a PAGE. Everything it does happens to the page's widget,
//! and the handler reaches that widget through the target's own web contents
//! — a browser target has none, so every command sent to a browser session
//! answered "no live frame". It used to be built from the browser, and Motion
//! never worked from this SDK at all.
//!
//! Pointer and touch are exclusive: a profile claiming a touchscreen refuses
//! every pointer command, and one that does not refuses every finger command.
//!
//! ```no_run
//! # use shardx::{ShardX, motion::Motion};
//! # async fn demo(sdk: &ShardX, profile: shardx::Profile) -> anyhow::Result<()> {
//! let session = sdk.session(profile, Default::default()).await?;
//! let page = session.new_page("about:blank").await?;
//! let motion = Motion::new(&page);
//! motion.create_pointer(20.0, 20.0).await?;
//! motion.glide_to(640.0, 360.0, Some(220.0)).await?;
//! motion.tap("left", 1).await?;
//! motion.enter_text("hello there", false).await?;
//! # Ok(()) }
//! ```

use std::borrow::Cow;

use anyhow::Result;
use chromiumoxide::{Command, Method, Page};
use chromiumoxide_types::MethodId;
use serde::Serialize;
use serde_json::{json, Value};

/// A CDP call to a domain chromiumoxide has no generated type for.
#[derive(Serialize)]
pub struct RawCommand {
    #[serde(skip)]
    method: &'static str,
    #[serde(flatten)]
    params: Value,
}

impl Method for RawCommand {
    fn identifier(&self) -> MethodId {
        Cow::Borrowed(self.method)
    }
}

impl Command for RawCommand {
    type Response = Value;
}

/// Human input on one page. Cheap to make — it borrows the connection.
pub struct Motion<'a> {
    page: &'a Page,
}

impl<'a> Motion<'a> {
    pub fn new(page: &'a Page) -> Self {
        Self { page }
    }

    async fn call(&self, method: &'static str, params: Value) -> Result<Value> {
        let r = self.page.execute(RawCommand { method, params }).await?;
        Ok(r.result.clone())
    }

    fn ms(v: &Value) -> f64 {
        v.get("durationMs").and_then(Value::as_f64).unwrap_or(0.0)
    }

    // ---- pointer ----

    /// Where the cursor starts. Not a movement — call it before anything else,
    /// since a guessed origin produces the wrong duration and curve.
    pub async fn create_pointer(&self, x: f64, y: f64) -> Result<()> {
        self.call("Motion.createPointer", json!({ "x": x, "y": y })).await?;
        Ok(())
    }

    /// As above, but overriding the profile's pace and motor seed. Leave the
    /// seed unset in production: the per-profile signature is the point.
    pub async fn create_pointer_with(
        &self,
        x: f64,
        y: f64,
        pace_scale: Option<f64>,
        seed: Option<i64>,
    ) -> Result<()> {
        let mut p = json!({ "x": x, "y": y });
        if let Some(v) = pace_scale {
            p["paceScale"] = json!(v);
        }
        if let Some(v) = seed {
            p["seed"] = json!(v);
        }
        self.call("Motion.createPointer", p).await?;
        Ok(())
    }

    /// Move along a human trajectory. `target_width` is the element's real
    /// width; it feeds Fitts's law, so a small target genuinely takes longer.
    pub async fn glide_to(&self, x: f64, y: f64, target_width: Option<f64>) -> Result<f64> {
        let mut p = json!({ "x": x, "y": y });
        if let Some(w) = target_width {
            p["targetWidth"] = json!(w);
        }
        Ok(Self::ms(&self.call("Motion.glideTo", p).await?))
    }

    /// Press and release where the pointer already is.
    pub async fn tap(&self, button: &str, click_count: u8) -> Result<f64> {
        let p = json!({ "button": button, "clickCount": click_count });
        Ok(Self::ms(&self.call("Motion.tap", p).await?))
    }

    /// Press here, travel with the button held, release there.
    pub async fn drag_to(
        &self,
        x: f64,
        y: f64,
        target_width: Option<f64>,
        button: &str,
    ) -> Result<f64> {
        let mut p = json!({ "x": x, "y": y, "button": button });
        if let Some(w) = target_width {
            p["targetWidth"] = json!(w);
        }
        Ok(Self::ms(&self.call("Motion.dragTo", p).await?))
    }

    /// Scroll under the pointer with the device the profile's platform implies
    /// — a trackpad on macOS, a notched wheel elsewhere. Does not move the
    /// pointer: a scroll happens under whatever the cursor is already over.
    pub async fn wheel(&self, delta_y: f64, delta_x: Option<f64>) -> Result<f64> {
        let mut p = json!({ "deltaY": delta_y });
        if let Some(dx) = delta_x {
            p["deltaX"] = json!(dx);
        }
        Ok(Self::ms(&self.call("Motion.wheel", p).await?))
    }

    /// Type into whatever has focus, key by key. `allow_typos` lets the profile
    /// make and correct a mistake, which changes the value that lands.
    pub async fn enter_text(&self, text: &str, allow_typos: bool) -> Result<f64> {
        let p = json!({ "text": text, "allowTypos": allow_typos });
        Ok(Self::ms(&self.call("Motion.enterText", p).await?))
    }

    /// One named key ("Enter", "Tab", "ArrowDown") or a printable character,
    /// which resolves through the profile's own keyboard layout.
    pub async fn press_key(&self, key: &str, modifiers: &[&str]) -> Result<f64> {
        let mut p = json!({ "key": key });
        if !modifiers.is_empty() {
            p["modifiers"] = json!(modifiers);
        }
        Ok(Self::ms(&self.call("Motion.pressKey", p).await?))
    }

    pub async fn destroy_pointer(&self) -> Result<()> {
        self.call("Motion.destroyPointer", json!({})).await?;
        Ok(())
    }

    // ---- touch (phone profiles only) ----
    //
    // A finger is not on the glass between commands, so unlike the pointer
    // there is nothing to create first: each call places its own contacts,
    // plays the whole gesture and lifts them.

    /// `target_width` defaults to 44 in the core — the smallest tappable
    /// target, which is the pessimistic assumption.
    pub async fn touch_tap(
        &self,
        x: f64,
        y: f64,
        target_width: Option<f64>,
        tap_count: u8,
    ) -> Result<f64> {
        let mut p = json!({ "x": x, "y": y, "tapCount": tap_count });
        if let Some(w) = target_width {
            p["targetWidth"] = json!(w);
        }
        Ok(Self::ms(&self.call("Motion.touchTap", p).await?))
    }

    /// The phone's context menu. `hold_ms` is floored above the browser's own
    /// long-press threshold — a shorter hold is a slow tap, and gives a click
    /// instead of a menu with nothing to say why.
    pub async fn touch_long_press(&self, x: f64, y: f64, hold_ms: Option<f64>) -> Result<f64> {
        let mut p = json!({ "x": x, "y": y });
        if let Some(v) = hold_ms {
            p["holdMs"] = json!(v);
        }
        Ok(Self::ms(&self.call("Motion.touchLongPress", p).await?))
    }

    /// `flick` lifts the finger while it is still moving, which is what flings
    /// the page. `None` lets the profile decide.
    pub async fn touch_swipe(
        &self,
        from: (f64, f64),
        to: (f64, f64),
        flick: Option<bool>,
    ) -> Result<f64> {
        let mut p = json!({ "fromX": from.0, "fromY": from.1, "toX": to.0, "toY": to.1 });
        if let Some(v) = flick {
            p["flick"] = json!(v);
        }
        Ok(Self::ms(&self.call("Motion.touchSwipe", p).await?))
    }

    /// Drag, not scroll: the contact stays still until the long-press timers
    /// have fired, which is when a page's drag-and-drop starts.
    pub async fn touch_drag(
        &self,
        from: (f64, f64),
        to: (f64, f64),
        hold_ms: Option<f64>,
    ) -> Result<f64> {
        let mut p = json!({ "fromX": from.0, "fromY": from.1, "toX": to.0, "toY": to.1 });
        if let Some(v) = hold_ms {
            p["holdMs"] = json!(v);
        }
        Ok(Self::ms(&self.call("Motion.touchDrag", p).await?))
    }

    /// Above 1 spreads, below 1 pinches. Fails rather than delivering a gesture
    /// below the browser's recognition thresholds, which would look like
    /// success and zoom nothing.
    pub async fn pinch(&self, x: f64, y: f64, scale: f64, rotation: Option<f64>) -> Result<f64> {
        let mut p = json!({ "x": x, "y": y, "scale": scale });
        if let Some(v) = rotation {
            p["rotation"] = json!(v);
        }
        Ok(Self::ms(&self.call("Motion.pinch", p).await?))
    }

    // ---- the handset itself ----

    /// Turn the phone. Physical: the sensors move first and the picture commits
    /// at the end, so `screen.width` read after this returns is already the
    /// turned one. `angle` is 0, 90, 180 or 270 — anything else is refused.
    ///
    /// Returns the raw reply: `angle`, `type`, `screenWidth`, `screenHeight`,
    /// `durationMs`.
    pub async fn set_orientation(&self, angle: i32, turn_ms: Option<f64>) -> Result<Value> {
        let mut p = json!({ "angle": angle });
        if let Some(v) = turn_ms {
            p["turnMs"] = json!(v);
        }
        self.call("Motion.setOrientation", p).await
    }
}
