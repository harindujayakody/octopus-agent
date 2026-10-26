import type { RefObject } from "react";
import { Combobox, Popover, type ComboboxOption } from "@proxyshard/shardx-ui-kit";

/// A property's picker (O4, plan ruling 4): a searchable list in a popover
/// that grows from the value it belongs to. Arrows, typing and Enter pick; a
/// pick applies and closes it, and focus goes back to the value. No padding:
/// the search row runs edge to edge over the list, as in the Filters menu.
/// With `onCreate`, a typed name that matches nothing offers to create it as
/// the last row, as the tag picker does; creating closes it too.
export function ComboPopover({ open, onOpenChange, anchorRef, label, options, value, onChange, emptyText, placeholder, onCreate, createLabel, width = 260 }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  emptyText?: string;
  placeholder?: string;
  onCreate?: (name: string) => void;
  createLabel?: (name: string) => string;
  /** 260 (the Filters menu and the tag picker) or 320 (a proxy's picker). */
  width?: 260 | 320;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchorRef={anchorRef} align="start" aria-label={label}>
      <div style={{ width }}>
        <Combobox
          aria-label={label}
          options={options}
          value={value}
          emptyText={emptyText}
          placeholder={placeholder}
          autoFocus
          onChange={(v: string) => { onChange(v); onOpenChange(false); anchorRef.current?.focus(); }}
          onCreate={onCreate && ((name: string) => { onCreate(name); onOpenChange(false); anchorRef.current?.focus(); })}
          createLabel={createLabel}
        />
      </div>
    </Popover>
  );
}
