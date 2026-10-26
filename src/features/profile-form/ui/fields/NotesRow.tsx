import { useLayoutEffect, useRef } from "react";
import { PropertyRow } from "../../../../shared/ui/peek";
import { useT } from "../../../../shared/i18n";

/// Notes, a row of the sheet like the others (merge point 4 review, I7): no
/// frame and no grip, a quiet fill while it is typed into. It shows all its
/// text, wrapped, at rest and while typed into: the height follows the
/// content by whole lines, with no cap and no scrollbar of its own (owner,
/// 2026-10-02). The browser sizes it (`field-sizing: content`); an engine
/// without that measures it.
export function NotesRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content"))) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // A width change (the dialog resized) rewraps the text.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return (
    <PropertyRow id="notes" label={t("peek.notes")}>
      {(labelId) => (
        // eslint-disable-next-line no-restricted-syntax -- a property value typed in place: borderless, one line at rest, which the kit Textarea (framed, 71 px, a grip) is not
        <textarea
          ref={ref}
          rows={1}
          aria-labelledby={labelId}
          value={value}
          placeholder={t("peek.notesPlaceholder")}
          onChange={(e) => onChange(e.target.value)}
          className="my-0.5 block min-h-[28px] w-full min-w-0 resize-none overflow-hidden rounded-control [field-sizing:content] bg-transparent px-1.5 py-1 text-ui text-text-strong-950 transition-hover placeholder:text-text-soft-400 focus:bg-bg-hover focus:outline-hidden"
        />
      )}
    </PropertyRow>
  );
}
