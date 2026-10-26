import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn, Input, Kbd, Modal, useListNavigation, type OptionProps } from "@proxyshard/shardx-ui-kit";
import { ChevronRightIcon, ClockIcon, SearchIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { announce } from "../../../shared/model/announce";
import { usePalette } from "../../../shared/model/palette";
import { listStop, pageTitle, refocusIfLost } from "../../../shared/lib/focus";
import { keyCaps, type Command } from "../../../shared/commands";
import { labelOf, PALETTE_KEYS } from "../../commands";
import { matchCommands, remembers, type PaletteGroup, type PaletteItem } from "../lib/match";
import { recentWeights, recordUse } from "../lib/recents";
import { usePaletteItems } from "../lib/results";

/** One of the palette's own keys, every binding, as its caps print it ("↑ ↓"). */
const capsOf = (c: Command): string => (c.keys ?? []).flatMap(keyCaps).join(" ");
/** Its first binding only, where the others are alternatives ("Tab", not "Tab →"). */
const firstCapOf = (c: Command): string => (c.keys?.[0] ? keyCaps(c.keys[0]).join(" ") : "");

/// Cmd+K: one search over profiles, pages, Views, Folders, actions and
/// Settings. The search keeps the keyboard; the arrows move through the
/// results, Enter runs one, Mod+Enter its alternative, Esc closes.
export function CommandPalette() {
  const t = useT();
  const open = usePalette((s) => s.open);
  const session = usePalette((s) => s.session);
  const setOpen = usePalette((s) => s.setOpen);
  const ran = usePalette((s) => s.ran);
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={open}
      onClose={() => {
        setOpen(false);
        // Esc after the editor it opened over has gone (a rename the palette
        // ended): the row it edited, not the page (PC-108).
        refocusIfLost(() => document.querySelector<HTMLElement>("main [role='row'][data-active]") ?? listStop() ?? pageTitle());
      }}
      aria-label={t("palette.label")}
      placement="top"
      padded={false}
      showClose={false}
      maxWidthClassName="max-w-[560px]"
      initialFocusRef={searchRef}
      exit={ran ? "instant" : "animate"}
      motion="quick"
    >
      {/* Kept through the exit animation; each opening starts afresh. */}
      <PaletteBody key={session} searchRef={searchRef} />
    </Modal>
  );
}

