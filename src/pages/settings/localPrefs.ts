import type { Theme } from "@proxyshard/shardx-ui-kit";
import { savedLang, useLang, type Lang } from "../../shared/i18n";
import { savedInterfaceSize, useInterfaceSize, type InterfaceSizeChoice } from "../../shared/model/interfaceSize";
import { useDirectStart } from "../../shared/model/directStart";
import { useKeyPrefs } from "../../shared/model/keyPrefs";
import { savedMotion, useMotion } from "../../shared/model/motion";
import { currentTheme, previewThemeFromSettings, setThemeFromCommand } from "../../shared/model/theme";

/// The preferences this window keeps in its own storage rather than in
/// settings.json. They join the Settings draft (manual save, owner
/// 2026-10-07): the language, theme, interface size and reduced motion are
/// shown at once as a preview, and none of them is stored until Save; the
/// rest change nothing until Save.
export type LocalPrefs = {
  lang: Lang;
  theme: Theme;
  size: InterfaceSizeChoice;
  reduceMotion: boolean;
  singleKeys: boolean;
  askDirect: boolean;
};
export type PrefKey = keyof LocalPrefs;

type Pref<V> = {
  /** What is stored. */
  stored: () => V;
  /** Shows a choice without storing it (the ones with a preview). */
  show?: (v: V) => void;
  /** Shows the stored choice again. */
  restore?: () => void;
  /** Stores it. */
  commit: (v: V) => void;
};

const PREFS: { [K in PrefKey]: Pref<LocalPrefs[K]> } = {
  lang: {
    stored: savedLang,
    show: (v) => useLang.getState().previewLang(v),
    restore: () => useLang.getState().previewLang(savedLang()),
    commit: (v) => useLang.getState().setLang(v),
  },
  theme: {
    stored: () => currentTheme() ?? "system",
    show: previewThemeFromSettings,
    restore: () => previewThemeFromSettings(null),
    commit: (v) => { setThemeFromCommand(v); previewThemeFromSettings(null); },
  },
  size: {
    stored: savedInterfaceSize,
    show: (v) => useInterfaceSize.getState().previewSize(v),
    restore: () => useInterfaceSize.getState().previewSize(savedInterfaceSize()),
    commit: (v) => useInterfaceSize.getState().setSize(v),
  },
  reduceMotion: {
    stored: savedMotion,
    show: (v) => useMotion.getState().previewReduce(v),
    restore: () => useMotion.getState().previewReduce(savedMotion()),
    commit: (v) => useMotion.getState().setReduce(v),
  },
  singleKeys: {
    stored: () => useKeyPrefs.getState().singleKeys,
    commit: (v) => useKeyPrefs.getState().setSingleKeys(v),
  },
  askDirect: {
    stored: () => useDirectStart.getState().ask,
    commit: (v) => useDirectStart.getState().setAsk(v),
  },
};

export const prefOf = <K extends PrefKey>(key: K): Pref<LocalPrefs[K]> => PREFS[key] as Pref<LocalPrefs[K]>;
export const PREF_KEYS = Object.keys(PREFS) as PrefKey[];
