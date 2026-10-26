/// The fixed palette for Folders (and, in Phase 4, Tags). Stored by id; each
/// theme has its own shade (`--label-<id>` in index.css) so every color keeps
/// 3:1 contrast on the light and the dark surface (WCAG 2.2 non-text).
export const LABEL_COLORS = [
  { id: "blue", css: "var(--label-blue)" },
  { id: "violet", css: "var(--label-violet)" },
  { id: "magenta", css: "var(--label-magenta)" },
  { id: "red", css: "var(--label-red)" },
  { id: "orange", css: "var(--label-orange)" },
  { id: "yellow", css: "var(--label-yellow)" },
  { id: "green", css: "var(--label-green)" },
  { id: "sky", css: "var(--label-sky)" },
] as const;

export type LabelColorId = (typeof LABEL_COLORS)[number]["id"];

/** The CSS color for a palette id, or undefined for none/unknown. */
export function labelColor(id: string | null | undefined): string | undefined {
  return LABEL_COLORS.find((c) => c.id === id)?.css;
}

/** The profile accent is a hex the engine paints (the window icon, the
 *  omnibox pill): one fixed value per label color, the palette's saturated
 *  step, so the accent and the labels are one palette (UI-33). */
export const ACCENT_HEX: Record<LabelColorId, string> = {
  blue: "#3B82F6", violet: "#724FFF", magenta: "#E040C8", red: "#F04438",
  orange: "#F97316", yellow: "#EAB308", green: "#12B76A", sky: "#0BA5EC",
};
