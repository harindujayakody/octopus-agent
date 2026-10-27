import { useEffect, useMemo } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { PropertyRow } from "../../../../shared/ui/peek";
import { bookmarkSets, useBookmarks } from "../../../../entities/bookmark";
import { useT } from "../../../../shared/i18n";

/// The bookmark sets this profile takes ("Facebook", "Pinterest"…), each a
/// toggle. A bookmark in no set reaches it anyway, by its Folder; a set's
/// bookmarks only when it is on here.
export function BookmarkSetsRow({ value, onChange }: { value: string[]; onChange: (sets: string[]) => void }) {
  const t = useT();
  const init = useBookmarks((s) => s.init);
  const items = useBookmarks((s) => s.items);
  useEffect(() => { init(); }, [init]);
  // Sets the bookmarks name, and any this profile still picks though its bookmarks are gone.
  const sets = useMemo(() => [...new Set([...bookmarkSets(items), ...value])].sort((a, b) => a.localeCompare(b)), [items, value]);
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <PropertyRow id="bookmark-sets" label={t("profileForm.bookmarkSets")}>
      {(labelId) => sets.length === 0 ? (
        <span className="flex h-[28px] min-w-0 items-center truncate px-1.5 text-ui text-text-soft-400">{t("profileForm.bookmarkSetsNone")}</span>
      ) : (
        <div role="group" aria-labelledby={labelId} data-bookmark-sets className="flex min-w-0 flex-1 flex-wrap gap-1.5 px-1.5 py-1">
          {sets.map((s) => {
            const on = value.includes(s);
            return (
              <Button key={s} variant={on ? "primary" : "neutral"} mode={on ? "lighter" : "stroke"} size="3xsmall" aria-pressed={on} onClick={() => toggle(s)}>
                {s}
              </Button>
            );
          })}
        </div>
      )}
    </PropertyRow>
  );
}
