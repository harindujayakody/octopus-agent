import { LABEL_COLORS, ACCENT_HEX } from "../constants";
import { onRadioKeys } from "../lib/radioKeys";
import { useT } from "../i18n";
import { Swatch } from "./Swatch";
import { labelNames } from "./ColorRadios";

/** Automatic still paints a color, one the name picks: the eight colors
 *  around a circle (the macOS Multicolor accent), never "No color"'s X. */
export const MULTICOLOR = `conic-gradient(${[...LABEL_COLORS, LABEL_COLORS[0]].map((c) => ACCENT_HEX[c.id]).join(", ")})`;

/// The profile accent: Automatic (from the name, as the browser does), or one
/// of the eight label colors. A stored color outside the eight shows as
/// "Custom" until changed (plan ruling 28). "" is Automatic.
export function AccentRadios({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const t = useT();
  const names = labelNames(t);
  const known = LABEL_COLORS.some((c) => ACCENT_HEX[c.id].toLowerCase() === value.toLowerCase());
  const options = [
    { value: "", color: MULTICOLOR as string | null, name: t("colorSwatches.autoTitle") },
    ...LABEL_COLORS.map((c) => ({ value: ACCENT_HEX[c.id], color: ACCENT_HEX[c.id] as string | null, name: names[c.id] })),
    ...(value && !known ? [{ value, color: value as string | null, name: t("accent.custom") }] : []),
  ];
  const at = Math.max(0, options.findIndex((o) => o.value.toLowerCase() === value.toLowerCase()));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap items-center gap-[5px]"
      onKeyDown={(e) => onRadioKeys(e, options.map((o) => o.value), options[at].value, onChange)}
    >
      {options.map((o, i) => (
        <Swatch key={o.value || "auto"} color={o.color} name={o.name} checked={i === at} tabbable={i === at} onSelect={() => onChange(o.value)} />
      ))}
    </div>
  );
}
