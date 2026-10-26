"""The engine's ``Motion`` domain — pointer movement, keystrokes, finger
gestures and turning the handset. Everything is produced inside the browser
process; nothing is injected into the page.

The domain is deliberately absent from ``/json/protocol`` and
``Schema.getDomains``, so a page that enumerates the protocol cannot find it.

Attach it to a PAGE. Everything it does happens to the page's widget, and the
handler finds that widget through the target's own web contents — a browser
target has none, so every command on a browser session answered "no live
frame". It used to open one, and Motion never worked from the SDK at all.

Pointer and touch are exclusive: a profile claiming a touchscreen refuses every
pointer command, and one that does not refuses every finger command.

    async with sdk.session(profile) as browser:
        page = await browser.new_page()
        motion = await Motion.attach(page)
        await motion.create_pointer(20, 20)
        await motion.glide_to(640, 360, target_width=220)
        await motion.tap()
        await motion.enter_text("hello there")
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


class Motion:
    """Thin wrapper over a browser-level CDP session."""

    def __init__(self, session: Any) -> None:
        self._session = session

    @classmethod
    async def attach(cls, page: Any) -> "Motion":
        """Open a CDP session on `page` for the domain.

        A browser-level session is accepted for callers written against the
        older signature, but it cannot work: the handler reaches the widget
        through the target's web contents, and a browser target has none.
        """
        context = getattr(page, "context", None)
        if context is not None and hasattr(context, "new_cdp_session"):
            return cls(await context.new_cdp_session(page))
        if hasattr(page, "new_browser_cdp_session"):
            raise TypeError(
                "Motion.attach needs a page, not a browser: the domain acts on "
                "a page's widget. Pass `await browser.new_page()`."
            )
        return cls(await page.new_cdp_session())

    async def _call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return await self._session.send(method, params or {}) or {}

    # ---- pointer ----

    async def create_pointer(
        self,
        x: float,
        y: float,
        pace_scale: Optional[float] = None,
        seed: Optional[int] = None,
    ) -> None:
        """Where the cursor starts. Not a movement — call it before anything
        else, since a guessed origin produces the wrong duration and curve."""
        p: Dict[str, Any] = {"x": x, "y": y}
        if pace_scale is not None:
            p["paceScale"] = pace_scale
        if seed is not None:
            p["seed"] = seed
        await self._call("Motion.createPointer", p)

    async def glide_to(self, x: float, y: float, target_width: Optional[float] = None) -> float:
        """Move along a human trajectory. ``target_width`` is the element's real
        width; it feeds Fitts's law, so a small target genuinely takes longer."""
        p: Dict[str, Any] = {"x": x, "y": y}
        if target_width is not None:
            p["targetWidth"] = target_width
        return (await self._call("Motion.glideTo", p)).get("durationMs", 0.0)

    async def tap(self, button: str = "left", click_count: int = 1) -> float:
        """Press and release where the pointer already is."""
        r = await self._call("Motion.tap", {"button": button, "clickCount": click_count})
        return r.get("durationMs", 0.0)

    async def drag_to(
        self,
        x: float,
        y: float,
        target_width: Optional[float] = None,
        button: str = "left",
    ) -> float:
        """Press here, travel with the button held, release there."""
        p: Dict[str, Any] = {"x": x, "y": y, "button": button}
        if target_width is not None:
            p["targetWidth"] = target_width
        return (await self._call("Motion.dragTo", p)).get("durationMs", 0.0)

    async def wheel(self, delta_y: float, delta_x: Optional[float] = None) -> float:
        """Scroll under the pointer with the device the profile's platform
        implies — a trackpad on macOS, a notched wheel elsewhere. Deliberately
        does not move the pointer."""
        p: Dict[str, Any] = {"deltaY": delta_y}
        if delta_x is not None:
            p["deltaX"] = delta_x
        return (await self._call("Motion.wheel", p)).get("durationMs", 0.0)

    async def enter_text(self, text: str, allow_typos: bool = False) -> float:
        """Type into whatever has focus, key by key. ``allow_typos`` lets the
        profile make and correct a mistake, which changes the value that lands."""
        r = await self._call("Motion.enterText", {"text": text, "allowTypos": allow_typos})
        return r.get("durationMs", 0.0)

    async def press_key(self, key: str, modifiers: Optional[List[str]] = None) -> float:
        """One named key ("Enter", "Tab", "ArrowDown") or a printable character,
        which resolves through the profile's own keyboard layout."""
        p: Dict[str, Any] = {"key": key}
        if modifiers:
            p["modifiers"] = modifiers
        return (await self._call("Motion.pressKey", p)).get("durationMs", 0.0)

    async def destroy_pointer(self) -> None:
        await self._call("Motion.destroyPointer")

    # ---- touch (phone profiles only) ----
    #
    # A finger is not on the glass between commands, so unlike the pointer there
    # is nothing to create first: each call places its own contacts, plays the
    # whole gesture and lifts them.

    async def touch_tap(
        self,
        x: float,
        y: float,
        target_width: Optional[float] = None,
        tap_count: int = 1,
    ) -> float:
        """``target_width`` defaults to 44 in the core — the smallest tappable
        target, which is the pessimistic assumption."""
        p: Dict[str, Any] = {"x": x, "y": y, "tapCount": tap_count}
        if target_width is not None:
            p["targetWidth"] = target_width
        return (await self._call("Motion.touchTap", p)).get("durationMs", 0.0)

    async def touch_long_press(self, x: float, y: float, hold_ms: Optional[float] = None) -> float:
        """The phone's context menu. ``hold_ms`` is floored above the browser's
        own long-press threshold — a shorter hold is a slow tap, and gives a
        click instead of a menu."""
        p: Dict[str, Any] = {"x": x, "y": y}
        if hold_ms is not None:
            p["holdMs"] = hold_ms
        return (await self._call("Motion.touchLongPress", p)).get("durationMs", 0.0)

    async def touch_swipe(
        self,
        from_x: float,
        from_y: float,
        to_x: float,
        to_y: float,
        flick: Optional[bool] = None,
    ) -> float:
        """``flick`` lifts the finger while it is still moving, which is what
        flings the page. Omit it to let the profile decide."""
        p: Dict[str, Any] = {"fromX": from_x, "fromY": from_y, "toX": to_x, "toY": to_y}
        if flick is not None:
            p["flick"] = flick
        return (await self._call("Motion.touchSwipe", p)).get("durationMs", 0.0)

    async def touch_drag(
        self,
        from_x: float,
        from_y: float,
        to_x: float,
        to_y: float,
        hold_ms: Optional[float] = None,
    ) -> float:
        """Drag, not scroll: the contact stays still until the long-press timers
        have fired, which is when a page's drag-and-drop starts."""
        p: Dict[str, Any] = {"fromX": from_x, "fromY": from_y, "toX": to_x, "toY": to_y}
        if hold_ms is not None:
            p["holdMs"] = hold_ms
        return (await self._call("Motion.touchDrag", p)).get("durationMs", 0.0)

    async def pinch(
        self,
        x: float,
        y: float,
        scale: float,
        rotation: Optional[float] = None,
    ) -> float:
        """Above 1 spreads, below 1 pinches. Fails rather than delivering a
        gesture below the browser's recognition thresholds, which would look
        like success and zoom nothing."""
        p: Dict[str, Any] = {"x": x, "y": y, "scale": scale}
        if rotation is not None:
            p["rotation"] = rotation
        return (await self._call("Motion.pinch", p)).get("durationMs", 0.0)

    # ---- the handset itself ----

    async def set_orientation(self, angle: int, turn_ms: Optional[float] = None) -> Dict[str, Any]:
        """Turn the phone. Physical: the sensors move first and the picture
        commits at the end, so ``screen.width`` read after this returns is
        already the turned one. ``angle`` is 0, 90, 180 or 270."""
        p: Dict[str, Any] = {"angle": angle}
        if turn_ms is not None:
            p["turnMs"] = turn_ms
        return await self._call("Motion.setOrientation", p)

    async def detach(self) -> None:
        try:
            await self._session.detach()
        except Exception:
            pass
