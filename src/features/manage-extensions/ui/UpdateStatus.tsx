import { Badge, Tooltip, type BadgeColor } from "@proxyshard/shardx-ui-kit";
import { AlertCircleIcon } from "../../../shared/icons";
import { conflictFromSync, goneFromStore, percentOf, type ExtensionUpdate } from "../../../entities/extension";
import { useT, type T } from "../../../shared/i18n";
import { explainError } from "../../../shared/lib/errors";
import { fmtList } from "../../../shared/lib/format";
import { fmtTs } from "../../../shared/lib/utils";
import { useGpuCompat } from "../../../shared/model/gpuCompat";
import { sentences } from "../lib/sentences";

type Status = { text: string; color: BadgeColor; tip?: string };

/** An update's state in words (§3.7, the contract's table); none while there is
 *  nothing to say. `engine`: the browser engine here, when known. */
function statusOf(t: T, u: ExtensionUpdate, engine: string | undefined): Status | null {
  // A flagged one's version is no invitation: the red mark says enough.
  const flagged = u.flags.length > 0;
  switch (u.state) {
    case "available": case "ready":
      return u.latest && !flagged ? { text: t("extensions.updateBadge", { version: u.latest }), color: "warning" } : null;
    case "confirm":
      return u.latest && !flagged ? { text: t("extensions.confirmBadge", { version: u.latest }), color: "warning", tip: t("extensions.confirmBadgeHelp") } : null;
    case "downloading": case "applying": {
      const p = u.state === "applying" ? null : percentOf(u.progress);
      return { text: p === null ? t("extensions.updating") : t("extensions.updatingPercent", { percent: p }), color: "information" };
    }
    case "waiting": {
      const n = u.waiting_on.length;
      const text = n === 0 ? t("extensions.waitingLauncher") : n === 1 ? t("extensions.waitingOne", { n }) : t("extensions.waitingMany", { n });
      const tip = sentences([
        n > 0 ? t("extensions.waitingOn", { names: fmtList(u.waiting_on.map((h) => h.name)) }) : t("extensions.waitingLauncherHelp"),
        u.ready_since ? t("extensions.readySince", { date: fmtTs(`@${u.ready_since}`) }) : "",
      ]);
      return { text, color: "information", tip: tip || undefined };
    }
    case "failed":
      // Taken down from the Web Store: not an update that failed.
      if (goneFromStore(u)) return { text: t("extensions.goneBadge"), color: "gray", tip: t("extensions.goneHelp") };
      return { text: t("extensions.updateFailedBadge"), color: "error", tip: u.error ? explainError(u.error) : undefined };
    case "needs_engine":
      return { text: t("extensions.needsEngine", { version: u.needs_engine ?? "" }), color: "warning", tip: engine ? t("extensions.engineHere", { version: engine }) : undefined };
    case "id_conflict":
      return { text: conflictFromSync(u) ? t("extensions.idConflict") : t("extensions.idConflictStore"), color: "gray", tip: t("extensions.idConflictHelp") };
    default: return null;
  }
}

/** Badge text may wrap: a long one in Russian stays inside a 280 px card. In
 *  forced colors the tint goes, so an edge keeps each badge apart. */
const WRAP = "max-w-full whitespace-normal! justify-start! text-start! forced-edge";

/** A badge, its details on hover and, for a screen reader, in words. A red one
 *  leads with a mark, so it stands apart where colors do not show. */
function Said({ status, ...data }: { status: Status } & Record<`data-${string}`, boolean>) {
  const lead = status.color === "error" ? <AlertCircleIcon className="size-3.5" /> : undefined;
  const badge = <Badge size="small" color={status.color} lead={lead} className={WRAP} {...data}>{status.text}</Badge>;
  if (!status.tip) return badge;
  return (
    <>
      <Tooltip content={status.tip}><span className="flex max-w-full">{badge}</span></Tooltip>
      <span className="sr-only">{status.tip}</span>
    </>
  );
}

/// A card's update line: the Web Store's harmful mark at any state, then
/// where the update stands. `linking`: a Link to Web Store under way, whose
/// download is no update.
export function UpdateStatus({ update: u, linking = false }: { update: ExtensionUpdate | undefined; linking?: boolean }) {
  const t = useT();
  const engine = useGpuCompat((s) => s.caps?.engine_version);
  if (!u) return null;
  const status = linking ? { text: t("extensions.linkingBadge"), color: "information" as const } : statusOf(t, u, engine);
  const flagged = u.flags.length > 0;
  if (!status && !flagged) return null;
  return (
    <div data-update-state={linking ? "linking" : u.state} className="flex min-w-0 flex-wrap items-start gap-1.5">
      {flagged && <Said status={{ text: t("extensions.flagged"), color: "error", tip: t("extensions.flaggedHelp") }} data-flagged />}
      {status && <Said status={status} data-update-badge />}
    </div>
  );
}
