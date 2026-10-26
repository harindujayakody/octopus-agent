import { Fragment, useLayoutEffect, useState } from "react";
import { Kbd, Modal } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { useNav } from "../../../shared/model/navigation";
import { useShortcutSheet } from "../../../shared/model/shortcutSheet";
import { useNarrowWindow } from "../../../shared/hooks/useNarrowWindow";
import { sheetSections, type SheetRow, type SheetSection } from "../../commands";

/// Two columns of about the same height, each in the sheet's order: the first
/// section (the page's own list) opens the first column, then each other
/// section, longest first, goes to the shorter column. Both lists in one
/// column put 22 rows beside 14, taller than a 1280 x 800 window, so the body
/// would scroll at 100% (PC-113); balanced they are 18 and 18.
function columnsOf(sections: SheetSection[]): [SheetSection[], SheetSection[]] {
  const height = (s: SheetSection) => s.rows.length + 1;
  const [first, ...rest] = sections;
  const cols: [SheetSection[], SheetSection[]] = [first ? [first] : [], []];
  const sum = (c: SheetSection[]) => c.reduce((n, s) => n + height(s), 0);
  for (const s of [...rest].sort((a, b) => height(b) - height(a))) {
    (sum(cols[1]) < sum(cols[0]) ? cols[1] : cols[0]).push(s);
  }
  const order = (c: SheetSection[]) => sections.filter((s) => c.includes(s));
  return [order(cols[0]), order(cols[1])];
}

/// The keyboard map (`?`), read from the command registry: the page's own list
/// first, then the app's keys and the palette's, then the other list.
export function ShortcutSheet() {
  const t = useT();
  const open = useShortcutSheet((s) => s.open);
  const setOpen = useShortcutSheet((s) => s.setOpen);
  const section = useNav((s) => s.section);
  // Two columns from 720 layout px: Interface size counts, which a
  // `min-[720px]` media query would not (Task 14 review, Minor 2).
  const oneColumn = useNarrowWindow(720);
  const all = sheetSections(section);
  const [left, right] = columnsOf(all);
  // PC-113: in a short window (1024 x 680 at 150% is 453 layout px high) the
  // sheet is taller than the window. The body scrolls under the title, and
  // takes a Tab stop only while it scrolls, so the keyboard can scroll it too.
  // The body as it mounts (the Modal may mount it a render after `open`).
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  // What the Modal draws around this body, read from the Modal as drawn (in
  // layout px): its header over the body, and the backdrop's padding above
  // and below (72 today: 16 + 16 and a 40 px header). A new close button or
  // header size (C10, C20a) keeps the sheet inside the window.
  const [frame, setFrame] = useState(0);
  useLayoutEffect(() => {
    const el = body;
    if (!el) return;
    const panel = el.closest<HTMLElement>("[role='dialog']");
    const backdrop = panel?.parentElement;
    const check = () => {
      if (panel && backdrop) {
        const pad = getComputedStyle(backdrop);
        // Against the Modal's own body, which holds this one: since the kit
        // shell (Pair 29) the panel stops at the window and that body clips,
        // so this body's height would read the frame short until it settled.
        const holder = el.parentElement ?? el;
        setFrame(panel.offsetHeight - holder.offsetHeight + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom));
      }
      setScrolls(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [body, oneColumn]);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t("shortcuts.title")}
      closeLabel={t("shortcuts.close")}
      // Its own width, as the palette: lg (720) would grow it past its
      // 640 (owner: nothing bigger), and md (480) wraps its two columns.
      maxWidthClassName="max-w-[640px]"
      padded={false}
      motion="quick"
    >
      {/* The window less the Modal's frame. While it scrolls it is a named
          region with a Tab stop, so the keyboard can reach and scroll it. */}
      <div
        ref={setBody}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? "region" : undefined}
        aria-label={scrolls ? t("shortcuts.title") : undefined}
        style={{ maxHeight: `calc(var(--viewport-h) - ${frame}px)` }}
        className="overflow-y-auto px-inset-dialog py-inset focus-ring-inset"
      >
        {oneColumn ? (
          <div className="flex flex-col gap-5">{all.map((s) => <Group key={s.area} section={s} />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8">
            <div className="flex flex-col gap-5">{left.map((s) => <Group key={s.area} section={s} />)}</div>
            <div className="flex flex-col gap-5">{right.map((s) => <Group key={s.area} section={s} />)}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// The group title keeps its 12 px: `text-section-title` is 13, and nothing
// grows past its size before Phase B (owner rule, R26). It reads as the
// palette's group names do, over the same commands.
function Group({ section }: { section: SheetSection }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 mb-1 text-secondary font-medium text-text-soft-400">{section.title}</h3>
      {section.rows.map((row) => <Row key={row.ids.join(" ")} row={row} />)}
    </section>
  );
}

/// A key the Single-key shortcuts switch turned off keeps its row, its caps
/// greyed and the word "Off" after them: a word, not only a grey cap (O14).
/// 26 px rows (28 before Pair 62): with C on the Proxies list too, the taller
/// column at 100% in a 1280 x 800 window still fits whole (PC-113).
function Row({ row }: { row: SheetRow }) {
  const t = useT();
  return (
    <div data-sheet-row data-commands={row.ids.join(" ")} data-off={row.off || undefined} className="flex min-h-[26px] items-center justify-between gap-3 text-ui text-text-strong-950">
      <span>{row.label}</span>
      <span className="flex shrink-0 items-center gap-1 text-secondary text-text-soft-400">
        {row.keys.map((k, i) => (
          <Fragment key={i}>
            {i > 0 && row.join === "or" && <span aria-hidden="true">/</span>}
            {i > 0 && row.join === "to" && <span aria-hidden="true">–</span>}
            {k.caps.map((cap, j) => (
              <Fragment key={j}>
                {j > 0 && <span>{t("shortcuts.then")}</span>}
                <Kbd className={row.off ? "text-text-disabled-300!" : undefined}>{cap}</Kbd>
              </Fragment>
            ))}
          </Fragment>
        ))}
        {row.off && <span>{t("shortcuts.off")}</span>}
      </span>
    </div>
  );
}
