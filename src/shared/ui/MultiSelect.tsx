import { useMemo, useRef, useState } from "react";
import { Button, Combobox, Popover, type ComboboxOption } from "@proxyshard/shardx-ui-kit";
import { ChevronDownIcon } from "../icons";
import { useT } from "../i18n";

export type MSOption = { value: string; label: string };

// "Any" is a row of its own: it is checked when nothing is, and picking it clears.
const ANY = "\u0000any";

/** A searchable multi-select on the kit Combobox (IFACE-04). The value is a
 *  comma-separated list of option values ("" means "any"); several picked
 *  means the runner chooses one at random each run. `single`: one choice,
 *  picking replaces the value and closes. */
export function MultiSelect({ value, onChange, options, loading, disabled, placeholder, emptyLabel: emptyLabelProp, single }: {
  value: string;
  onChange: (v: string) => void;
  options: MSOption[];
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  /** One choice only: picking replaces the value and closes. */
  single?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const emptyLabel = emptyLabelProp ?? t("multiSelect.anyLabel");
  const chosen = value.split(",").map((s) => s.trim()).filter(Boolean);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  // One list for the life of the options, so a pick keeps the highlight
  // where it is (the arrows go on from the row just picked).
  const rows = useMemo<ComboboxOption[]>(() => [
    { value: ANY, label: emptyLabel },
    ...options.map((o) => ({ value: o.value, label: o.label, hint: o.value !== o.label ? o.value : undefined, keywords: [o.value] })),
  ], [options, emptyLabel]);
  const name = placeholder ?? emptyLabel;
  const emptyText = loading ? t("multiSelect.loading") : t("multiSelect.noMatches");

  return (
    <div className="flex-1">
      <Button
        ref={trigger}
        variant="neutral"
        mode="stroke"
        size="2xsmall"
        contentAlign="start"
        className="w-full"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        rightIcon={<ChevronDownIcon className="size-3.5" />}
        onClick={() => setOpen((v) => !v)}
      >
        {chosen.length === 0
          ? <span className="text-text-soft-400">{name}</span>
          : chosen.length <= 3 ? chosen.map(labelOf).join(", ") : t("multiSelect.selectedCount", { n: chosen.length })}
      </Button>
      {/* 224 px wide and 252 px at most, as the list it replaces: the
          35 px field over a list of 216 px at most. */}
      <Popover open={open} onOpenChange={setOpen} anchorRef={trigger} aria-label={name} className="w-[224px]">
        {single ? (
          <Combobox
            aria-label={name}
            options={rows}
            value={chosen[0] ?? ANY}
            onChange={(v) => { onChange(v === ANY ? "" : v); setOpen(false); }}
            emptyText={emptyText}
            maxListHeight={216}
          />
        ) : (
          <Combobox
            multiple
            aria-label={name}
            options={rows}
            value={chosen.length === 0 ? [ANY] : chosen}
            onChange={(v, checked) => {
              if (v === ANY) { onChange(""); return; }
              onChange((checked ? [...chosen, v] : chosen.filter((x) => x !== v)).join(","));
            }}
            emptyText={emptyText}
            maxListHeight={216}
          />
        )}
      </Popover>
    </div>
  );
}
