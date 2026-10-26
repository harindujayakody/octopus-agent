import { forwardRef, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";
import { textWidth } from "../../lib/measureText";

/// The rows of one Peek's property sheet share one label column, as wide as
/// the longest label the sheet shows in the current language, so no label is
/// ever cut ("Operating system", merge point 4 ruling). Each row caps it at
/// 40 % of its width, where a longer label wraps to two lines instead.
/// Measured after every render (a language, an OS with a Screen row): the
/// widths are cached, so a render costs a lookup per label.
export function PropertySheet({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const labels = [...(ref.current?.querySelectorAll<HTMLElement>("[data-property-label]") ?? [])];
    if (labels.length === 0) return;
    const cs = getComputedStyle(labels[0]);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const widest = Math.max(...labels.map((l) => textWidth(l.textContent ?? "", font)));
    // 2 px over the canvas's measure: the page may round a glyph up. Set
    // before the first paint, and again only when it changes.
    setWidth(`${Math.ceil(widest) + 2}px`);
  });
  return <div ref={ref} style={width ? ({ "--property-label": width } as CSSProperties) : undefined}>{children}</div>;
}

/// One property of the object in Peek (O4, CRAFT-01): a muted label and its
/// value, which opens a picker in place. 32 px tall, so a whole profile fits
/// where one stacked section used to. A value on more lines (Tags) keeps the
/// label on its first line. The label column is its PropertySheet's (96 px
/// outside one).
export function PropertyRow({ id, label, children }: { id: string; label: string; children: (labelId: string) => ReactNode }) {
  const labelId = useId();
  return (
    <div data-property={id} className="grid min-h-[32px] grid-cols-[min(var(--property-label,96px),40%)_minmax(0,1fr)] items-start gap-2">
      <span id={labelId} data-property-label className="min-w-0 py-2 text-secondary text-text-soft-400">{label}</span>
      <div className="flex min-h-[32px] min-w-0 items-center">{children(labelId)}</div>
    </div>
  );
}

/// A property's value as a borderless trigger that opens its picker (plan
/// ruling 27). Named "<label> <value>" ("Folder Ads"), so a screen reader
/// hears both. The ring is drawn inside: the rows sit 32 px apart and a ring
/// outside would lie over the next row's value.
export const PropertyButton = forwardRef<HTMLButtonElement, {
  labelledBy: string;
  /** No value: the text is a muted placeholder ("No folder"). */
  empty?: boolean;
  expanded?: boolean;
  popup?: "dialog" | "menu";
  busy?: boolean;
  /** The value may take more lines (Tags: every chip stays readable). */
  wrap?: boolean;
  onClick: () => void;
  children: ReactNode;
}>(function PropertyButton({ labelledBy, empty, expanded, popup = "dialog", busy, wrap, onClick, children }, ref) {
  const valueId = useId();
  return (
    // eslint-disable-next-line no-restricted-syntax -- a property value that opens its picker in place (plan ruling 27): borderless and full width, which no kit Button variant is
    <button
      ref={ref}
      type="button"
      aria-labelledby={`${labelledBy} ${valueId}`}
      aria-haspopup={popup}
      aria-expanded={expanded}
      aria-busy={busy || undefined}
      onClick={onClick}
      className={cn(
        "focus-ring-inset flex w-full min-w-0 items-center rounded-control px-1.5 text-left text-ui transition-hover hover:bg-bg-hover aria-expanded:bg-bg-hover active:bg-bg-active",
        wrap ? "my-0.5 min-h-[28px] py-1" : "h-[28px]",
        empty ? "text-text-soft-400" : "text-text-strong-950",
      )}
    >
      <span id={valueId} className={cn("flex min-w-0 flex-1 items-center gap-1.5", wrap ? "flex-wrap" : "overflow-hidden")}>{children}</span>
    </button>
  );
});

/// A property's value, read: the same 28 px line a picker's button sits on,
/// with no hover, so a row's text keeps its place between a panel that shows
/// it and the form that edits it. An empty one is a muted state ("No
/// folder"); `wrap` lets a long one (Tags, Notes) take more lines.
export function PropertyValue({ empty, wrap, className, children }: { empty?: boolean; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-ui",
        wrap ? "my-0.5 min-h-[28px] flex-wrap py-1" : "h-[28px] overflow-hidden",
        empty ? "text-text-soft-400" : "text-text-strong-950",
        className,
      )}
    >
      {children}
    </span>
  );
}
