import { useRef, useState } from "react";
import { ACCENT_HEX, LABEL_COLORS } from "../../../../shared/constants";
import { ColorPicker } from "../../../../shared/ui/ColorPicker";
import { labelNames } from "../../../../shared/ui/ColorRadios";
import { MULTICOLOR } from "../../../../shared/ui/AccentRadios";
import { PropertyButton, PropertyRow } from "../../../../shared/ui/peek";
import { useT } from "../../../../shared/i18n";

/// A profile's color as a property row: the swatch and its name, opening the
/// color picker in place. "" is Automatic (derived from the name).
export function ColorRow({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const t = useT();
  const names = labelNames(t);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const known = LABEL_COLORS.find((c) => ACCENT_HEX[c.id].toLowerCase() === value.toLowerCase());
  const name = !value ? t("colorSwatches.autoTitle") : known ? names[known.id] : t("accent.custom");
  return (
    <PropertyRow id="color" label={t("inlineEditor.colorLabel")}>
      {(labelId) => (
        <>
          <PropertyButton ref={anchor} labelledBy={labelId} expanded={open} onClick={() => setOpen((v) => !v)}>
            {/* The swatch the picker shows checked: a color, or Automatic's circle of the eight. */}
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="size-[10px] rounded-full ring-1 ring-inset ring-stroke-image forced-content" style={{ background: value || MULTICOLOR }} />
            </span>
            <span className="truncate">{name}</span>
          </PropertyButton>
          <ColorPicker open={open} onOpenChange={setOpen} anchorRef={anchor} label={t("inlineEditor.colorLabel")} value={value} onChange={onChange} />
        </>
      )}
    </PropertyRow>
  );
}
