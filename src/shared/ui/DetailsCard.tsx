import { useId, type ReactNode } from "react";
import { Card, CopyButton } from "@proxyshard/shardx-ui-kit";
import { useT } from "../i18n";
import { clip, copySecret } from "../lib/clipboard";
import { toast } from "../model/toast";

/// Facts about one thing, read and not edited (owner, "more air, clearer
/// hierarchy"): its title at the top, then rows of a soft label and a strong
/// value. A value someone might copy (an address, a key, a version, a path)
/// has a quiet copy button, and the copy says "Copied" in a toast.
/// Compact on its tile (borderless, owner 2026-10-01): 10 px above and 14 at
/// the sides, rows of at least 34 px with a 96 px label column, and no line
/// between rows: the rows read on their spacing.
export function DetailsCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <Card data-details={id} padding="none" role="group" aria-labelledby={titleId} className="flex flex-col px-[14px] pt-[10px] pb-[4px]">
      <h3 id={titleId} className="m-0 mb-[2px] text-section-title text-text-strong-950">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </Card>
  );
}

export function DetailRow({ id, label, copy, children }: {
  id: string;
  label: string;
  /** The value to copy (a secret clears from the clipboard after a minute). */
  copy?: { value: string; secret?: boolean };
  children: ReactNode;
}) {
  const t = useT();
  const onCopy = async () => {
    if (!copy) return;
    try {
      if (copy.secret) {
        await copySecret(copy.value);
        toast.ok(t("clipboard.copiedSecret"));
      } else {
        await clip.write(copy.value);
        toast.ok(t("kit.copied"));
      }
    } catch (e) {
      toast.fail({ title: t("copyField.failed"), detail: e });
      throw e;
    }
  };
  return (
    <div data-detail={id} className="grid min-h-[34px] grid-cols-[96px_minmax(0,1fr)_24px] items-center gap-[10px]">
      <span className="min-w-0 text-secondary text-text-soft-400">{label}</span>
      <span data-detail-value data-selectable className="min-w-0 truncate text-ui tabular-nums text-text-strong-950">{children}</span>
      {copy ? <CopyButton label={t("details.copy", { label })} onCopy={onCopy} /> : <span aria-hidden />}
    </div>
  );
}
