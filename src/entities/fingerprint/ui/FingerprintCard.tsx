import { Badge, cn, Tooltip } from "@proxyshard/shardx-ui-kit";
import type { FingerprintEntry } from "../model/types";
import { useGpuCompat, useGpuCompatReady } from "../../../shared/model/gpuCompat";
import { useT } from "../../../shared/i18n";

/// One library fingerprint in the grid: what tells it apart (CRAFT-30). The
/// screen and the cores, not the GPU twice (its label names it; the whole
/// renderer is on hover and in Peek); the Chrome version only when it is not
/// the engine's own (plan ruling 13). A card body, not a button: the grid
/// item around it (the kit DataList's) takes focus and opens Peek, so the
/// card holds no control of its own (IFACE-11).
export function FingerprintCard({ entry, inPeek }: {
  entry: FingerprintEntry;
  /** Peek shows this one. */
  inPeek: boolean;
}) {
  const t = useT();
  // undefined while the GPU probe has not answered yet, and on machines where
  // it cannot run at all. Both are "no verdict", and no verdict must not look
  // like a clean one: the badge shows only on a definite mismatch.
  useGpuCompatReady();
  const compat = useGpuCompat((s) => s.byId[entry.id]);
  const engine = useGpuCompat((s) => s.caps?.engine_version);
  const screen = entry.payload?.screen;
  const cores = entry.payload?.navigator?.hardware_concurrency;
  const facts = [
    screen?.width && screen?.height ? `${screen.width} × ${screen.height}` : null,
    cores ? t("fingerprintCard.cores", { n: cores }) : null,
  ].filter(Boolean).join(", ");
  return (
    <div
      data-fingerprint-id={entry.id}
      data-selected={inPeek ? "" : undefined}
      className={cn(
        // Content only: the grid item around it is the tile (the kit
        // DataList's: the weak fill, one step up on hover), so this has no
        // frame, fill or hover of its own. It fills its grid cell.
        "flex h-full w-full cursor-pointer flex-col gap-1.5 rounded-tile px-cell py-[10px]",
        // The one in Peek keeps its own surface; one ring says so (owner).
        // While the grid item has the keyboard, its focus ring is that ring,
        // in the same place, so this one goes clear: never two. (Clear, not
        // none: a contrast theme draws both, on the same line.)
        inPeek && "selected-ring group-focus-visible:outline-hidden",
      )}
    >
      {/* pe-5: room for the card's More button (top right, on hover), so it never sits on the label. */}
      <span className="line-clamp-2 pe-5 text-secondary font-medium leading-[1.3] text-text-strong-950">{entry.label}</span>
      {/* The renderer, whole, on hover (TYPE-07); Peek has it too. */}
      <Tooltip content={entry.gpu || "—"}>
        <span className="truncate text-secondary text-text-soft-400">{facts || entry.gpu || "—"}</span>
      </Tooltip>
      <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
        {/* A plain badge: nothing focusable inside the card. Peek explains the mismatch. */}
        {compat && !compat.compatible && <Badge color="warning" size="small">{t("incompatibleNotice.badgeLabel")}</Badge>}
        {entry.chrome && engine && entry.chrome !== engine && <Badge color="gray" size="small">Chrome {entry.chrome}</Badge>}
      </span>
    </div>
  );
}