function PaletteBody({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const t = useT();
  const { items, contextTitle } = usePaletteItems();
  const [query, setQuery] = useState("");
  const listId = useId();
  // Read once per opening (each opening mounts this afresh).
  const weights = useMemo(() => recentWeights(), []);
  // A result's actions replace the results in place, with no motion (ruling
  // 11; list changes are 0 ms). The query typed before comes back with Esc,
  // Shift+Tab or ArrowLeft on an empty search.
  const [actionsOf, setActionsOf] = useState<{ item: PaletteItem; query: string } | null>(null);
  const shown = useMemo(
    () => (actionsOf ? actionsOf.item.actions!().map((x) => ({ ...x, group: "actions" as const, featured: true })) : null),
    [actionsOf],
  );
  const groups = useMemo(() => {
    if (!shown) return matchCommands(items, query, weights);
    return query ? matchCommands(shown, query) : [{ group: "actions" as const, items: shown }];
  }, [items, query, shown, weights]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const runItem = (item: PaletteItem, alt: boolean) => {
    // A closing palette runs nothing: a click that lands during its fade is
    // not a choice (EMIL-01).
    if (!usePalette.getState().open) return;
    // One that cannot run now can still be reached, to hear why, as in the
    // menus; it runs nothing and the palette stays.
    if (item.disabled !== undefined) return;
    // A command that asks which (Change theme…) opens its choices, on
    // Mod+Enter too, having no alternative.
    if (item.enterOpensActions && !(alt && item.runAlt) && openActions(item)) return;
    // The result that led there is remembered, not an action or a theme
    // chosen from its list: those act on a subject that changes, or come
    // back as the row that asked (EMIL-16; Pair 45 review, I1).
    const led = actionsOf ? actionsOf.item : item;
    if (remembers(led)) recordUse(led.id);
    const useAlt = alt && item.runAlt !== undefined;
    const go = useAlt ? item.runAlt! : item.run;
    usePalette.getState().closeAfterRun();
    // One that puts the keyboard somewhere (Rename, a dialog, Peek, a picker)
    // runs after the palette has handed the keyboard back, so it keeps it
    // (PC-108); every other runs now (Pair 45 review, I3).
    if (useAlt ? item.focusAfterAlt : item.focusAfter) requestAnimationFrame(go);
    else go();
  };
  // The kit's one list model (C16): the highlight is an id, so it stays on
  // its result when the list changes under it (a profile starts or stops);
  // arrows wrap; the pointer moves the same highlight; Enter runs once, never
  // on a repeat or while an input method composes; Mod+Enter runs the
  // alternative.
  const nav = useListNavigation<PaletteItem>({
    items: flat,
    getId: (item) => item.id,
    homeEnd: false, // Home and End move the caret in the search
    // The arrows still reach one that cannot run (to hear why), but the
    // highlight starts on one Enter runs (the Trash's Restore, disabled with
    // nothing picked, heads the list there).
    defaultActiveId: flat.find((x) => x.disabled === undefined)?.id ?? null,
    idPrefix: `palette${listId.replace(/[^\w-]/g, "")}`,
    onPick: (item, how) => runItem(item, how.alt),
  });
  const current = nav.activeIndex >= 0 ? flat[nav.activeIndex] : undefined;

  // Entering and leaving a result's actions is said once, in the palette's
  // own live region (M4 of the Pair 45 review); a keystroke clears it, so it
  // is never said again.
  const [said, setSaid] = useState("");
  // The query that comes back is not counted aloud as well: one word per move.
  const quietCount = useRef(false);
  const openActions = (item: PaletteItem | undefined) => {
    if (!item?.actions) return false;
    setActionsOf({ item, query });
    setQuery("");
    setSaid(item.enterOpensActions ? item.label : t("palette.actionsFor", { name: item.label }));
    nav.setActiveId(null);
    return true;
  };
  const back = () => {
    if (!actionsOf) return false;
    setQuery(actionsOf.query);
    setActionsOf(null);
    setSaid(t("palette.results"));
    quietCount.current = actionsOf.query.trim() !== "";
    nav.setActiveId(actionsOf.item.id);
    return true;
  };

  // The count, for screen readers, once typing pauses (A11Y-05, PC-105).
  useEffect(() => {
    if (!query.trim()) return;
    if (quietCount.current) { quietCount.current = false; return; }
    const id = setTimeout(() => {
      const n = flat.length;
      announce(n === 0 ? t("palette.noResults") : n === 1 ? t("palette.resultCountOne") : t("palette.resultCount", { n }));
    }, 500);
    return () => clearTimeout(id);
    // `t` follows the language, which rebuilds the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, flat.length]);

  const groupLabel: Record<PaletteGroup, string> = {
    // What the first group acts on: "2 selected", or the active row's name.
    context: contextTitle ?? t("palette.groupContext"),
    recent: t("palette.groupRecent"),
    profiles: t("palette.groupProfiles"),
    proxies: t("palette.groupProxies"),
    projects: t("palette.groupProjects"),
    // In a result's actions, the result's name heads them.
    actions: actionsOf ? actionsOf.item.label : t("palette.groupActions"),
    pages: t("palette.groupPages"),
    views: t("palette.groupViews"),
    folders: t("palette.groupFolders"),
    settings: t("palette.groupSettings"),
  };

  let index = -1;
  return (
    <div data-palette className="flex flex-col">
      {/* UI-31: the search is bare, with no box of its own inside the
          panel; the divider under it is its only frame (Raycast, Linear).
          It keeps the old box's geometry: 40 px tall (3 + 34 + 3 before),
          and 1 + 12 px in, so the search icon stays on the options' icons
          (5 px list padding + 8 px option padding). */}
      <div className="border-b border-stroke-soft-200 px-0.5">
        <Input
          variant="bare"
          inputSize="medium"
          spellCheck={false}
          ref={searchRef}
          role="combobox"
          aria-label={t("palette.search")}
          // Collapsed while nothing matches: the list is empty and the
          // status under it says so (A11Y-21).
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={nav.activeId ? nav.optionId(nav.activeId) : undefined}
          // A command that asks which (Change theme…) is its own prompt.
          placeholder={!actionsOf ? t("palette.placeholder")
            : actionsOf.item.enterOpensActions ? actionsOf.item.label
            : t("palette.actionsFor", { name: actionsOf.item.label })}
          leftIcon={<SearchIcon className="size-3.5" />}
          value={query}
          // A new search starts at the best match.
          onChange={(e) => { setQuery(e.target.value); setSaid(""); nav.setActiveId(null); }}
          onKeyDown={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
            if (!e.nativeEvent.isComposing) {
              // Tab, or ArrowRight with the caret at the end: the highlighted
              // result's actions (ArrowRight elsewhere moves the caret). The
              // Modal keeps Tab inside, so it never leaves the search.
              if (!actionsOf && ((e.key === "Tab" && !e.shiftKey) || (e.key === "ArrowRight" && atEnd)) && openActions(current)) {
                e.preventDefault();
                return;
              }
              if (actionsOf && (e.key === "Escape" || (e.key === "Tab" && e.shiftKey) || (e.key === "ArrowLeft" && input.value === ""))) {
                e.preventDefault();
                e.stopPropagation(); // the palette hears the next Esc, not this one
                back();
                return;
              }
            }
            nav.onKeyDown(e);
          }}
        />
      </div>
      {/* A press on a heading or the padding keeps the keyboard in the
          search (PC-104); an option's own press does the same (the kit). */}
      <div
        id={listId}
        role="listbox"
        aria-label={t("palette.results")}
        onMouseDown={(e) => e.preventDefault()}
        className={cn("max-h-[min(420px,calc(var(--viewport-h)*0.6))] overflow-y-auto overscroll-contain", flat.length > 0 && "p-1.5")}
      >
        {groups.map((g) => (
          <div key={g.group} role="group" aria-label={groupLabel[g.group]}>
            <div aria-hidden="true" className="px-2.5 pb-1 pt-2 text-secondary font-medium text-text-soft-400">{groupLabel[g.group]}</div>
            {g.items.map((item) => {
              const i = ++index;
              return <Option key={item.id} item={item} props={nav.getOptionProps(item, i)} selected={i === nav.activeIndex} recent={g.group === "recent"} />;
            })}
          </div>
        ))}
      </div>
      {/* Outside the listbox, which holds options only (axe aria-required-children);
          the margin stands for the list's own padding, so it sits where it did.
          Always in the page, only its text changes: a live region that
          mounts with its text is often not announced (Pair 28 review M2). */}
      <p role="status" className={flat.length === 0 ? "m-1.5 px-2.5 py-6 text-center text-balance text-body text-text-soft-400" : "sr-only"}>
        {flat.length === 0 ? t("palette.noResults") : said || null}
      </p>
      {/* A hint never breaks inside: past the palette's width (Russian's
          longer words) a whole hint moves to a second line. */}
      <div data-palette-footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stroke-soft-200 px-3 py-2 text-secondary text-text-soft-400 *:whitespace-nowrap">
        {/* The caps from the registry; the words stay the footer's short ones. */}
        {!actionsOf && <span className="flex items-center gap-1.5"><Kbd>{capsOf(PALETTE_KEYS.move)}</Kbd>{t("palette.hintMove")}</span>}
        <span className="flex items-center gap-1.5"><Kbd>{capsOf(PALETTE_KEYS.run)}</Kbd>{t("palette.hintRun")}</span>
        {/* Only when the highlighted result has an alternative (PC-107), in
            the words the sheet prints for the same key. */}
        {!actionsOf && current?.runAlt && (
          <span className="flex items-center gap-1.5"><Kbd>{capsOf(PALETTE_KEYS.openPeek)}</Kbd>{labelOf(PALETTE_KEYS.openPeek.id)}</span>
        )}
        {/* Only when the highlighted result has actions: a key shows where it works. */}
        {!actionsOf && current?.actions && (
          <span className="flex items-center gap-1.5"><Kbd>{firstCapOf(PALETTE_KEYS.actions)}</Kbd>{t("palette.hintActions")}</span>
        )}
        {actionsOf
          ? <span className="ml-auto flex items-center gap-1.5"><Kbd>{capsOf(PALETTE_KEYS.close)}</Kbd>{t("palette.hintBack")}</span>
          : <span className="ml-auto flex items-center gap-1.5"><Kbd>{capsOf(PALETTE_KEYS.close)}</Kbd>{t("palette.hintClose")}</span>}
      </div>
    </div>
  );
}

function Option({ item, props, selected, recent = false }: { item: PaletteItem; props: OptionProps; selected: boolean; recent?: boolean }) {
  return (
    <div
      {...props}
      aria-selected={selected}
      aria-disabled={item.disabled !== undefined || undefined}
      aria-keyshortcuts={item.aria}
      className={cn(
        // Pointer cursor is the kit's own base rule now (owner feedback 5v): `role="option"`.
        "flex h-[36px] items-center gap-2.5 rounded-control px-2.5 text-body",
        item.disabled !== undefined ? "text-text-disabled-300" : "text-text-strong-950",
        // Active equals hover (owner, 2026-10-01).
        selected && "bg-bg-hover active:bg-bg-active",
      )}
    >
      {recent
        ? <span aria-hidden="true" className="flex shrink-0 text-icon-soft-400"><ClockIcon className="size-3.5" /></span>
        : item.icon && <span aria-hidden="true" className="flex shrink-0 text-icon-soft-400">{item.icon}</span>}
      {recent && item.area ? (
        // "{Area} / {name}": the area soft and the first to give way, so the name stays readable.
        <span data-recent-path className="flex min-w-0 flex-1">
          <span data-recent-area className="min-w-0 shrink-[100] truncate text-text-soft-400">{item.area}&nbsp;/&nbsp;</span>
          <span data-recent-name className="min-w-0 shrink-[0.001] truncate">{item.label}</span>
        </span>
      ) : (
      <span className="min-w-0 flex-1 truncate">
        {item.label}
        {/* Where it lives, quieter: two profiles that differ by a digit are told apart (CRAFT-07). */}
        {item.subtitle && <span data-subtitle className="ml-2 text-secondary text-text-soft-400">{item.subtitle}</span>}
      </span>
      )}
      {item.meta && <span className="shrink-0 text-secondary text-text-soft-400">{item.meta}</span>}
      {/* A result that cannot run now says why, where its hint would be. */}
      {(item.disabled ?? (recent ? undefined : item.hint)) && <span className="shrink-0 text-secondary tabular-nums text-text-soft-400">{item.disabled ?? item.hint}</span>}
      {/* The key that does the same outside the palette (UI-29, IFACE-10);
          `aria-keyshortcuts` on the option says it to a screen reader. */}
      {item.keys && !recent && (
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          {item.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
        </span>
      )}
      {recent && <span aria-hidden="true" className="flex shrink-0 text-icon-soft-400"><ChevronRightIcon className="size-3.5" /></span>}
    </div>
  );
}
