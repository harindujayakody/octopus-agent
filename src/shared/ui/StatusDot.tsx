import { cn } from "@proxyshard/shardx-ui-kit";

/// The six looks a status dot can have (owner feedback 5i: colors on top of
/// the word, never instead of it). `success`/`info`/`warning`/`error` use
/// the same `--color-*-text` token the Alert and toast icons use — one
/// color per state everywhere (fix round 1, ruling C2), not the plain
/// `-base` color: `-text` is already the token the kit darkens per theme to
/// stay readable (Batch 1's fix round darkened light's `--success-text`/
/// `--warning-text` for exactly this kind of use), so reusing it here
/// means a dot's contrast moves with the kit's own token, not a second,
/// unrelated fix. `neutral` and `outline` are measured separately below.
export type StatusDotTone = "success" | "info" | "warning" | "error" | "neutral" | "outline";

// Every tone here was checked with WCAG 1.4.11 (non-text contrast, 3:1) in
// both themes, against every row background a dot ever sits on (a row's own
// surface, its hover fill and its selected tint) — see the batch report for
// the numbers. `neutral` and `outline` use the idle role (`--idle`, the
// stopped dot, audit Phase B COLOR-06), not the soft text color: one gray
// for "not running" everywhere, which `npm run check:contrast` measures at
// 3:1 on the canvas, the surface and a hovered, active or checked row.
// Fix round 1, finding 7: forced colors (Windows High Contrast) repaints
// every author `background-color` as Canvas, so a filled dot vanished
// entirely (confirmed: only the `outline` tone's border, which forced
// colors leaves alone, survived). `forced-color-adjust-none` opts the dot
// back out of that repaint, and `bg-[CanvasText]` still respects the
// user's chosen palette (CanvasText is a forced-colors system color, not a
// fixed color) rather than hard-coding black.
const FORCED_COLORS_FILLED = "forced-colors:forced-color-adjust-none forced-colors:bg-[CanvasText]";

const TONE_CLASS: Record<StatusDotTone, string> = {
  success: cn("bg-success-text", FORCED_COLORS_FILLED),
  info: cn("bg-information-text", FORCED_COLORS_FILLED),
  warning: cn("bg-warning-text", FORCED_COLORS_FILLED),
  error: cn("bg-error-text", FORCED_COLORS_FILLED),
  neutral: cn("bg-idle", FORCED_COLORS_FILLED),
  outline: "border-[1.5px] border-idle bg-transparent",
};

/// One 8 px round status marker, always `aria-hidden` and always meant to
/// sit right next to the word that actually carries the state (the owner's
/// rule: a dot alone never is the status). `pulse` is the pending signal,
/// like a spinner: an opacity pulse, nothing moves, so it keeps going under
/// Reduce motion (the OS or Settings; audit Phase B Task 15 ruling) instead
/// of freezing into a dot that looks settled. `halo` gives the Running dot
/// its soft ring (Live layer, spec 6.2), the one glow the app has, drawn by
/// the kit's `halo` utility; `animate-halo-once` and `animate-breathe` on
/// `className` swell or breathe the ring, never the dot.
export function StatusDot({ tone, pulse, halo, className }: {
  tone: StatusDotTone;
  /** The state is still resolving (Starting, Testing): the dot pulses. */
  pulse?: boolean;
  /** A running profile's dot: a soft ring around it. */
  halo?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      data-halo={halo ? "" : undefined}
      className={cn(
        "inline-block size-[7px] shrink-0 rounded-full",
        TONE_CLASS[tone],
        pulse && "animate-pulse",
        halo && "halo",
        className,
      )}
    />
  );
}
