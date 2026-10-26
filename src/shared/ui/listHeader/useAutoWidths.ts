import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { t, useLang } from "../../i18n";
import { editing } from "../../lib/editHold";
import { measureColumns, type ColumnDef, type ColumnFits, type CellText, type ContentWidths } from "../../lib/tableColumns";
import { fontsLoading, layoutWidths, measurer, readFonts } from "../../lib/textWidth";

/** How long a list's data rests before its columns are measured again, ms. */
const SETTLE_MS = 150;
/** The room a title keeps for its sort mark: the 4 px gap and the 14 px arrow (ListHeader). */
const SORT_MARK = 4 + 14;

/// Sizes a list's columns to their content (owner, 2026-09-30): each column
/// on screen with a fit takes the width its rows need, a rare long one left
/// out (`fitRoom`, `measureColumns`), over every row in `rows`, never only
/// the rows on screen, and at least its title's. The first rows are measured before
/// they paint, and so is a column as it is shown; a later change (a profile
/// added, renamed or removed, another Folder, View or filter) is measured
/// once the data has rested 150 ms, and never while the list scrolls, a
/// column's edge or title is being dragged, or the person edits (a field
/// that takes text has the keyboard, or a Peek save is on its way: autofit
/// review I2); it is measured once they let go. A width the person set wins
/// over this one (`layoutColumns`), and keeps winning.
export function useAutoWidths<Id extends string, Row>({ defs, shown, rows, fits, short, folded, listRef, sortable, onWidths }: {
  defs: readonly ColumnDef<Id>[];
  /** The columns on screen (`TableLayout.shown`): only they are measured. */
  shown: readonly Id[];
  /** The list as its Folder, View and filters make it, the search left
   *  out: typing never moves a column. A new array measures again. */
  rows: readonly Row[];
  /** Memoized by the caller: a new object measures again. */
  fits: ColumnFits<Id, Row>;
  /** What a column shows once the part that gives way first has moved into
   *  its tooltip (Proxies' Test result without its IP): its `short` width,
   *  every row whole. Memoized with `fits`. */
  short?: ColumnFits<Id, Row>;
  /** What a column that folds shows at its narrowest (Tags: one chip and
   *  "+N"; Folder: its chip): the least it gives way to, nine rows in ten
   *  whole (`ContentWidths.floor`). Memoized with `fits`. */
  folded?: ColumnFits<Id, Row>;
  /** The list's scroll box: its scrolling holds a measuring back, and its fonts are the ones measured. */
  listRef: React.RefObject<HTMLElement | null>;
  /** Columns whose title can show a sort mark: their floor keeps its room. */
  sortable?: (id: Id) => boolean;
  onWidths: (widths: ContentWidths<Id>) => void;
}) {
  const lang = useLang((s) => s.lang);
  const live = useRef(true);
  // The latest inputs, so a pending measuring reads them when it runs.
  const measure = useRef<() => void>(() => {});
  const scrolling = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Measures after a beat of rest, and not while anything holds it back.
  const later = useCallback(() => {
    clearTimeout(pending.current);
    pending.current = setTimeout(function settle() {
      if (!live.current) return;
      // A drag on a column's edge or title owns the widths until it ends.
      if (scrolling.current || document.documentElement.dataset.columnGesture !== undefined || editing()) {
        pending.current = setTimeout(settle, SETTLE_MS);
        return;
      }
      measure.current();
    }, SETTLE_MS);
  }, []);
  useLayoutEffect(() => {
    measure.current = () => {
      const list = listRef.current;
      if (!live.current || !list || rows.length === 0) return;
      const fonts = readFonts(list);
      const onScreen: ColumnFits<Id, Row> = {};
      for (const id of shown) if (fits[id]) onScreen[id] = fits[id];
      // The titles, laid out by the page in one go.
      const ids = defs.map((d) => d.id).filter((id) => onScreen[id]);
      const titles = layoutWidths(list, ids.map((id) => ({ text: defs.find((d) => d.id === id)!.title(t), role: "medium" })));
      const title = new Map(ids.map((id, i) => [id, titles[i] + (sortable?.(id) ? SORT_MARK : 0)]));
      // The canvas measures every row; the page lays out the few that decide.
      const floor = (id: Id) => title.get(id) ?? 0;
      const exact = (texts: readonly CellText[]) => layoutWidths(list, texts);
      const out = measureColumns(defs, rows, onScreen, measurer(fonts), floor, exact);
      const shortOnes: ColumnFits<Id, Row> = {};
      for (const id of ids) if (short?.[id]) shortOnes[id] = short[id];
      if (Object.keys(shortOnes).length > 0) out.short = measureColumns(defs, rows, shortOnes, measurer(fonts), floor, exact).full;
      // A folded cell's floor leaves its title out: a title cuts before a chip does.
      const foldOnes: ColumnFits<Id, Row> = {};
      for (const id of ids) if (folded?.[id]) foldOnes[id] = folded[id];
      if (Object.keys(foldOnes).length > 0) out.floor = measureColumns(defs, rows, foldOnes, measurer(fonts), () => 0, exact).fit;
      onWidths(out);
      // A web font that had not loaded yet was measured in its fallback:
      // measured again once it loads, held like any other change (review M3).
      void fontsLoading(fonts)?.then(later);
    };
  });

  // Scrolling holds a measuring back until it has stopped for a beat.
  useEffect(() => {
    live.current = true;
    const list = listRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      scrolling.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => { scrolling.current = false; }, SETTLE_MS);
    };
    list?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      live.current = false;
      list?.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      clearTimeout(pending.current);
    };
  }, [listRef]);

  // Whether the rows on screen now were measured: the first ones (a load, a
  // list that was empty) are, before they paint, and so is a column as it
  // is shown (the person's own act, nothing to wait for), so no width jumps in.
  const measured = useRef(false);
  const wasShown = useRef<readonly Id[]>([]);
  const shownKey = [...shown].sort().join(" ");
  useLayoutEffect(() => {
    const gained = shown.some((id) => !wasShown.current.includes(id));
    wasShown.current = shown;
    if (rows.length === 0) { measured.current = false; return; }
    if (!measured.current || gained) {
      measured.current = true;
      measure.current();
      return;
    }
    later();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` by its set, not its order
  }, [rows, fits, lang, shownKey]);
}
