import { useRef, type ReactNode } from "react";
import { Badge, Button, Tag } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../i18n";
import type { FilterChip } from "./types";

/// The applied filters as chips under the header (O8, CRAFT-08): the user
/// sees why rows are missing and takes one off in one click. Nothing renders
/// while no filter applies and there is nothing `after` (a list's own
/// actions, such as Save as view…, which can stand alone). The chips are
/// fill and text, no ring (owner: borderless chips). A removed chip hands
/// the keyboard to the chip that takes its place, or to the Filters button
/// once none is left, so focus never falls to the page. `lock`: what the
/// list's own View already filters by, said once ("View: Running") as a label
/// before the chips. It is not a chip: no remove button, not a stop for the
/// keyboard, and Clear filters leaves it.
export function FilterChips({ chips, onClear, after, lock }: { chips: FilterChip[]; onClear: () => void; after?: ReactNode; lock?: string | null }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const some = chips.length > 0;
  if (!some && !after && !lock) return null;

  // After the list has drawn without the chip.
  const refocus = (index: number) => requestAnimationFrame(() => {
    const removes = root.current?.querySelectorAll<HTMLElement>("[data-chip] button");
    const next = removes?.length ? removes[Math.min(index, removes.length - 1)] : document.querySelector<HTMLElement>("[data-filter-trigger]");
    next?.focus();
  });
  const holdsFocus = () => !!root.current?.contains(document.activeElement);

  return (
    <div ref={root} data-filter-chips role={some ? "group" : undefined} aria-label={some ? t("filters.applied") : undefined} className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
      {lock && (
        // The Tag's height, so the row does not change when the first chip joins.
        <Badge data-view-lock className="h-[21px] min-w-0 max-w-full"><span className="truncate">{lock}</span></Badge>
      )}
      {chips.map((c, i) => (
        <Tag
          key={c.id}
          data-chip={c.id}
          variant="gray"
          removeLabel={t("filters.remove", { filter: c.label })}
          onRemove={() => { const had = holdsFocus(); c.onRemove(); if (had) refocus(i); }}
        >
          {c.label}
        </Tag>
      ))}
      {some && (
        <Button
          variant="neutral"
          mode="ghost"
          size="3xsmall"
          onClick={() => { const had = holdsFocus(); onClear(); if (had) refocus(0); }}
        >
          {t("profileFilterBar.clear")}
        </Button>
      )}
      {after}
    </div>
  );
}
