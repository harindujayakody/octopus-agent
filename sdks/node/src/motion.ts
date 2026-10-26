// The engine's `Motion` domain: pointer movement, keystrokes, finger gestures
// and turning the handset — produced inside the browser process, with no
// script injected into the page.
//
// The domain is deliberately absent from /json/protocol and
// Schema.getDomains, so a page that enumerates the protocol cannot find it.
//
// Attach it to a PAGE. Everything it does happens to the page's widget, and
// the handler reaches that widget through the target's own web contents — a
// browser target has none, so every command on a browser session answered
// "no live frame". It used to open one, and Motion never worked from the SDK.
//
// Pointer and touch are exclusive: a profile claiming a touchscreen refuses
// every pointer command, and one that does not refuses every finger command.
import type { CDPSession, Page } from "patchright";

export type MouseButton = "left" | "middle" | "right";

/** 0, 90, 180 or 270, clockwise from the orientation the profile was written in. */
export type ScreenAngle = 0 | 90 | 180 | 270;

export interface OrientationResult {
  angle: number;
  type: string;
  screenWidth: number;
  screenHeight: number;
  durationMs: number;
}

export class Motion {
  private constructor(private readonly session: CDPSession) {}

  /** Open a CDP session on `page` for the domain. */
  static async attach(page: Page): Promise<Motion> {
    return new Motion(await page.context().newCDPSession(page));
  }

  private async call<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return (await this.session.send(method as never, params as never)) as T;
  }

  // ---- pointer ----

  /** Where the cursor starts. Not a movement — call it before anything else,
   *  since a guessed origin produces the wrong duration and curve. */
  async createPointer(
    x: number,
    y: number,
    opts: { paceScale?: number; seed?: number } = {},
  ): Promise<void> {
    await this.call("Motion.createPointer", { x, y, ...opts });
  }

  /** Move along a human trajectory. `targetWidth` is the element's real width;
   *  it feeds Fitts's law, so a small target genuinely takes longer. */
  async glideTo(x: number, y: number, targetWidth?: number): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.glideTo", {
      x,
      y,
      ...(targetWidth === undefined ? {} : { targetWidth }),
    });
    return r.durationMs;
  }

  /** Press and release where the pointer already is. */
  async tap(opts: { button?: MouseButton; clickCount?: number } = {}): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.tap", opts);
    return r.durationMs;
  }

  /** Press here, travel with the button held, release there. */
  async dragTo(
    x: number,
    y: number,
    opts: { targetWidth?: number; button?: MouseButton } = {},
  ): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.dragTo", { x, y, ...opts });
    return r.durationMs;
  }

  /** Scroll under the pointer with the device the profile's platform implies —
   *  a trackpad on macOS, a notched wheel elsewhere. Does not move the pointer. */
  async wheel(deltaY: number, deltaX?: number): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.wheel", {
      deltaY,
      ...(deltaX === undefined ? {} : { deltaX }),
    });
    return r.durationMs;
  }

  /** Type into whatever has focus, key by key. `allowTypos` lets the profile
   *  make and correct a mistake, which changes the value that lands. */
  async enterText(text: string, allowTypos = false): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.enterText", { text, allowTypos });
    return r.durationMs;
  }

  /** One named key ("Enter", "Tab", "ArrowDown") or a printable character,
   *  which resolves through the profile's own keyboard layout. */
  async pressKey(key: string, modifiers: string[] = []): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.pressKey", {
      key,
      ...(modifiers.length ? { modifiers } : {}),
    });
    return r.durationMs;
  }

  async destroyPointer(): Promise<void> {
    await this.call("Motion.destroyPointer");
  }

  // ---- touch (phone profiles only) ----
  //
  // A finger is not on the glass between commands, so unlike the pointer there
  // is nothing to create first: each call places its own contacts, plays the
  // whole gesture and lifts them.

  /** `targetWidth` defaults to 44 in the core — the smallest tappable target. */
  async touchTap(
    x: number,
    y: number,
    opts: { targetWidth?: number; tapCount?: number } = {},
  ): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.touchTap", { x, y, ...opts });
    return r.durationMs;
  }

  /** The phone's context menu. `holdMs` is floored above the browser's own
   *  long-press threshold — a shorter hold is a slow tap, and yields a click. */
  async touchLongPress(x: number, y: number, holdMs?: number): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.touchLongPress", {
      x,
      y,
      ...(holdMs === undefined ? {} : { holdMs }),
    });
    return r.durationMs;
  }

  /** `flick` lifts the finger while it is still moving, which is what flings
   *  the page. Omit it to let the profile decide. */
  async touchSwipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    flick?: boolean,
  ): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.touchSwipe", {
      fromX,
      fromY,
      toX,
      toY,
      ...(flick === undefined ? {} : { flick }),
    });
    return r.durationMs;
  }

  /** Drag, not scroll: the contact stays still until the long-press timers have
   *  fired, which is when a page's drag-and-drop starts. */
  async touchDrag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    holdMs?: number,
  ): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.touchDrag", {
      fromX,
      fromY,
      toX,
      toY,
      ...(holdMs === undefined ? {} : { holdMs }),
    });
    return r.durationMs;
  }

  /** Above 1 spreads, below 1 pinches. Fails rather than delivering a gesture
   *  below the browser's recognition thresholds, which would zoom nothing. */
  async pinch(
    x: number,
    y: number,
    scale: number,
    rotation?: number,
  ): Promise<number> {
    const r = await this.call<{ durationMs: number }>("Motion.pinch", {
      x,
      y,
      scale,
      ...(rotation === undefined ? {} : { rotation }),
    });
    return r.durationMs;
  }

  // ---- the handset itself ----

  /** Turn the phone. Physical: the sensors move first and the picture commits
   *  at the end, so `screen.width` read after this resolves is already turned. */
  async setOrientation(angle: ScreenAngle, turnMs?: number): Promise<OrientationResult> {
    return this.call<OrientationResult>("Motion.setOrientation", {
      angle,
      ...(turnMs === undefined ? {} : { turnMs }),
    });
  }

  async detach(): Promise<void> {
    await this.session.detach().catch(() => {});
  }
}
