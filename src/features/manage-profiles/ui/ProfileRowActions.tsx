import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Button, cn, IconButton, IconSwap, Tooltip } from "@proxyshard/shardx-ui-kit";
import { MoreIcon, SpinnerIcon } from "../../../shared/icons";
import { RUN_BUTTON_MIN, setRunButtonWidth, startRefusal, useProfile, useSaving, type ProfileMeta } from "../../../entities/profile";
import { useT } from "../../../shared/i18n";
import { RowHoverActions, rowButtonDangerHoverClass, rowButtonHoverClass } from "../../../shared/ui/RowHoverActions";
import { rowActionIcons } from "../../../shared/ui/rowActionIcons";
import type { RowTone } from "../../../shared/ui/rowFill";
import type { Command } from "../../../shared/commands";
import { ariaOf, capOf, command, commandsFor, iconOf, labelOf, reasonOf, runCommand } from "../../commands";

const isPin = (c: Command) => c.id === "profile.pin" || c.id === "profile.unpin";

/// Start/Stop and the row menu button at the end of a Profiles row. The
/// registry's hover commands (Pin, Open in Peek, Clone, Move to Trash) show
/// as a hover overlay to their left (Task 5e: the owner wants these on every
/// row, not only under the row menu, which still carries every item for
/// right-click); their names and keys are the registry's, as the menus and
/// the sheet print them (UI-29).
export function ProfileRowActions({ profile, onMore, tabIndex, editing, tone, lead, built = true, tourStart = false }: {
  profile: ProfileMeta;
  onMore: (e: React.MouseEvent) => void;
  /** -1 keeps the buttons out of the Tab order (rows other than the active one). */
  tabIndex?: number;
  /** An inline edit (Name or Notes) is open on this row: hides the overlay. */
  editing?: boolean;
  /** The row's own fill (`rowFill`): the overlay's tint matches it (fix
   *  round 1, finding 1). */
  tone: RowTone;
  /** The edit button of the column the hover actions float over. */
  lead?: ReactNode;
  /** False leaves the hover buttons out until the row needs them (its
   *  `engaged`): hidden and out of reach until then, so a row a scroll
   *  brings in does not build them for nothing. Start/Stop and More stay. */
  built?: boolean;
  /** The tour's Start step points at this row's button: it carries the
   *  tour's key and stays in view for that step (it shows on hover only,
   *  and the tour blocks the pointer). */
  tourStart?: boolean;
}) {
  const t = useT();
  const p = profile;
  const isRunning = useProfile((s) => !!s.running[p.id]);
  const isStarting = useProfile((s) => s.startBusy.has(p.id));
  // Cancel was pressed: the launch is being ended.
  const isCancelling = useProfile((s) => s.cancelling.has(p.id));
  // Renders again when its session ends: startRefusal reads it.
  useSaving((s) => s.ids.has(p.id));
  const runCmd = command(isRunning ? "profile.stop" : "profile.start");
  const runLabel = labelOf(runCmd.id);
  // A team's: no Start, or another device has it open; a synced one open on another computer,
  // as the menu says (it offers Open here instead). Said on the button, which does nothing.
  const held = p.sync?.on ? p.sync.open_on : undefined;
  const blocked = !isRunning && !isStarting ? startRefusal(p) ?? (held ? t("errors.openElsewhere", { device: held }) : null) : null;
  const cancelLabel = labelOf("profile.cancelStart");
  // The registry's hover commands, Pin first, where the row has always had
  // it (Task 5e; the Tab order of columns Task 8).
  const listed = built ? commandsFor("hover", "profiles", { ids: [p.id] }) : [];
  const hover = [...listed.filter(isPin), ...listed.filter((c) => !isPin(c))];

  return (
    <RowHoverActions
      editing={editing}
      tone={tone}
      // Start (or Stop) stays in view on every row, not only on hover (owner, 2026-10-27).
      persistFixed
      lead={built ? lead : undefined}
      fixed={
        <>
          {/* While the launch runs the button says Cancel and spins, and stays
              focused (a launch can take long on a slow proxy: the way out is
              always there). Pressed, it says Cancelling and does nothing
              (aria-disabled, not disabled: the kit tooltip still shows, and
              no spinner: the word alone fills the button's 76 px). Stop
              comes once the launch returns (UI-30, A11Y-04). */}
          <Tooltip
            content={isStarting ? (isCancelling ? t("profileRowActions.cancellingTitle") : t("profileRowActions.cancelTitle")) : blocked ?? runLabel}
            shortcut={isStarting || blocked ? undefined : capOf(runCmd)}
          >
            <Button
              variant={isStarting ? "neutral" : isRunning ? "error" : "primary"}
              mode="lighter"
              size="3xsmall"
              // A dense row button: no press scale (S3).
              static
              data-tour={tourStart ? "start" : undefined}
              // The row buttons' inside ring (see rowButtonHoverClass).
              className="min-w-[76px] focus-ring-inset"
              leftIcon={
                isCancelling ? undefined
                : isStarting ? <SpinnerIcon className="size-3.5 animate-spin" />
                : (
                  <IconSwap
                    on={isRunning}
                    onIcon={rowActionIcons.stop({ className: "size-3.5" })}
                    offIcon={rowActionIcons.start({ className: "size-3.5" })}
                  />
                )
              }
              onClick={() => {
                if (isCancelling || blocked) return;
                if (isStarting) void useProfile.getState().cancelStart(p.id);
                else void useProfile.getState().startStop(p);
              }}
              tabIndex={tabIndex}
              // Named by its word, so the tooltip that repeats it adds no
              // description (A11Y-09); the key is declared here.
              aria-label={isStarting ? undefined : runLabel}
              aria-keyshortcuts={isStarting ? undefined : ariaOf(runCmd)}
              {...(isCancelling ? { "aria-disabled": true, "aria-busy": true, "data-loading": "" } : {})}
              disabled={!!blocked}
              {...(blocked ? { "aria-description": blocked, "data-blocked": "" } : {})}
            >
              {isCancelling ? t("profileRowActions.cancelling") : isStarting ? cancelLabel : runLabel}
            </Button>
          </Tooltip>
          <IconButton
            variant="neutral"
            mode="ghost"
            size="3xsmall"
            onClick={onMore}
            tabIndex={tabIndex}
            className={rowButtonHoverClass}
            icon={<MoreIcon className="size-3.5" />}
            label={t("profileRowActions.moreActions")}
            // The menu host sets aria-expanded while its menu is open.
            aria-haspopup="menu"
            aria-expanded="false"
          />
        </>
      }
    >
      {hover.map((c) => {
        // Fix round 1, finding 10: one stable label and glyph, "Pin", in both
        // states (the APG toggle-button pattern): only its color and
        // `aria-pressed` say "on". It runs Unpin when pinned; "Unpin" stays a
        // menu-only wording.
        const pin = isPin(c);
        const look = pin ? command("profile.pin") : c;
        // One that cannot run here says why in its own name (a team's rights).
        const why = reasonOf(c, { ids: [p.id] });
        return (
          <IconButton
            key={look.id}
            data-command={c.id}
            variant="neutral"
            mode="ghost"
            size="3xsmall"
            tabIndex={tabIndex}
            aria-pressed={pin ? p.pinned : undefined}
            // The most destructive one stays neutral at rest (Task 5e): the
            // owner does not want a permanent red slab on every row.
            className={cn("pointer-events-auto", c.danger ? rowButtonDangerHoverClass : rowButtonHoverClass)}
            icon={iconOf(look, cn("size-3.5", pin && p.pinned && "text-primary-text"))}
            label={why ? t("rights.labelWhy", { label: look.label(1), why }) : look.label(1)}
            disabled={!!why}
            shortcut={why ? undefined : capOf(c)}
            aria-keyshortcuts={ariaOf(c)}
            // A double click must not also run the second click's action on
            // whatever this button became (or on the row that slid under the
            // pointer): the click that matters already ran.
            onClick={(e) => { e.stopPropagation(); if (e.detail > 1) return; void runCommand(c, { ids: [p.id] }, { from: "hover" }); }}
          />
        );
      })}
    </RowHoverActions>
  );
}

