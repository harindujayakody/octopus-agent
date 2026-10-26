import { memo, useMemo, useRef, type ReactNode } from "react";
import { Checkbox, cn, IconButton, swallowFollowUpClick, Tooltip, useLongPress, type ContextMenuApi } from "@proxyshard/shardx-ui-kit";
import { AlertCircleIcon, MoreIcon } from "../../shared/icons";
import { CountryFlag } from "../../shared/ui/CountryFlag";
import { RowHoverActions, rowButtonDangerHoverClass, rowButtonHoverClass } from "../../shared/ui/RowHoverActions";
import { ProtocolPill } from "../../shared/ui/ProtocolPill";
import { ProxyTestPill } from "../../shared/ui/StatusPill";
import { fmtTs, HOST_OS } from "../../shared/lib/utils";
import { slideDelayOf } from "../../shared/lib/arrival";
import { useT } from "../../shared/i18n";
import { useRightsChange } from "../../entities/space";
import { proxyStatus, useProxy, type ProxyColumnId, type ProxyEntry } from "../../entities/proxy";
import { ariaOf, capOf, command, commandsFor, iconOf, menuItemsFor, proxyRowSubject, reasonOf, runCommand } from "../../features/commands";
import { pointerMoved } from "../../shared/lib/pointer";
import { rowFill } from "../../shared/ui/rowFill";

