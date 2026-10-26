import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconButton, Tooltip, cn } from "@proxyshard/shardx-ui-kit";
import { CloseIcon, TickIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { decide, idle, isTeamLevel, nextCell, pressCell, sameScope, scopeKey, setCell, toCells, type Cell, type Decision, type Target } from "../lib/decide";
import { TEAM_ACTIONS, type Grant, type GrantScope, type TeamAction } from "../model/types";

/** One row of the grid: the whole team, a folder or one profile. */
export type RightsRow = {
  scope: GrantScope;
  label: string;
  /** Muted words after the label: a profile's folder. */
  hint?: string;
  /** Before the label: a folder's color dot. */
  lead?: ReactNode;
  /** What the row's rules are asked about, for the result after narrowest-wins;
   *  null when that is not known here (a profile whose folder the launcher lacks). */
  target: Target | null;
  /** A profile row the admin added: it can go again. */
  removable?: boolean;
  /** More about the place than its label says, on hover. */
  tip?: string;
};

type Tr = ReturnType<typeof useT>;

/** The column titles, called literally so the i18n check sees them. */
export function actionName(t: Tr, a: TeamAction): string {
  switch (a) {
    case "see": return t("team.actSee");
    case "start": return t("team.actStart");
    case "edit": return t("team.actEdit");
    case "create": return t("team.actCreate");
    case "delete": return t("team.actDelete");
    case "cookies": return t("team.actCookies");
    case "take_out": return t("team.actTakeOut");
  }
}

/** What each action covers, as team-model's `Action` says. */
export function actionHelp(t: Tr, a: TeamAction): string {
  switch (a) {
    case "see": return t("team.actSeeHelp");
    case "start": return t("team.actStartHelp");
    case "edit": return t("team.actEditHelp");
    case "create": return t("team.actCreateHelp");
    case "delete": return t("team.actDeleteHelp");
    case "cookies": return t("team.actCookiesHelp");
    case "take_out": return t("team.actTakeOutHelp");
  }
}

const NO_RULE: Decision = { kind: "none" };
const decideRow = (grants: readonly Grant[], a: TeamAction, row: RightsRow): Decision => (row.target ? decide(grants, a, row.target) : NO_RULE);
const idleRow = (grants: readonly Grant[], a: TeamAction, row: RightsRow) => !!row.target && idle(grants, a, row.target);

/** Why a cell ends up allowed or not, in one line that names its row. */
export function explain(t: Tr, grants: readonly Grant[], action: TeamAction, row: RightsRow): string {
  const name = actionName(t, action);
  const d = decideRow(grants, action, row);
  const at = (what: string) => t("team.hintAt", { where: row.label, what });
  if (isTeamLevel(action) && row.scope.kind === "profile") return at(t("team.hintCreateProfile"));
  if (idleRow(grants, action, row)) return at(t("team.hintIdle", { action: name }));
  if (!row.target && d.kind === "none") return at(t("team.hintUnknownFolder", { action: name }));
  if (d.kind === "none") return at(t("team.hintNone", { action: name }));
  const allowed = d.kind === "allowed";
  if (sameScope(d.by, row.scope)) return at(allowed ? t("team.hintAllowedHere", { action: name }) : t("team.hintRefusedHere", { action: name }));
  if (d.by.kind === "folder") {
    return at(allowed ? t("team.hintAllowedByFolder", { action: name, folder: d.by.name }) : t("team.hintRefusedByFolder", { action: name, folder: d.by.name }));
  }
  return at(allowed ? t("team.hintAllowedByTeam", { action: name }) : t("team.hintRefusedByTeam", { action: name }));
}

const stateWord = (t: Tr, own: Cell, d: Decision) =>
  own === "allow" ? t("team.stateAllowed") : own === "refuse" ? t("team.stateRefused")
    : d.kind === "allowed" ? t("team.stateAllowedWider") : d.kind === "refused" ? t("team.stateRefusedWider") : t("team.stateNotSet");

/** A rule set on the cell is a tinted tick or cross; a result that comes
 *  from a wider rule is the same mark, pale and with no fill. An editable cell
 *  with neither shows a faint ring, so the empty grid still reads as cells. */
function Mark({ own, d, empty }: { own: Cell; d: Decision; empty?: boolean }) {
  const kind = own ?? (d.kind === "allowed" ? "allow" : d.kind === "refused" ? "refuse" : null);
  if (!kind) return empty ? <span aria-hidden="true" data-empty-mark className="size-[6px] rounded-full border border-stroke-sub-300 group-hover/row:border-text-soft-400" /> : null;
  const Icon = kind === "allow" ? TickIcon : CloseIcon;
  return <Icon aria-hidden="true" className="size-3.5" />;
}

// The place keeps room for a name; the actions give way first, then the grid scrolls sideways.
const COLS = "grid grid-cols-[minmax(140px,1fr)_repeat(7,minmax(60px,72px))] items-center";

/// Who may do what: rows are where, columns the seven actions, each cell a rule or none.
/// Editable, a click or Space steps a cell, Delete clears it, the arrows, Home and End move.
export function RightsGrid({ rows, grants, label, editable = false, autoFocus = false, onChange, onRemoveRow, selected, onSelectRow }: {
  rows: readonly RightsRow[];
  grants: readonly Grant[];
  label: string;
  editable?: boolean;
  /** Takes the keyboard once it renders: its Tab stop, with no line explained yet. */
  autoFocus?: boolean;
  /** The whole list after a press: a press that allows what needs See may allow See too. */
  onChange?: (grants: Grant[]) => void;
  onRemoveRow?: (row: RightsRow) => void;
  /** The row the presets act on (its scope key), marked. */
  selected?: string;
  onSelectRow?: (row: RightsRow) => void;
}) {
  const t = useT();
  const hintId = useId();
  const box = useRef<HTMLDivElement>(null);
  const cells = toCells(grants);
  const [at, setAt] = useState<[number, number]>([0, 0]);
  // The cell the line under the grid explains: the last one pointed at or
  // focused; none until then. A press that turned See on says so instead.
  const [shown, setShown] = useState<[number, number] | null>(null);
  const [notice, setNotice] = useState<{ at: string; text: string } | null>(null);
  const quiet = useRef(false);
  useEffect(() => {
    if (!autoFocus) return;
    quiet.current = true;
    box.current?.querySelector<HTMLElement>("[data-cell][tabindex='0']")?.focus();
    quiet.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  const r = Math.min(at[0], rows.length - 1);
  const c = Math.min(at[1], TEAM_ACTIONS.length - 1);
  const own = (row: RightsRow, a: TeamAction): Cell => cells.get(`${scopeKey(row.scope)}|${a}`) ?? null;
  const locked = (row: RightsRow, a: TeamAction) => isTeamLevel(a) && row.scope.kind === "profile";

  const show = (ri: number, ci: number) => {
    setShown([ri, ci]);
    if (notice && notice.at !== `${ri}:${ci}`) setNotice(null);
  };
  const focusCell = (ri: number, ci: number) => {
    setAt([ri, ci]);
    box.current?.querySelector<HTMLElement>(`[data-cell='${ri}:${ci}']`)?.focus();
  };
  const press = (ri: number, ci: number, to?: Cell) => {
    const row = rows[ri];
    const a = TEAM_ACTIONS[ci];
    if (!row || locked(row, a)) return;
    const cell = to === undefined ? nextCell(own(row, a)) : to;
    // Without a known folder no See is added: what the row inherits is not known here.
    const next = row.target ? pressCell(grants, row.scope, row.target, a, cell) : { grants: setCell(grants, row.scope, a, cell), addedSee: false };
    onChange?.(next.grants);
    setNotice(next.addedSee ? { at: `${ri}:${ci}`, text: t("team.hintAt", { where: row.label, what: t("team.hintSeeAdded", { action: actionName(t, a) }) }) } : null);
  };
  const onKey = (e: KeyboardEvent, ri: number, ci: number) => {
    const last = TEAM_ACTIONS.length - 1;
    const move: Record<string, [number, number] | undefined> = {
      ArrowRight: [ri, Math.min(last, ci + 1)],
      ArrowLeft: [ri, Math.max(0, ci - 1)],
      ArrowDown: [Math.min(rows.length - 1, ri + 1), ci],
      ArrowUp: [Math.max(0, ri - 1), ci],
      Home: e.ctrlKey || e.metaKey ? [0, 0] : [ri, 0],
      End: e.ctrlKey || e.metaKey ? [rows.length - 1, last] : [ri, last],
    };
    const to = move[e.key];
    if (to) { e.preventDefault(); focusCell(to[0], to[1]); return; }
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); press(ri, ci); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); press(ri, ci, null); }
  };

  const hintRow = shown ? rows[Math.min(shown[0], rows.length - 1)] : undefined;
  const hint = notice?.text ?? (hintRow && shown ? explain(t, grants, TEAM_ACTIONS[shown[1]], hintRow) : "");

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div
          ref={box}
          role={editable ? "grid" : "table"}
          aria-label={label}
          aria-describedby={editable ? undefined : hintId}
          data-rights-grid
          className="flex min-w-fit flex-col"
          onPointerLeave={() => {
            // Back to the cell the keyboard is on, if it is in the grid.
            const f = document.activeElement as HTMLElement | null;
            const k = f && box.current?.contains(f) ? f.dataset.cell : undefined;
            if (!k) { setShown(null); return; }
            const [ri, ci] = k.split(":").map(Number);
            setShown([ri, ci]);
          }}
        >
          <div role="row" className={cn(COLS, "min-h-[28px]")}>
            <span role="columnheader" className="px-2 text-secondary text-text-soft-400">{t("team.colWhere")}</span>
            {TEAM_ACTIONS.map((a) => (
              <span key={a} role="columnheader" className="min-w-0 px-0.5 text-center text-secondary text-text-soft-400">
                <Tooltip content={actionHelp(t, a)}><span data-action-head={a} className="block truncate">{actionName(t, a)}</span></Tooltip>
              </span>
            ))}
          </div>
          {rows.map((row, ri) => {
            const key = scopeKey(row.scope);
            const isSelected = editable && selected === key;
            return (
              <div
                key={key}
                role="row"
                data-rights-row={key}
                data-selected={isSelected || undefined}
                aria-selected={editable ? isSelected : undefined}
                className={cn(COLS, "group/row row-line relative min-h-[36px] rounded-control", isSelected && "bg-bg-weak-50")}
              >
                <div
                  role="rowheader"
                  className="flex min-w-0 items-center gap-2 px-2"
                  // A press on the place picks the row for the presets, and changes no rule.
                  onClick={editable ? () => focusCell(ri, c) : undefined}
                >
                  {row.lead}
                  <Tooltip content={row.tip ?? row.label} whenTruncated={!row.tip}>
                    <span className={cn("min-w-0 truncate text-ui text-text-strong-950", isSelected && "font-medium")}>{row.label}</span>
                  </Tooltip>
                  {row.hint && <span className="shrink-0 truncate text-secondary text-text-soft-400">{row.hint}</span>}
                  {editable && row.removable && onRemoveRow && (
                    <IconButton
                      size="3xsmall"
                      icon={<CloseIcon className="size-3.5" />}
                      label={t("team.removeProfileRow", { name: row.label })}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveRow(row);
                        // The button leaves with its row: the keyboard goes to the row now in its place.
                        requestAnimationFrame(() => focusCell(Math.min(ri, rows.length - 2), 0));
                      }}
                    />
                  )}
                </div>
                {TEAM_ACTIONS.map((a, ci) => {
                  const mine = own(row, a);
                  const d = decideRow(grants, a, row);
                  const off = locked(row, a);
                  const lame = idleRow(grants, a, row);
                  const tone = off ? "text-text-disabled-300"
                    : lame ? cn("text-warning-text", mine === "allow" && "bg-warning-tint forced-edge")
                    : mine === "allow" ? "bg-success-tint text-success-text forced-edge"
                    : mine === "refuse" ? "bg-error-tint text-error-text forced-edge"
                    : "text-text-soft-400";
                  const state = off ? t("team.stateLocked") : lame ? t("team.stateIdle", { state: stateWord(t, mine, d) }) : stateWord(t, mine, d);
                  const name = t("team.cellName", { action: actionName(t, a), where: row.label, state });
                  if (!editable) {
                    return (
                      <div key={a} role="cell" className="flex justify-center">
                        <Tooltip content={explain(t, grants, a, row)} warm={false}>
                          <span data-cell={`${ri}:${ci}`} data-state={mine ?? d.kind} data-idle={lame || undefined} className={cn("grid h-[28px] w-[44px] place-items-center rounded-control", tone)}>
                            <Mark own={mine} d={d} />
                            <span className="sr-only">{name}</span>
                          </span>
                        </Tooltip>
                      </div>
                    );
                  }
                  return (
                    <div key={a} role="gridcell" className="flex justify-center">
                      {/* eslint-disable-next-line no-restricted-syntax -- a grid cell: the button is the cell's state */}
                      <button
                        type="button"
                        data-cell={`${ri}:${ci}`}
                        data-state={off ? "locked" : mine ?? "inherit"}
                        data-idle={lame || undefined}
                        tabIndex={ri === r && ci === c ? 0 : -1}
                        aria-label={name}
                        aria-describedby={ri === r && ci === c ? hintId : undefined}
                        aria-disabled={off || undefined}
                        onFocus={() => { setAt([ri, ci]); if (!quiet.current) show(ri, ci); onSelectRow?.(row); }}
                        onPointerEnter={() => show(ri, ci)}
                        onClick={() => { setAt([ri, ci]); press(ri, ci); }}
                        onKeyDown={(e) => onKey(e, ri, ci)}
                        className={cn(
                          "grid h-[28px] w-[44px] place-items-center rounded-control focus-ring",
                          tone,
                          off ? "cursor-not-allowed" : mine === "allow" ? (lame ? "hover:bg-warning-tint" : "hover:bg-success-tint-hover") : mine === "refuse" ? "hover:bg-error-tint-hover" : "hover:bg-bg-hover",
                        )}
                      >
                        {off ? <span aria-hidden="true">–</span> : <Mark own={mine} d={d} empty />}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {editable && <p id={hintId} data-rights-hint className="m-0 min-h-[18px] px-2 text-help text-text-strong-950">{hint}</p>}
      {/* A press that changed a second cell says so aloud; the pointer's lines do not. */}
      {editable && <span className="sr-only" aria-live="polite">{notice?.text ?? ""}</span>}
      {/* The admin's legend says what may be set; a member's, what the marks mean for them. */}
      <p id={editable ? undefined : hintId} className="m-0 px-2 text-help text-text-sub-600">{editable ? t("team.legend") : t("team.legendRead")}</p>
    </div>
  );
}
