import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DismissButton, IconButton, Menu, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { MoreIcon } from "../../icons";

/** Peek's header height, px. 40, not the list's 32 px column header: the
 *  owner found 32 too tight (2026-10-01), so the controls keep their sizes
 *  and sit centered with about 8 px above and below, and the line-up with
 *  the list's header rule (LAYOUT-03) is dropped for Peek. */
export const PEEK_HEADER_HEIGHT = 40;

/// Peek's header, the same on every Peek (LAYOUT-12, IFACE-12), with no line
/// under it (borderless, owner 2026-10-01): the object's name, its state, Edit
/// (a Peek only shows; the form or dialog it opens saves by hand), its one main
/// action, a `…` menu with the rest of its actions, and Close.
export function PeekHeader({ subject, title, status, primary, extra, menuItems, menuLabel, closeLabel, closeShortcut, onClose }: {
  /** The object shown (its id): a word or a menu of the last one never carries to the next (PC-053). */
  subject: string;
  title: ReactNode;
  status?: ReactNode;
  primary?: ReactNode;
  /** Before the main action (Edit). */
  extra?: ReactNode;
  menuItems?: MenuItem[];
  menuLabel: string;
  closeLabel: string;
  /** The key that closes it (Esc), in Close's tooltip (UI-29). */
  closeShortcut?: string;
  onClose: () => void;
}) {
  const header = useRef<HTMLDivElement>(null);
  useCompactPeek(header);
  return (
    <div
      ref={header}
      data-peek-header
      style={{ height: PEEK_HEADER_HEIGHT }}
      className="flex shrink-0 items-center gap-2 pl-inset pr-1.5"
    >
      <div className="flex min-w-0 items-center">{title}</div>
      {status}
      {/* The one flexible gap: the status follows the name, the rest sits at the right end. */}
      <span aria-hidden="true" className="min-w-0 flex-1" />
      {extra && <span data-peek-extra className="contents">{extra}</span>}
      {primary}
      {menuItems && menuItems.length > 0 && <MoreMenu key={`menu-${subject}`} items={menuItems} label={menuLabel} />}
      <DismissButton onClick={onClose} label={closeLabel} shortcut={closeShortcut} />
    </div>
  );
}

/** How much of the name and the state the header cuts now, px. */
function cut(h: HTMLElement): number {
  let n = 0;
  for (const el of h.querySelectorAll<HTMLElement>(".truncate")) {
    if (!el.closest("button")) n += Math.max(0, el.scrollWidth - el.clientWidth);
  }
  return n;
}

/// A header that would cut the name or the state (a long name, Russian words)
/// shows Edit as its icon alone (`data-compact`, app.css): measured, not set by
/// a width, as the page header does (compact.ts).
function useCompactPeek(ref: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const h = ref.current;
    if (!h) return;
    const run = () => {
      // Laid out with its words first; compact only when those cut something.
      delete h.dataset.compact;
      if (cut(h) > 0.5) h.dataset.compact = "";
    };
    run();
    const sized = new ResizeObserver(run);
    sized.observe(h);
    // Another name, state or word: not its own attribute, which it writes.
    const changed = new MutationObserver(run);
    changed.observe(h, { subtree: true, childList: true, characterData: true });
    let live = true;
    void document.fonts?.ready.then(() => { if (live) run(); });
    return () => { live = false; sized.disconnect(); changed.disconnect(); };
  }, [ref]);
}

function MoreMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={anchor}
        size="3xsmall"
        label={label}
        icon={<MoreIcon className="size-3.5" />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      <Menu open={open} onOpenChange={setOpen} anchor={anchor} align="end" aria-label={label} items={items} />
    </>
  );
}
