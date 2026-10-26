import { useId, useRef, type MouseEvent, type ReactNode } from "react";
import { Card } from "@proxyshard/shardx-ui-kit";
import type { Settings } from "../../entities/settings";
import type { LocalPrefs, PrefKey } from "./localPrefs";

/** What every section that edits settings receives: the settings as the
 *  page's draft holds them and a setter that changes the draft, and the same
 *  for this window's own preferences (`p`, `setP`). Nothing is written until
 *  Save; the language, theme, size and motion are previewed meanwhile. */
export type SettingsProps = {
  s: Settings;
  setS: (next: Settings) => void;
  p: LocalPrefs;
  setP: <K extends PrefKey>(key: K, value: LocalPrefs[K]) => void;
};

/// One setting (LAYOUT-16): its name and at most one line of help leading,
/// its control trailing; anything bigger (a text box, a disclosure) goes
/// below, full width. The control is named by the row's title and described
/// by its help (`aria-labelledby`, `aria-describedby`). A switch row toggles
/// from a click anywhere on it, once (owner rule for rows that hold a check).
export function SettingRow({ id, title, help, control, below }: {
  id: string;
  /** Words, or words with a mark before them (Sync's status). */
  title: ReactNode;
  help?: ReactNode;
  /** `helpId` is the help's id, for `aria-describedby`. */
  control?: (ids: { labelId: string; helpId: string | undefined }) => ReactNode;
  below?: ReactNode;
}) {
  const labelId = useId();
  const helpId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const onClick = (e: MouseEvent) => {
    const toggle = controlRef.current?.querySelector<HTMLInputElement>("input[role='switch']:not(:disabled)");
    const target = e.target as Element;
    // The switch's own click toggles it already; a link or button in the
    // help is its own (Learn more); a drag that selected text is not a click on the row.
    if (!toggle || controlRef.current?.contains(target) || target.closest("[data-setting-below], a, button")) return;
    if (!window.getSelection()?.isCollapsed) return;
    toggle.click();
  };
  return (
    <div
      data-setting={id}
      onClick={onClick}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3 has-[input[role=switch]:not(:disabled)]:cursor-pointer"
    >
      <div className="min-w-0">
        <div id={labelId} className="text-ui text-text-strong-950">{title}</div>
        {help && <p id={helpId} data-setting-help className="m-0 mt-0.5 max-w-[72ch] text-balance! text-help text-text-sub-600">{help}</p>}
      </div>
      {control && (
        <div ref={controlRef} className="flex shrink-0 items-center justify-end">
          {control({ labelId, helpId: help ? helpId : undefined })}
        </div>
      )}
      {below && <div data-setting-below className="col-span-2 cursor-auto pt-2.5">{below}</div>}
    </div>
  );
}

/// A tab's settings as one tile of rows with no lines between them (borderless,
/// owner 2026-10-01: each row's own padding spaces it); an optional section title above it, and one line of help for
/// a list of rows that has no row to carry it (Tags, Views).
export function SettingsGroup({ title, help, list, children }: { title?: string; help?: ReactNode; /** A list of rows (Tags, Views): a `list-tile` whose rows have the inset line between them, not a tile of settings. */ list?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h3 className="m-0 text-section-title text-text-strong-950">{title}</h3>}
      {help && <p data-group-help className="m-0 max-w-[72ch] text-balance! text-help text-text-sub-600">{help}</p>}
      {list ? <div className="list-tile pt-1">{children}</div> : <Card padding="none" className="px-4">{children}</Card>}
    </section>
  );
}
