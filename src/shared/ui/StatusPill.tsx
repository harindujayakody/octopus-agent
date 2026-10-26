import type { HTMLAttributes, ReactNode } from "react";
import { Badge, cn, type BadgeColor } from "@proxyshard/shardx-ui-kit";
import type { ProfileStatus, ProfileStatusTone } from "../../entities/profile/lib/status";
import { useT } from "../i18n";
import { AlertCircleIcon, SpinnerIcon } from "../icons";
import { StatusDot } from "./StatusDot";

/// The Live layer's one pill (spec 4.2): a state as a tinted, fully rounded
/// Badge, 18 px tall like the row's Tag and Folder chips. The word always
/// shows and carries the state (owner: no dot-only status); the lead, a dot
/// or a spinner in the Badge's 14 px slot, is decoration. The pills map data
/// to a tone, so no screen picks pill colors by hand. Every pill takes the
/// span's own attributes too (a Tooltip's `aria-describedby`, a `data-*`).

type SpanProps = Omit<HTMLAttributes<HTMLSpanElement>, "children" | "color">;

const spinner = <SpinnerIcon className="size-3.5 animate-spin" />;

/** Its word, alone, for the lists' "just the visible word" hook. */
const Word = ({ children }: { children: ReactNode }) => (
  <span data-status-label className="min-w-0 truncate">{children}</span>
);

// Spec 4.2's table. The dot's own color comes from `status.dot`, the one
// dot mapping Peek, the sidebar and the palette share.
const PILL_OF_TONE: Record<ProfileStatusTone, { color: BadgeColor; lead: "dot" | "spinner" | null }> = {
  running: { color: "success", lead: "dot" },
  starting: { color: "information", lead: "spinner" },
  stopping: { color: "information", lead: "spinner" },
  saving: { color: "information", lead: "spinner" },
  failed: { color: "error", lead: null },
  idle: { color: "gray", lead: "dot" },
  never: { color: "gray", lead: "dot" },
  warning: { color: "warning", lead: null },
  cancelled: { color: "gray", lead: "dot" },
  elsewhere: { color: "information", lead: "dot" },
};

/** A profile's state: Running, Starting, Stopping, Cancelled, Failed to start,
 *  its last run, Never run or Proxy missing. `status.detail` is not drawn: the cell
 *  that shows the pill gives it its Tooltip and its visually hidden text.
 *  `swell`: the profile has just started from this window, so the Running
 *  dot's halo swells once (spec 6.2); the caller takes it off once played. */
export function StatusPill({ status, swell = false, className, ...rest }: { status: ProfileStatus; swell?: boolean } & SpanProps) {
  const { color, lead } = PILL_OF_TONE[status.tone];
  const running = status.tone === "running";
  return (
    <Badge
      {...rest}
      shape="pill"
      color={color}
      data-pill="status"
      data-state={status.tone}
      className={cn("max-w-full", className)}
      lead={lead === "spinner" ? spinner : lead === "dot" ? <StatusDot tone={status.dot} halo={running} className={running && swell ? "animate-halo-once" : undefined} /> : null}
    >
      <Word>{status.label}</Word>
    </Badge>
  );
}

/** A proxy's last test: "OK {ms} ms", "Failed" or "Not tested", or
 *  "Testing…" with a spinner while a test runs, whatever the last result
 *  was. `detail` (when and why) is read out with the word, never drawn:
 *  hover shows it through the cell's Tooltip. */
export function ProxyTestPill({ state, busy, ms, detail, className, ...rest }: (
  /** A reached proxy says how fast: its last test's TCP time, in ms. */
  | { state: "ok"; ms: number }
  | { state: "failed" | "untested"; ms?: never }
) & { busy: boolean; detail?: string } & SpanProps) {
  const t = useT();
  const color: BadgeColor = busy ? "information" : state === "ok" ? "success" : state === "failed" ? "error" : "gray";
  const word = busy ? t("proxyTestResult.testing")
    : state === "ok" ? t("proxyTestResult.ok", { ms })
    : state === "failed" ? t("proxyTestResult.failed")
    : t("proxyTestResult.notTested");
  return (
    <Badge
      {...rest}
      shape="pill"
      color={color}
      data-pill="proxy-test"
      data-state={busy ? "testing" : state}
      // Figures line up down the column, and a Retest from 98 to 120 ms keeps the pill's width.
      className={cn("max-w-full tabular-nums", className)}
      // A failed test has its own shape, not only a hue (A11Y-18).
      lead={busy ? spinner : state === "failed" ? <AlertCircleIcon data-failed-mark className="size-3.5" /> : null}
    >
      <Word>{word}</Word>
      {/* No leading punctuation: the accessible name joins it with a space. */}
      {detail && <span className="sr-only">{detail}</span>}
    </Badge>
  );
}
