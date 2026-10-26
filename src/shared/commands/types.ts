import type { ComponentType } from "react";
import type { Section } from "../types";

/** Whose command it is: a list's, a page's, the app's, or the palette's own keys. */
export type CommandArea = "profiles" | "proxies" | "folders" | "trash" | "bookmarks" | "app" | "palette";
/// What it acts on. "selection": the selection, else the active row (IFACE-05).
/// "active": exactly one row. "page": the page. "global": nothing in particular.
export type CommandScope = "selection" | "active" | "page" | "global";
/// Where its key works. "list": only while the list has the keyboard (WCAG 2.1.4,
/// active only on focus). "page": on its page, outside fields and overlays.
/// "app": anywhere outside fields and overlays.
export type KeyWhere = "list" | "page" | "app";
/** The places that list commands. */
export type Surface =
  | "rowMenu" | "hover" | "bulkBar" | "bulkMore" | "pageMenu" | "pinnedMenu" | "peekMenu"
  | "palette" | "paletteActions" | "sheet";
/** Menus group commands and separate the groups; the sheet orders by them. */
export type CommandGroup =
  | "run" | "open" | "organize" | "copy" | "danger" | "create" | "select" | "move"
  | "navigate" | "settings" | "view" | "help";
/** The rows (or proxies, or Trash entries) a command acts on. */
export type Subject = { ids: string[] };
export type RunFrom = Surface | "keys";
export type RunContext = { from: RunFrom };

export type Command = {
  /** "profile.start", "proxy.test", "nav.proxies". */
  id: string;
  area: CommandArea;
  /** The page it belongs to (the sheet lists its page first; page keys work there). */
  page?: Section;
  scope: CommandScope;
  group: CommandGroup;
  /** Verb first, sentence case (WRITE-26). `n`: how many it acts on. */
  label: (n: number) => string;
  /** The palette's words for its subject, when they name it ("Edit Profile 7"); else `label`. */
  paletteLabel?: (s: Subject) => string;
  /** A menu's words for its subject, when they differ from `label` ("View" for a profile only read). */
  menuLabel?: (s: Subject) => string;
  /** Every binding matches; the first is the one surfaces print. */
  keys?: readonly string[];
  /** How the sheet joins several bindings: "or" ("Enter / Space"), "to" ("⌘1–⌘9"); default side by side ("↑ ↓"). */
  keysJoin?: "or" | "to";
  /** Where the key works; default "list". */
  keyWhere?: KeyWhere;
  /** A component handles the key itself (arrows, Esc, Mod+Z); listed, never dispatched. */
  keyOwner?: "self";
  /** A page-wide single key (C, /, ?, G): off with the Single-key shortcuts switch (O14). */
  singleKey?: boolean;
  /** Works even while a text field has the keyboard (Mod+K). */
  inFields?: boolean;
  icon?: ComponentType<{ className?: string }>;
  danger?: boolean;
  /** More words the palette finds it by ("theme" for the theme commands). */
  keywords?: () => string[];
  surfaces: readonly Surface[];
  /** Applies to this subject; menus, the palette and the keys list only what applies. */
  when?: (s: Subject) => boolean;
  /** Applies but cannot run now: why (a disabled item's hint, EMIL-05). */
  disabled?: (s: Subject) => string | null;
  /** It puts the keyboard somewhere (an editor, a dialog, Peek, an in-app
   *  picker): the palette runs it a frame after handing the keyboard back,
   *  so it keeps it (PC-108). Every other command runs at once (Pair 45
   *  review, I3). */
  focusAfter?: boolean;
  /** Does it. The ids it answers with are the ones that failed, for the toast
   *  that reports them; the selection stays exactly as it was, never narrowed
   *  or cleared (owner rule: bulk actions keep the selection; ORDER R26 a). */
  run?: (s: Subject, ctx: RunContext) => void | Promise<void | string[]>;
};
