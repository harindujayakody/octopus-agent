import { LABEL_COLORS, labelColor, type LabelColorId } from "../constants";
import { onRadioKeys } from "../lib/radioKeys";
import { useT } from "../i18n";
import { Swatch } from "./Swatch";

/** The eight label colors' names, called literally so the i18n check sees them. */
export const labelNames = (t: (key: string) => string): Record<LabelColorId, string> => ({
  blue: t("labelColors.blue"), violet: t("labelColors.violet"), magenta: t("labelColors.magenta"), red: t("labelColors.red"),
  orange: t("labelColors.orange"), yellow: t("labelColors.yellow"), green: t("labelColors.green"), sky: t("labelColors.sky"),
});

/// The eight label colors as a radio group of swatches (Folders and Tags).
/// `allowNone` puts "No color" first; without it `onChange` never gets null.
export function ColorRadios({
  label, value, onChange, allowNone,
}: {
  label: string;
  value: LabelColorId | null;
  onChange: (v: LabelColorId | null) => void;
  allowNone?: boolean;
}) {
  const t = useT();
  const names = labelNames(t);
  const options = [...(allowNone ? [null] : []), ...LABEL_COLORS.map((c) => c.id)] as (LabelColorId | null)[];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap items-center gap-[5px]"
      onKeyDown={(e) => onRadioKeys(e, options, value, onChange)}
    >
      {options.map((id) => (
        <Swatch
          key={id ?? "none"}
          color={id ? labelColor(id)! : null}
          name={id ? names[id] : t("folderDialog.noColor")}
          checked={value === id}
          // Nothing chosen yet (a stored color this build doesn't know): the first takes Tab.
          tabbable={value === id || (id === options[0] && !options.includes(value))}
          onSelect={() => onChange(id)}
        />
      ))}
    </div>
  );
}
