import { useEffect } from "react";
import {
  allCommands, applies, chordsOf, eventDigit, isSequence, matchesChord, matchesSequenceStep, parseChord, type Command,
} from "../../shared/commands";
import { isMod, keyboardIsTaken, overlayHasKeyboard } from "../../shared/lib/keyboard";
import { useNav } from "../../shared/model/navigation";
import { useKeyPrefs } from "../../shared/model/keyPrefs";
import { folderNamesOf, leaveList, useProfile, useProfileUi } from "../../entities/profile";
import { runCommand } from "./surfaces";

/** How long a sequence's first key waits for its second. */
const SEQUENCE_WAIT_MS = 1500;
const MODIFIER_KEYS = new Set(["Shift", "CapsLock", "Control", "Alt", "Meta", "AltGraph"]);
const NONE = { ids: [] as string[] };

/// The commands whose keys work outside the list: anywhere, or on their page.
/// The page-wide single keys (C, /, ?, G) only while the Single-key shortcuts
/// switch is on (O14, WCAG 2.1.4); Mod keys and the list's own keys stay.
function appKeyed(): Command[] {
  const section = useNav.getState().section;
  const singleOn = useKeyPrefs.getState().singleKeys;
  return allCommands().filter((c) => c.keys && c.run && !c.keyOwner && (singleOn || !c.singleKey)
    && (c.keyWhere === "app" || (c.keyWhere === "page" && (!c.page || c.page === section))));
}
const chordHit = (e: KeyboardEvent, c: Command) => c.keys!.some((k) => !isSequence(k) && matchesChord(e, parseChord(k)));

/// Mod+1..9: the first nine Folders in sidebar order, by the digit key's
/// place (PC-044). Mod+0 is `nav.profiles`.
function openFolderByDigit(e: KeyboardEvent): boolean {
  const digit = eventDigit(e);
  if (digit === null || digit === "0") return false;
  const d = useProfile.getState();
  const folder = folderNamesOf(d.profiles, d.folderRegistry)[Number(digit) - 1];
  if (!folder) return false;
  void leaveList(() => {
    useProfileUi.getState().setFolder(folder);
    void useNav.getState().setSection("profiles", { focus: true });
  });
  return true;
}

/// The app's own keys, from the registry (IFACE gap 1, A11Y-02): Mod+K and
/// Mod+0..9 even from a text field (another overlay keeps the keyboard); `?`,
/// the G sequences, `/` and a page's `C` outside fields and overlays. It
/// listens in the capture phase, before the list: a sequence's second key is
/// taken whole, so G then S never starts a profile. The list's own keys are
/// the grid's (`dispatchListKey`).
export function useAppKeys() {
  useEffect(() => {
    let pending: { first: string; timer: ReturnType<typeof setTimeout> } | null = null;
    const drop = () => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      // Shift or Caps Lock on its own neither ends a sequence nor starts one.
      if (MODIFIER_KEYS.has(e.key)) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const commands = appKeyed();

      // Keys that work in fields too. The palette's own key also closes it.
      const inField = commands.find((c) => c.inFields && chordHit(e, c));
      const folderDigit = !inField && isMod(e) && !e.shiftKey && !e.altKey && eventDigit(e) !== null;
      if (inField || folderDigit) {
        if (overlayHasKeyboard(inField?.id === "app.palette" ? "[data-palette]" : undefined)) return;
        e.preventDefault();
        drop();
        // A held Cmd+K opens once (PC-106).
        if (e.repeat) return;
        if (inField) void runCommand(inField, NONE, { from: "keys" });
        else openFolderByDigit(e);
        return;
      }

      if (keyboardIsTaken(target)) { drop(); return; }
      // A held key's repeats neither end a sequence nor run anything again.
      if (e.repeat) return;

      if (pending) {
        const first = pending.first;
        drop();
        const hit = commands.find((c) => c.keys!.some((k) => {
          if (!isSequence(k)) return false;
          const [a, b] = chordsOf(k);
          return a.key === first && matchesSequenceStep(e, b);
        }));
        if (hit) {
          // Taken whole: the list's own P (proxy) and S (start) must not see it.
          e.preventDefault();
          e.stopPropagation();
          void runCommand(hit, NONE, { from: "keys" });
          return;
        }
        // Any other key does its own job below (another G starts over).
      }

      for (const c of commands) {
        if (c.inFields || !chordHit(e, c)) continue;
        // A page's single keys stay out of Peek, as the list's do.
        if (c.keyWhere === "page" && target?.closest("[data-peek]")) continue;
        if (!applies(c, NONE)) continue;
        e.preventDefault();
        void runCommand(c, NONE, { from: "keys" });
        return;
      }

      const starts = commands.find((c) => c.keys!.some((k) => isSequence(k) && matchesSequenceStep(e, chordsOf(k)[0])));
      if (starts) {
        e.preventDefault();
        const first = chordsOf(starts.keys!.find(isSequence)!)[0].key;
        pending = { first, timer: setTimeout(drop, SEQUENCE_WAIT_MS) };
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      drop();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
