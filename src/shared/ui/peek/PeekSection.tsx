import { useId, type ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";

/// One titled part of a Peek, the same on every Peek (UI-18). The title is
/// the small muted section label (sentence case, owner 2026-10-01), an h3
/// under the panel's h2: a title over fields, not one of them. A soft
/// hairline sits between two sections (owner, 2026-10-02: "i need dividers on
/// peek"), none above the first.
/// `action` sits at the title's right end: a quiet "Edit" that opens the
/// section in its form.
export function PeekSection({ id, title, children, className, action }: { id: string; title: string; children: ReactNode; className?: string; action?: ReactNode | ((titleId: string) => ReactNode) }) {
  const titleId = useId();
  return (
    <section
      data-peek-section={id}
      aria-labelledby={titleId}
      className={cn("flex flex-col px-inset py-[20px] [[data-peek-section]+&]:border-t [[data-peek-section]+&]:border-stroke-soft-200", className)}
    >
      {action ? (
        <div className="mb-stack-md flex min-h-0 items-center justify-between gap-2">
          <h3 id={titleId} className="m-0 text-section-label text-text-soft-400">{title}</h3>
          {typeof action === "function" ? action(titleId) : action}
        </div>
      ) : (
        <h3 id={titleId} className="m-0 mb-stack-md text-section-label text-text-soft-400">{title}</h3>
      )}
      <div className="flex flex-col gap-[16px]">{children}</div>
    </section>
  );
}
