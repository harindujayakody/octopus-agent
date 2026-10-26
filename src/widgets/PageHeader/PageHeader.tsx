import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { IconButton, Input, cn } from "@proxyshard/shardx-ui-kit";
import { SearchIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { titleBarOnMouseDown } from "../../shared/lib/dragWindow";
import { setPageFilter } from "../../shared/lib/pageFilter";
import { ariaOf, command } from "../../features/commands";
import { HAS_CAPTIONS } from "../WindowControls";
import { usePageScrolled } from "./pageScroll";
import { useCompactActions } from "./compact";
import { PageHelpButton, type PageHelp } from "./PageHelp";
import { useScrollMemory } from "../../shared/model/scrollMemory";
import { useKeyPrefs } from "../../shared/model/keyPrefs";

type Filter = { value: string; onChange: (v: string) => void; placeholder?: string };

/** A count, or "shown of total" while a search or a filter narrows the list (CRAFT-18). */
export type HeaderCount = number | { shown: number; total: number };
export type { PageHelp };

/** A one-column page's width cap (`width="form"`, LAYOUT-04): 760 px, more in a wide window (app.css). */
const FORM_WIDTH = "var(--page-form-width)";
const CAPPED = { form: FORM_WIDTH } as const;

/// The top bar of every page: title, count, an info button, the page's view
/// controls, a filter field and one action cluster. On Windows and Linux it
/// keeps its right end clear for the caption buttons the Shell draws in the
/// window's corner (LAYOUT-08). It is a container (`@container`): the filter is
/// a search button at rest, at every width, and opens in place; the title is
/// the last thing to give way (LAYOUT-05). It draws its bottom rule only
/// while the page under it is scrolled (LQ-09). Its empty space drags the
/// window. `width="form"` goes with a PageBody of the same width: the
/// header's controls end where the page's one column ends, so the two share
/// a right edge (merge point 5 review); the header itself, its drag area
/// and its edge still span the window.
export function PageHeader({ title, lead, count, help, after, filter, actions, width = "full", titleTour }: {
  title: string;
  /** Drawn instead of the title block, for a page whose heading is more than
   *  a word (the Automation editor's path and editable name). It must hold
   *  the page's one h1, marked `data-page-title` with `tabIndex={-1}` as the
   *  title block's is (where the keyboard lands, A11Y-04); `title` still
   *  names the window. */
  lead?: ReactNode;
  count?: HeaderCount;
  /** What the page is for, behind the (i) beside its title: a click opens a
   *  popover with the title, two or three sentences and, when the page has a
   *  tour, "Show me around" (LAYOUT-19, clarity fixes item 7). */
  help?: PageHelp;
  /** Beside the title and count (a View's Modified and Reset). */
  after?: ReactNode;
  /** A filter field; "/" focuses it from anywhere outside a field or dialog. */
  filter?: Filter;
  actions?: ReactNode;
  width?: "full" | "form";
  /** The tour's key for the title (`data-tour`), for a step that points at
   *  the page when nothing smaller is there (Settings without its Save bar). */
  titleTour?: string;
}) {
  const t = useT();
  const filterRef = useRef<HTMLInputElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Too narrow for the actions' words: they give way to their icons before the title does.
  useCompactActions(headerRef, actionsRef);
  const hasFilter = filter !== undefined;
  const scrolled = usePageScrolled((s) => s.scrolled);
  // Folded at rest, at every width; open once asked for, and while it holds
  // text, so a filtered list never hides its search (owner, 2026-10-01).
  const [unfolded, setUnfolded] = useState(false);
  const open = unfolded || !!filter?.value;

  // The window title, and the Windows task switcher, name the page (A11Y-11).
  useEffect(() => { document.title = `${title} – Octopus Agent`; }, [title]);

  const focusFilter = () => {
    // Unfolded now, so the field is displayed and takes the keyboard before
    // this returns: a key typed right after "/" lands in it. On the next
    // frame, a quick first key went elsewhere (Pair 2, F2).
    flushSync(() => setUnfolded(true));
    filterRef.current?.focus();
    filterRef.current?.select();
  };

  // Mod+F opens it too, on a page that has a filter (not over a dialog).
  useEffect(() => {
    if (!hasFilter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.defaultPrevented) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      e.preventDefault();
      focusFilter();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasFilter]);

  // Esc clears a query first, then folds the field and hands focus back to the button.
  const onFilterKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (filter?.value) { filter.onChange(""); return; }
    flushSync(() => setUnfolded(false));
    searchBtnRef.current?.focus();
  };

  // "/" is a registry command (app.filter); it finds this field here.
  useEffect(() => (hasFilter ? setPageFilter(focusFilter) : undefined), [hasFilter]);

  const placeholder = filter?.placeholder ?? t("pageHeader.filter");
  // The filter's key, as the registry prints it (app.filter, E8); none while
  // the Single-key shortcuts switch is off (O14).
  useKeyPrefs((s) => s.singleKeys);
  const filterKeys = ariaOf(command("app.filter"));
  const countText = count === undefined ? null
    : typeof count === "number" ? String(count)
    : t("pageHeader.countOf", { shown: count.shown, total: count.total });

  return (
    // 52 px, its height before the 4 px grid (owner): 30 px controls
    // centered in it sit 11 px from the top and 10 from the 1 px rule laid
    // over its bottom edge, on whole pixels (UI-01). The rule is
    // transparent at rest; while the page body is scrolled a soft edge fades
    // in under the header instead (Live layer, spec 7: the kit's
    // scroll-edge, raised so it lies over the scrolled content). Reduce
    // transparency draws the hard rule, still only while scrolled (LQ-09).
    // Forced colors keep their system divider at rest too: Chromium reports
    // reduced transparency there, and the rule was a border the system drew
    // before it became the ::after (merge point 5).
    // No material-bar: the body scrolls in its own box below the header, and
    // a translucent white would only be a band. The body's box reaches 5 px
    // up under the header (PageBody's ring room), so while the page is
    // scrolled the header takes the page's own fill (`--bg-page`: the
    // ground in light, the panel in dark; borderless, owner 2026-10-01):
    // what scrolls through that room never shows under it.
    // On Windows and Linux the right padding is the caption buttons' 138 px
    // (CAPTION_ROOM) and 12 px of air; Tailwind reads class names statically,
    // so change the literal with the constant.
    // F6 moves between this, the sidebar, the content and Peek (A11Y-14).
    <header
      ref={headerRef}
      data-region="header"
      data-scrolled={scrolled || undefined}
      className={cn(
        "@container relative z-(--layer-raised) flex h-[52px] shrink-0 items-center gap-3 scroll-edge px-gutter data-[scrolled]:bg-bg-page [@media(prefers-reduced-transparency:reduce)_and_(forced-colors:none)]:not-data-[scrolled]:after:bg-transparent",
        HAS_CAPTIONS && "pe-[150px]",
      )}
      // The column's right edge: what the window has past the body's gutter
      // and its capped column, or the usual end room when that is less.
      style={width !== "full" ? { paddingInlineEnd: `max(${HAS_CAPTIONS ? "150px" : "var(--spacing-gutter)"}, calc(100% - ${CAPPED[width]} - var(--spacing-gutter)))` } : undefined}
      onMouseDown={titleBarOnMouseDown}
    >
      {/* Up to 40% of the header, and the last thing to give way: it does
          not shrink, so the filter (shrink weight 1000) and `after` give way
          first, and only its cap cuts a long title. Narrower still,
          compact.ts takes the actions' words away and lifts the cap (60%,
          then none); only at its last level does the title shrink, so the
          header never runs over (data-compact). */}
      {lead ?? <div data-title-block className="flex min-w-0 max-w-[40%] shrink-0 items-baseline gap-2 in-data-[compact=1]:max-w-[60%] in-data-[compact=2]:max-w-none in-data-[compact=3]:max-w-none in-data-[compact=3]:shrink">
        {/* Where the keyboard lands on a page opened from the keys, and
            after what held it left (A11Y-04): focusable from code only. Its
            ring is the outline every stop draws, on keyboard focus only: a
            focus after a click is marked `data-pointer-focus` (focusPageStart)
            and app.css leaves its ring off. */}
        <h1 data-page-title data-tour={titleTour} tabIndex={-1} className="m-0 min-w-0 truncate text-page-title text-text-strong-950 focus-ring">{title}</h1>
        {countText !== null && (
          <span data-count className="shrink-0 text-ui text-text-soft-400 tabular-nums">{countText}</span>
        )}
        {help && (
          <span className="shrink-0 self-center" onMouseDown={(e) => e.stopPropagation()}>
            <PageHelpButton help={help} />
          </span>
        )}
      </div>}
      {after}
      {/* The right cluster: search, then the actions, which never give way. */}
      <div className="ml-auto flex min-w-fit shrink-[1000] items-center gap-2">
        {filter && (
          // Search sits first in the right cluster, left of Filters (owner,
          // 2026-10-02: "move this search to this on the left").
          // A press on the field's icon or padding focuses it instead of dragging.
          // Folded at rest: only the search button, never squeezed. Open, 208 px,
          // 126 at the least: never wider than its 210 and 126 before the 4 px
          // grid (O1; owner: nothing grows past its old size). The cluster sits
          // at the right edge, so opening grows leftward: the title and the
          // actions stay put.
          <div
            data-filter
            data-open={open || undefined}
            className="group/filter flex min-w-fit shrink-[1000] items-center data-[open]:w-[208px] data-[open]:min-w-[126px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="hidden w-full group-data-[open]/filter:block group-data-[open]/filter:search-open">
              <Input
                ref={filterRef}
                role="searchbox"
                inputSize="xsmall"
                placeholder={placeholder}
                aria-label={placeholder}
                aria-keyshortcuts={filterKeys}
                leftIcon={<SearchIcon className="size-3.5" />}
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                onKeyDown={onFilterKeyDown}
                onBlur={() => { if (!filter.value) setUnfolded(false); }}
              />
            </div>
            <span className="group-data-[open]/filter:hidden">
              <IconButton ref={searchBtnRef} mode="stroke" size="xsmall" label={placeholder} shortcut={filterKeys ? "/" : undefined} icon={<SearchIcon className="size-3.5" />} onClick={focusFilter} />
            </span>
          </div>
        )}
        <div ref={actionsRef} data-header-actions className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}

/// The page's content under the header. It scrolls, unless `scroll` is false
/// for a page whose content scrolls itself (the lists). `width="form"` caps a
/// one-column page (760 px, wider in a wide window), left-aligned at the gutter (LAYOUT-04); its
/// PageHeader takes the same `width`.
/// `scrollKey` keeps its place across page switches (WIG-06), per key.
/// Its content starts on the sidebar's line (owner, 2026-10-01): the top of
/// the first block (the list's card, the first card or section) is the top
/// of the sidebar's first row (Search), right under the 52 px header, on
/// every page. Its box reaches 5 px higher, under the header, with 5 px of
/// padding (room for a first block's focus ring and lift, which the box
/// would cut: the owner's ring rule), so the content lands on the line.
export function PageBody({ children, className, scroll = true, width = "full", scrollKey }: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  width?: "full" | "form";
  /** The place this body's scroll is kept under (a page, or a page's tab). */
  scrollKey?: string;
}) {
  const setScrolled = usePageScrolled((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref, scroll ? scrollKey ?? "" : "");
  // A new page starts unscrolled; a page that comes back where it was says so.
  useEffect(() => {
    setScrolled((ref.current?.scrollTop ?? 0) > 0);
    return () => setScrolled(false);
  }, [setScrolled]);
  return (
    <div
      ref={ref}
      data-page-body
      data-region="content"
      className={cn("-mt-1.5 min-h-0 flex-1 px-gutter pt-1.5 pb-5", scroll ? "overflow-y-auto" : "flex flex-col overflow-hidden", className)}
      onScroll={scroll ? (e) => setScrolled(e.currentTarget.scrollTop > 0) : undefined}
    >
      {width !== "full" ? <div className="w-full" style={{ maxWidth: CAPPED[width] }}>{children}</div> : children}
    </div>
  );
}
