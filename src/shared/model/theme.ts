import { useEffect } from "react";
import { useTheme, type Theme } from "@proxyshard/shardx-ui-kit";

// The kit keeps the theme in a React context. Commands run outside React, so
// the shell hands the current theme and its setters over here once.
let current: { theme: Theme; setTheme: (t: Theme) => void; setPreviewTheme: (t: Theme | null) => void } | null = null;

/** Mount once inside the kit's ThemeProvider (the app shell). */
export function useThemeBridge(): void {
  const { theme, setTheme, setPreviewTheme } = useTheme();
  useEffect(() => {
    current = { theme, setTheme, setPreviewTheme };
  }, [theme, setTheme, setPreviewTheme]);
}

/** The chosen (stored) theme; a preview is not it. */
export function currentTheme(): Theme | null {
  return current?.theme ?? null;
}

export function setThemeFromCommand(theme: Theme): void {
  current?.setTheme(theme);
}

/** Shows `theme` without storing it; null shows the chosen theme again (Settings, until Save). */
export function previewThemeFromSettings(theme: Theme | null): void {
  current?.setPreviewTheme(theme);
}