/// One 36 px line of the Proxies list, positioned by the list (`top`).
/// Memoized: a row renders again only when its own props or store values change (PERF-02).
export const ProxyListRow = memo(function ProxyListRow({ proxy, profileCount, top, columns, order, ipInTip, rowIndex, active, inPeek, tabbable, onMenu }: {
  proxy: ProxyEntry;
  profileCount: number;
  top: number;
  columns: string;
  /** The data columns on screen, in the header's order (owner feature 2026-09-26). */
  order: readonly ProxyColumnId[];
  /** Short of room, the Test result's IP shows in the pill's tooltip, not
   *  beside it (`TableLayout.shortened`): never cut to "OK 56 ms 2…". */
  ipInTip: boolean;
  rowIndex: number;
  active: boolean;
  inPeek: boolean;
  tabbable: boolean;
  /** Opens the row menu: at the pointer on a right-click, under ⋮ on a
   *  click. While it is open the row carries `data-menu-open` (RowHoverActions). */
  onMenu: ContextMenuApi["open"];
}) {
  const t = useT();
  // Its buttons say what a team's rights let this person do now.
  useRightsChange();
  const p = proxy;
  const snap = useProxy((s) => s.snapshots[p.id]);
  const busy = useProxy((s) => !!s.proxyTesting[p.id]);
  const isSel = useProxy((s) => s.proxySel.has(p.id));
  const toggleSelect = useProxy((s) => s.toggleSelect);
  const selectRangeTo = useProxy((s) => s.selectRangeTo);
  const setActive = useProxy((s) => s.setActive);
  const openPeek = useProxy((s) => s.openPeek);
  const shiftPress = useRef(false);
  // Cmd-press on macOS, Ctrl-press elsewhere adds or removes the row (WIG-08).
  const modPress = useRef(false);
  // A proxy that just arrived (Add proxies, an import) slides in once, as a
  // new profile's row does; one the list mounts partway through picks the
  // slide up where it is.
  const arrivedAt = useProxy((s) => s.arrived[p.id]);
  const slideDelay = useMemo(() => slideDelayOf(arrivedAt), [arrivedAt]);
  // On touch, holding the row selects it (selection mode, owner 2026-10-01);
  // its click and the platform's menu are the hold's own.
  const longPress = useLongPress(() => {
    setActive(p.id);
    if (!useProxy.getState().proxySel.has(p.id)) toggleSelect(p.id);
  });
  const hold = longPress.bind(p.id);

  const address = `${p.host}:${p.port}`;
  // The registry's menu (UI-29): the selection when this row is part of
  // it, else this proxy alone, and its heading says which (ruling 4).
  const openMenu = (e: React.MouseEvent) => {
    const subject = proxyRowSubject(p.id);
    const heading = subject.ids.length > 1 ? t("commands.nProxies", { n: subject.ids.length }) : p.name || address;
    onMenu(e, menuItemsFor("rowMenu", "proxies", subject), { heading });
  };
  const test = command("proxy.test");
  // One fill per row state, as on Profiles (E13, O5): the target is drawn,
  // the Peek row one step quieter, a selected target with both; no hover fill.
  const look = rowFill({ selected: isSel, active, inPeek });

  const status = proxyStatus(snap);
  // Fix round 1, item 2: the removed status dot's tooltip carried when the
  // proxy was last tested; put back on the Test result cell, for a tested
  // proxy only (nothing more to say once it's untested or mid-test).
  const ip = status === "ok" && !busy ? snap!.ip : undefined;
  const detail = status === "ok"
    ? ip && ipInTip ? t("proxyList.statusOkIp", { ms: snap!.tcp_ms!, when: fmtTs(snap!.last_seen), ip })
      // Reached, but nothing would say from where. Saying only "reached"
      // left the operator looking at a green row with an empty IP column
      // and no reason anywhere.
      : !snap!.ip && snap!.geo_error ? t("proxyList.statusOkNoIp", { ms: snap!.tcp_ms!, when: fmtTs(snap!.last_seen), why: snap!.geo_error })
      : t("proxyList.statusOk", { ms: snap!.tcp_ms!, when: fmtTs(snap!.last_seen) })
    : status === "failed"
      ? snap!.geo_error ? t("proxyList.statusFailedWhy", { when: fmtTs(snap!.last_seen), why: snap!.geo_error }) : t("proxyList.statusFailed", { when: fmtTs(snap!.last_seen) })
    : undefined;
  const cc = snap?.country_code || p.country;

  // One cell per data column, in the header's order (owner feature
  // 2026-09-26). Each case is the cell as it was; only its place moved.
  const cell = (id: ProxyColumnId): ReactNode => {
    switch (id) {
      case "name":
        return (
          <div
            key="name"
            role="gridcell"
            data-cell="name"
            // Pinned at the card's left while the list scrolls sideways.
            className="list-pin-name flex min-w-0 items-center self-stretch"
          >
            {/* As wide as its names need (owner, 2026-09-30): a rare long
                one is cut, and shows whole on hover. */}
            <Tooltip content={p.name || address} whenTruncated>
              <span className="min-w-0 truncate text-ui">{p.name || address}</span>
            </Tooltip>
            {/* The Test column hidden, a failed last test still shows, as a
                mark and a word, never a hue alone (A11Y-18). */}
            {!order.includes("test") && status === "failed" && !busy && (
              <span data-failed-word className="ml-1.5 inline-flex shrink-0 items-center gap-1 text-secondary text-error-text">
                <AlertCircleIcon aria-hidden="true" className="size-3.5" />
                {t("proxyTestResult.failed")}
              </span>
            )}
          </div>
        );
      case "type":
        // Live layer (spec 4.2): the protocol as a label chip in its own
        // hue (SOCKS5 violet, HTTP blue, HTTPS magenta), the Folder and Tag
        // chips' recipe, so a row's chips match.
        return <div key="type" role="gridcell" data-cell="type" className="flex min-w-0 items-center"><ProtocolPill kind={p.kind} /></div>;
      case "address":
        return (
          <Tooltip key="address" content={address} whenTruncated>
            <div role="gridcell" data-cell="address" data-role="proxy-address" className="min-w-0 truncate text-mono text-text-sub-600">{address}</div>
          </Tooltip>
        );
      case "country":
        return (
          <div key="country" role="gridcell" data-cell="country" className="flex min-w-0 items-center gap-1.5 text-secondary text-text-sub-600">
            {/* A city cut by the column's width shows whole on hover (autofit review I1). */}
            {cc ? <><CountryFlag cc={cc} /><Tooltip content={snap?.city || cc} whenTruncated warm={false}><span className="truncate">{snap?.city || cc}</span></Tooltip></> : <span className="text-text-soft-400">—</span>}
          </div>
        );
      case "profiles":
        return (
          <div key="profiles" role="gridcell" data-cell="profiles" className="text-secondary tabular-nums text-text-sub-600">
            <Tooltip content={profileCount === 1 ? t("proxyRow.usedByOne") : t("proxyRow.usedByMany", { n: profileCount })}>
              <span>{profileCount}</span>
            </Tooltip>
          </div>
        );
      case "test":
        return (
          <div key="test" role="gridcell" data-cell="test" data-status={status} className="flex min-w-0 items-center gap-1.5">
            {/* Live layer (spec 4.2): the last test as a tinted pill whose
                word carries the state (OK {ms} ms, Failed, Not tested, or
                Testing while one runs). When and why are the pill's own
                visually-hidden detail and the hover tooltip. */}
            <Tooltip content={detail}>
              {status === "ok"
                ? <ProxyTestPill state="ok" ms={snap!.tcp_ms!} busy={busy} detail={detail} className="shrink-0" />
                : <ProxyTestPill state={status} busy={busy} detail={detail} className="shrink-0" />}
            </Tooltip>
            {/* The address it came out at stays beside it, as before, while
                there is room; short of room, it is in the tooltip. */}
            {ip && !ipInTip && <span className="mono min-w-0 truncate text-secondary text-text-sub-600">{ip}</span>}
          </div>
        );
    }
  };

  return (
    <div
      role="row"
      aria-level={1}
      aria-rowindex={rowIndex}
      aria-selected={isSel}
      data-proxy-id={p.id}
      data-active={active || undefined}
      data-peek-open={inPeek || undefined}
      // A click anywhere on the row opens it in Peek (O5), except on the row
      // already in Peek (Pair 40 review, M2).
      data-clickable={!inPeek || undefined}
      tabIndex={tabbable ? 0 : -1}
      onFocus={(e) => { if (e.target === e.currentTarget && !active) setActive(p.id); }}
      className={cn(
        "row-line group absolute inset-x-0 grid h-[36px] items-center gap-[10px] list-select-row text-secondary text-text-strong-950 focus-ring-inset aria-selected:forced-selected",
        look.row,
        arrivedAt !== undefined && "slide-in",
      )}
      style={{ top, gridTemplateColumns: columns, animationDelay: arrivedAt !== undefined && slideDelay > 0 ? `-${slideDelay}ms` : undefined }}
      onPointerDown={hold.onPointerDown}
      onPointerUp={hold.onPointerUp}
      onPointerCancel={hold.onPointerCancel}
      onPointerMove={(e) => {
        hold.onPointerMove(e);
        // The row under a moving pointer is the one the keys act on (O5); a
        // list scrolling under a still pointer changes nothing (ruling 7).
        if (!pointerMoved(e) || e.pointerType === "touch" || active) return;
        // The keyboard follows only when it was on a row.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused !== e.currentTarget && focused.matches("[role='row'][data-proxy-id]")) {
          e.currentTarget.focus({ preventScroll: true });
        }
        // After the focus: the pointer made it active, so the palette's
        // first group does not follow it (Pair 44 ruling).
        setActive(p.id, { pointer: true });
      }}
      onContextMenu={(e) => {
        if (longPress.claimMenu(e, p.id)) return;
        // As a Profiles row: a right-click makes this the active row, with
        // the keyboard on it, and leaves the selection as it is (Pair 30
        // review, Important 2).
        setActive(p.id);
        if (e.clientX !== 0 || e.clientY !== 0) e.currentTarget.focus({ preventScroll: true });
        openMenu(e);
      }}
      // A key's click (Space on the checkbox) is never a modified press (Pair 40 review, I2).
      onKeyDownCapture={() => { shiftPress.current = false; modPress.current = false; }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        // Every press starts clean, one in a layer the row opened too (I2).
        shiftPress.current = false;
        modPress.current = false;
        if (!e.currentTarget.contains(target)) return;
        // A press chooses the row, even one the pointer already made active (E13).
        if (e.button === 0) setActive(p.id);
        const onControl = !!target.closest("button, a");
        shiftPress.current = e.button === 0 && e.shiftKey && !onControl;
        // As on Profiles (WIG-08): Ctrl-click on macOS is the menu's.
        modPress.current = e.button === 0 && !e.shiftKey && (HOST_OS === "macOS" ? e.metaKey : e.ctrlKey) && !onControl;
        if (shiftPress.current) { e.preventDefault(); selectRangeTo(p.id); return; }
        if (modPress.current) { e.preventDefault(); toggleSelect(p.id); return; }
        // A second press never selects a word of the row.
        if (e.detail > 1 && !onControl && !target.closest("input, textarea, label")) e.preventDefault();
      }}
      onClick={(e) => {
        // A long press selected the row; its click opens nothing.
        if (longPress.took(p.id)) { e.preventDefault(); return; }
        // The press already did a range or a toggle; its click must not redo it.
        if (shiftPress.current || modPress.current) { e.preventDefault(); return; }
        // On macOS a Ctrl-click is the secondary click: the menu's (I3).
        if (HOST_OS === "macOS" && e.ctrlKey) return;
        const target = e.target as HTMLElement;
        if (!e.currentTarget.contains(target)) return;
        if (target.closest("button, a, input, label, [role='button'], [data-cell='checkbox']")) return;
        // A click anywhere on the row opens it in Peek and never closes it (O5).
        if (!inPeek) openPeek(p.id);
        // The Peek that opens narrows the list: the second press of a
        // double-click lands on nothing (Show password, Close or Test now in
        // Peek, the strip's Test), as on Profiles (Pair 40 review, I1).
        if (e.detail === 1 && e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) swallowFollowUpClick(e);
      }}
    >
      <div role="gridcell" data-cell="checkbox" className="list-pin-check flex items-center self-stretch">
        {/* Pinned at the card's left while the list scrolls sideways, in
            its own slot before Name: at rest only on hover; in selection mode
            every box shows (`list-select-box`, the list's class, never this row's). */}
        <span className="list-select-box">
          <Checkbox
            aria-label={t("proxyList.select", { name: p.name || address })}
            tabIndex={active ? 0 : -1}
            checked={isSel}
            onChange={() => { if (!shiftPress.current && !modPress.current) toggleSelect(p.id); }}
          />
        </span>
      </div>
      {order.map(cell)}
      <div role="gridcell" data-cell="actions" className="list-pin-end self-stretch">
        <RowHoverActions
          tone={look.tone}
          // No track holds them: Test and More float in the strip over the
          // row's end with the rest (controller ruling, merge point 3). A
          // running test shows in the Test result pill's own spinner.
          floatFixed
          // A running test keeps Test in view, busy, after the pointer leaves (C11).
          hold={busy}
          fixed={
            <>
              <IconButton
                variant="neutral"
                mode="ghost"
                size="3xsmall"
                tabIndex={active ? 0 : -1}
                isLoading={busy}
                className={cn("pointer-events-auto", rowButtonHoverClass)}
                icon={iconOf(test)}
                label={test.label(1)}
                shortcut={capOf(test)}
                aria-keyshortcuts={ariaOf(test)}
                // A double click's second click is not a second test (I1).
                onClick={(e) => { if (e.detail > 1) return; void runCommand(test, { ids: [p.id] }, { from: "hover" }); }}
              />
              <IconButton
                variant="neutral"
                mode="ghost"
                size="3xsmall"
                tabIndex={active ? 0 : -1}
                className={cn("pointer-events-auto", rowButtonHoverClass)}
                icon={<MoreIcon className="size-3.5" />}
                label={t("profileRowActions.moreActions")}
                // The menu host sets aria-expanded while its menu is open.
                aria-haspopup="menu"
                aria-expanded="false"
                onClick={(e) => { e.stopPropagation(); if (e.detail > 1) return; openMenu(e); }}
              />
            </>
          }
        >
          {commandsFor("hover", "proxies", { ids: [p.id] }).map((c) => {
            // One that cannot run here says why in its own name (a team's rights), as the menu does.
            const why = reasonOf(c, { ids: [p.id] });
            return (
              <IconButton
                key={c.id}
                data-command={c.id}
                variant="neutral"
                mode="ghost"
                size="3xsmall"
                tabIndex={active ? 0 : -1}
                // Delete is neutral at rest: no permanent red slab for the most
                // destructive action on the row (Task 5b's error tint, only on
                // hover/focus).
                className={cn("pointer-events-auto", c.danger ? rowButtonDangerHoverClass : rowButtonHoverClass)}
                icon={iconOf(c)}
                label={why ? t("rights.labelWhy", { label: c.label(1), why }) : c.label(1)}
                disabled={!!why}
                shortcut={why ? undefined : capOf(c)}
                aria-keyshortcuts={ariaOf(c)}
                // A double click must not also run the second click's action on
                // whatever this button became (or the row that slid under the
                // pointer): the click that matters already ran.
                onClick={(e) => { e.stopPropagation(); if (e.detail > 1) return; void runCommand(c, { ids: [p.id] }, { from: "hover" }); }}
              />
            );
          })}
        </RowHoverActions>
      </div>
    </div>
  );
});