/// The row's Start, Stop and Cancel as this language words them, drawn unseen once
/// in the list: the widest sets the actions' track (`setRunButtonWidth`), so the
/// button never runs over the icons beside it ("Остановить" is wider than 76 px).
export function RunButtonProbe() {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // As the row draws them: Cancelling alone has no icon.
  const words = [labelOf("profile.start"), labelOf("profile.stop"), labelOf("profile.cancelStart")];
  const bare = t("profileRowActions.cancelling");
  const key = [...words, bare].join("|");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setRunButtonWidth(Math.max(RUN_BUTTON_MIN, ...[...el.children].map((b) => (b as HTMLElement).offsetWidth)));
    read();
    let live = true;
    void document.fonts?.ready.then(() => { if (live) read(); });
    return () => { live = false; };
  }, [key]);
  return (
    <div ref={box} aria-hidden="true" inert className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max flex-col items-start overflow-hidden">
      {words.map((w) => (
        <Button key={w} variant="primary" mode="lighter" size="3xsmall" static tabIndex={-1} className="min-w-[76px]" leftIcon={<SpinnerIcon className="size-3.5" />}>
          {w}
        </Button>
      ))}
      <Button variant="primary" mode="lighter" size="3xsmall" static tabIndex={-1} className="min-w-[76px]">{bare}</Button>
    </div>
  );
}
