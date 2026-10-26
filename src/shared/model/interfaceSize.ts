import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const KEY = "shardx.interfaceSize";

/** Settings > Appearance > Interface size (O15). */
export const INTERFACE_SIZES = [90, 100, 110, 125, 150] as const;
export type InterfaceSize = (typeof INTERFACE_SIZES)[number];
/** A size a person picked, or Auto: by the screen and the window, nothing stored (the default). */
export type InterfaceSizeChoice = InterfaceSize | "auto";

type Size = { width: number; height: number };

/// Auto by the screen in CSS px (OS scaling in it): 4K at 150% gets 125%, 4K at 100% 150%; an
/// ultrawide counts as its 16:9 part. Never so big that the window shows under 1280 x 800 (owner, 2026-10-23).
export function autoInterfaceSize(screen: Size, win?: Size): InterfaceSize {
  const wide = Math.min(screen.width, (screen.height * 16) / 9);
  const pick = wide >= 2800 ? 150 : wide >= 2200 ? 125 : 100;
  if (!win) return pick;
  return ([150, 125, 110] as const).find((n) => n <= pick && (win.width * 100) / n >= 1280 && (win.height * 100) / n >= 800) ?? 100;
}

/** The size a choice shows on this screen, in this window. */
export const sizeOf = (choice: InterfaceSizeChoice, screen: Size, win?: Size): InterfaceSize =>
  (choice === "auto" ? autoInterfaceSize(screen, win) : choice);

// CSS zoom on <html> changes none of these, so Auto never feeds on itself.
const autoNow = (): InterfaceSize => {
  try {
    return autoInterfaceSize({ width: screen.width, height: screen.height }, { width: innerWidth, height: innerHeight });
  } catch {
    return 100;
  }
};
/** Marks the one read that turns the old build's "100" (its "100% (default)") into Auto. */
const MARK = "shardx.interfaceSize.auto";

function readStored(): InterfaceSizeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (localStorage.getItem(MARK) === null) {
      localStorage.setItem(MARK, "1");
      if (raw === "100") { localStorage.removeItem(KEY); return "auto"; }
    }
    const n = Number(raw);
    return raw !== null && (INTERFACE_SIZES as readonly number[]).includes(n) ? (n as InterfaceSize) : "auto";
  } catch {
    return "auto";
  }
}

/** CSS zoom on <html>; --page-zoom lets viewport-relative sizes stay true. */
function apply(size: InterfaceSize) {
  const root = document.documentElement;
  if (size === 100) {
    root.style.removeProperty("zoom");
    root.style.removeProperty("--page-zoom");
  } else {
    root.style.setProperty("zoom", String(size / 100));
    root.style.setProperty("--page-zoom", String(size / 100));
  }
}

/** What is stored, whatever is shown. */
let saved = readStored();
export const savedInterfaceSize = (): InterfaceSizeChoice => saved;

/// The UI's size in this window. Kept in this window's storage, like Reduce
/// motion: a property of the screen the launcher is on, not of the backend.
/// `previewSize` shows a choice without storing it (Settings, until Save).
export const useInterfaceSize = create<{
  /** What is chosen: Settings shows it. */
  choice: InterfaceSizeChoice;
  /** What Auto picks for this window on the screen it is on now. */
  auto: InterfaceSize;
  /** The size shown. */
  size: InterfaceSize;
  setSize: (choice: InterfaceSizeChoice) => void;
  previewSize: (choice: InterfaceSizeChoice) => void;
  /** Reads the screen and the window again (moved or resized). */
  recheck: () => void;
}>((set, get) => {
  const show = (choice: InterfaceSizeChoice) => {
    const auto = autoNow();
    const size = choice === "auto" ? auto : choice;
    apply(size);
    set({ choice, auto, size });
  };
  return {
    choice: saved,
    auto: autoNow(),
    size: saved === "auto" ? autoNow() : saved,
    setSize: (choice) => {
      try {
        if (choice === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, String(choice));
      } catch { /* private mode: applies until reload */ }
      saved = choice;
      show(choice);
    },
    previewSize: show,
    recheck: () => {
      const s = get();
      if (autoNow() !== s.auto) show(s.choice);
    },
  };
});

/** Applies the stored size and follows the screen; run once at startup, in the main window only. */
export function applyStoredInterfaceSize() {
  apply(useInterfaceSize.getState().size);
  const recheck = () => useInterfaceSize.getState().recheck();
  window.addEventListener("resize", recheck);
  // A screen with another scale changes the pixel ratio.
  const watch = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { recheck(); watch(); }, { once: true });
  };
  watch();
  // A move to another screen of the same scale fires neither.
  if (isTauri()) {
    const w = getCurrentWindow();
    w.onMoved(recheck).catch(() => {});
    w.onScaleChanged(recheck).catch(() => {});
  }
}
