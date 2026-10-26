import { useRef, type RefObject } from "react";
import { Popover } from "@proxyshard/shardx-ui-kit";
import { AccentRadios } from "./AccentRadios";

/// The accent picker a property row opens in place (Task 14): the same
/// swatches as everywhere, in a popover. A pick applies and closes it; an
/// arrow applies and stays, so the keys can walk the colors (a radio group's
/// arrows move the choice and the focus together).
export function ColorPicker({ open, onOpenChange, anchorRef, label, value, onChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const byArrow = useRef(false);
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchorRef={anchorRef} align="start" aria-label={label} className="p-3 [--swatch-bg:var(--bg-popover)]">
      <div onKeyDownCapture={(e) => { byArrow.current = e.key.startsWith("Arrow"); }}>
        <AccentRadios
          label={label}
          value={value}
          onChange={(v) => {
            onChange(v);
            if (!byArrow.current) onOpenChange(false);
            byArrow.current = false;
          }}
        />
      </div>
    </Popover>
  );
}
