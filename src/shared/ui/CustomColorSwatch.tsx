import { useRef, useState } from "react";
import { Button, Input, Popover } from "@proxyshard/shardx-ui-kit";
import { isHexColor } from "../constants";
import { useT } from "../i18n";
import { Swatch } from "./Swatch";
import { MULTICOLOR } from "./AccentRadios";

/// A color of the person's own, beside the palette's swatches (Tags): a
/// swatch that shows the custom color when one is set (else the multicolor
/// circle) and opens a field for its hex. Apply sets it; a value that is not
/// "#rrggbb" is not taken.
export function CustomColorSwatch({ value, onChange, label }: { value: string; onChange: (hex: `#${string}`) => void; label: string }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const custom = isHexColor(value);
  const [draft, setDraft] = useState<string>(custom ? value : "#");
  const shown = draft.startsWith("#") ? draft : `#${draft}`;
  const valid = isHexColor(shown);
  const apply = () => {
    if (!isHexColor(shown)) return;
    onChange(shown.toUpperCase() as `#${string}`);
    setOpen(false);
  };
  return (
    <>
      <Swatch
        ref={anchor}
        color={custom ? value : MULTICOLOR}
        name={custom ? t("accent.customNamed", { hex: value.toUpperCase() }) : t("accent.customPick")}
        checked={custom}
        tabbable={custom}
        onSelect={() => { setDraft(custom ? value : "#"); setOpen(true); }}
      />
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} align="start" aria-label={label} className="flex w-[220px] flex-col gap-2 p-3">
        <div className="flex items-end gap-2">
          <span
            aria-hidden="true"
            className="mb-[5px] size-[21px] shrink-0 rounded-full ring-1 ring-inset ring-stroke-image forced-content"
            style={{ background: valid ? shown : "transparent" }}
          />
          <Input
            label={t("accent.hexLabel")}
            inputSize="xsmall"
            wrapperClassName="min-w-0 flex-1 gap-[6px]"
            className="mono"
            placeholder="#3B82F6"
            maxLength={7}
            value={draft}
            onChange={(e) => setDraft(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
          />
        </div>
        <div className="flex justify-end">
          <Button variant="primary" mode="filled" size="xsmall" disabled={!valid} onClick={apply}>
            {t("accent.apply")}
          </Button>
        </div>
      </Popover>
    </>
  );
}
