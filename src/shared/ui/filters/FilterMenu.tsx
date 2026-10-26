import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Combobox, IconButton, Popover, Tooltip, useLatched } from "@proxyshard/shardx-ui-kit";
import { BackIcon, FilterIcon } from "../../icons";
import { useT } from "../../i18n";
import type { FilterField } from "./types";
import { rankValues } from "./rank";

/** `rankValues` has already matched and ordered the values. */
const ranked = () => true;

/// The Filters button and its menu (O8, CRAFT-08): first the fields, then a
/// field's values, each with how many rows it would list, and a search that
/// ranks them (`rankValues`). The value applied has the check at the row end.
/// Enter picks the top one; picking the value already applied takes it off;
/// Backspace in an empty search, or Back,
/// returns to the fields. A pick closes the menu and the button keeps the
/// keyboard. The list's own chips (`FilterChips`) show what is applied.
export function FilterMenu({ open, onOpenChange, fields, activeCount, label, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Built only while the menu is open; the menu keeps the last ones while it fades out. */
  fields: FilterField[];
  activeCount: number;
  label: string;
  /** Under the list of fields: the way to change a locked one (Edit view). */
  footer?: ReactNode;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = useLatched(open ? fields : null) ?? fields;
  const field = shown.find((f) => f.id === fieldId) ?? null;
  const values = useMemo(() => (field ? rankValues(field.values, query) : []), [field, query]);
  // Each opening starts on the fields; reset on open, not on close, so the
  // panel does not change under its fade-out.
  const setOpen = (next: boolean) => {
    if (next) { setFieldId(null); setQuery(""); }
    onOpenChange(next);
  };
  const back = () => { setFieldId(null); setQuery(""); };
  const words = activeCount > 0 ? t("profileFilterBar.filtersCount", { n: activeCount }) : t("profileFilterBar.filters");

  return (
    <>
      {/* Its words in a tooltip only while a narrow header shows its icon alone. */}
      <Tooltip content={words} whenTruncated>
        <Button
          ref={trigger}
          data-filter-trigger
          variant={activeCount > 0 ? "primary" : "neutral"}
          mode="stroke"
          size="xsmall"
          leftIcon={<FilterIcon className="size-3.5" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {words}
        </Button>
      </Tooltip>
      {/* No padding: the search row runs edge to edge over the list, as in
          every searchable Select. 260 px, the width the form had. */}
      <Popover open={open} onOpenChange={setOpen} anchorRef={trigger} align="end" aria-label={label} className="w-[260px]">
        {field === null ? (
          <div className="flex flex-col">
            <Combobox
              key="fields"
              aria-label={t("filters.fields")}
              placeholder={t("filters.searchFields")}
              autoFocus
              query={query}
              onQueryChange={setQuery}
              value={null}
              options={shown.map((f) => ({
                value: f.id,
                label: f.label,
                icon: f.icon,
                // A field the View sets stays in view but out of reach, and says why.
                disabled: f.locked,
                // What the field is set to, at the row end.
                hint: f.locked ? t("filters.lockedHint") : f.current !== null ? f.values.find((v) => v.value === f.current)?.label : undefined,
              }))}
              onChange={(id: string) => { setFieldId(id); setQuery(""); }}
            />
            {footer}
          </div>
        ) : (
          <div
            className="flex flex-col"
            onKeyDown={(e) => {
              if (e.key === "Backspace" && query === "" && !e.nativeEvent.isComposing) { e.preventDefault(); back(); }
            }}
          >
            {/* 6 px in: the Back button's ring stays clear of the panel's
                rounded corner, which clips (owner: rings never cut off). */}
            <div className="flex items-center gap-1.5 px-[6px] pt-[6px]">
              <IconButton size="3xsmall" label={t("filters.back")} icon={<BackIcon className="size-3.5" />} onClick={back} />
              <span className="min-w-0 truncate text-field-label text-text-sub-600">{field.label}</span>
            </div>
            <Combobox
              key={field.id}
              aria-label={field.label}
              placeholder={t("filters.searchValues")}
              autoFocus
              query={query}
              onQueryChange={setQuery}
              value={field.current}
              emptyText={field.values.length === 0 ? t("filters.noValues") : undefined}
              filter={ranked}
              options={values.map((v) => ({
                value: v.value,
                label: v.label,
                icon: v.icon,
                content: v.content,
                keywords: v.keywords,
                hint: v.count !== undefined ? String(v.count) : undefined,
              }))}
              onChange={(v: string) => {
                field.set(v === field.current ? null : v);
                setOpen(false);
                trigger.current?.focus();
              }}
            />
          </div>
        )}
      </Popover>
    </>
  );
}
