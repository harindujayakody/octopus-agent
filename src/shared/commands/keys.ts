import { HOST_OS } from "../lib/utils";
import { digitOf, letterOf } from "@proxyshard/shardx-ui-kit";
import { isMod } from "../lib/keyboard";

/// The registry's key grammar. A binding is one chord, "S", "Shift+S",
/// "Mod+K", "Mod+Enter", "Delete", "Escape", "ArrowDown", "F6", "?", "/",
/// "Mod+1", or a sequence of two chords with a space, "G P". "Mod" is Cmd on
/// macOS and Ctrl elsewhere. Letters are written upper case.
///
/// The platform words are C13's and live here only, so no component prints a
/// key by hand (E8's scan): how a Mod chord prints ("⌘K", "Ctrl+K") and the
/// Delete key's cap (⌫ or Del). Which key is Mod is `isMod` in
/// `shared/lib/keyboard`.

export type Chord = { mod: boolean; shift: boolean; alt: boolean; key: string };

export function parseChord(text: string): Chord {
  const parts = text.split("+");
  const key = parts.pop() ?? "";
  return { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), key };
}

/** "G P" is a sequence: two keys pressed one after the other. */
export const isSequence = (binding: string): boolean => binding.includes(" ");

export function chordsOf(binding: string): Chord[] {
  return binding.split(" ").map(parseChord);
}

const mac = () => HOST_OS === "macOS";

type KeyLike = Pick<KeyboardEvent, "key" | "code">;

/// The letter and the digit a key means come from the kit (`letterOf`,
/// `digitOf`), the one copy of layout-proof matching, so a fix lands once.
/// The Latin letter printed on the key wins (AZERTY, QWERTZ); on a layout
/// without Latin letters the key's place does (A11Y-02, ruling 2). A digit
/// is read by its place (PC-044).
export const eventLetter: (e: KeyLike) => string | null = letterOf;
export const eventDigit: (e: KeyLike) => string | null = digitOf;

/// Whether a key event is this chord. The other platform's command key must be
/// up (Ctrl+S on macOS is not S). Letters compare Shift exactly; a digit's
/// Shift belongs to the layout; punctuation ("?", "/") is the character typed,
/// whatever Shift it took.
export function matchesChord(e: KeyboardEvent, c: Chord): boolean {
  const other = mac() ? e.ctrlKey : e.metaKey;
  if (isMod(e) !== c.mod || other || e.altKey !== c.alt) return false;
  if (/^[A-Z]$/.test(c.key)) return e.shiftKey === c.shift && eventLetter(e) === c.key;
  if (/^[0-9]$/.test(c.key)) return eventDigit(e) === c.key;
  if (c.key.length === 1) return e.key === c.key;
  if (e.shiftKey !== c.shift) return false;
  return c.key === "Space" ? e.key === " " : e.key === c.key;
}

/// One key of a sequence ("G", then "P"). Shift and Caps Lock are ignored, as
/// the sheet prints the letters in capitals; Mod and Alt are not.
export function matchesSequenceStep(e: KeyboardEvent, c: Chord): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return eventLetter(e) === c.key;
}

const CAPS: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Escape: "Esc", PageUp: "PgUp", PageDown: "PgDn",
};

/// A chord as its key caps print it: "⌘K" and "⇧↓" on macOS, "Ctrl+K" and
/// "Shift+↓" elsewhere. Delete is "⌫" on macOS (the key that deletes there)
/// and "Del" elsewhere; Backspace is "⌫" on macOS too.
export function capOfChord(c: Chord): string {
  const key = c.key === "Delete" || (c.key === "Backspace" && mac())
    ? (mac() ? "⌫" : "Del")
    : CAPS[c.key] ?? c.key;
  const rest = mac()
    ? `${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${key}`
    : [c.alt ? "Alt" : "", c.shift ? "Shift" : "", key].filter(Boolean).join("+");
  if (!c.mod) return rest;
  return mac() ? `⌘${rest}` : `Ctrl+${rest}`;
}

/** A binding's caps, one per chord: ["⌘K"], or ["G", "P"] for a sequence. */
export function keyCaps(binding: string): string[] {
  return chordsOf(binding).map(capOfChord);
}

/// `aria-keyshortcuts` for a command's bindings: "Meta+K", "Delete Backspace".
/// A sequence has no form there and is left out; undefined when none is left.
export function ariaKeys(bindings: readonly string[]): string | undefined {
  const out = bindings.filter((b) => !isSequence(b)).map((b) => {
    const c = parseChord(b);
    return [c.mod ? (mac() ? "Meta" : "Control") : "", c.alt ? "Alt" : "", c.shift ? "Shift" : "", c.key].filter(Boolean).join("+");
  });
  return out.length > 0 ? out.join(" ") : undefined;
}
