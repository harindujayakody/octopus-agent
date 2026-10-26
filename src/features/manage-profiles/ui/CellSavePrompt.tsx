import { useRef } from "react";
import { Button, Popover } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";

/// The question under a cell whose field lost the keyboard with a change in
/// it (manual save, owner 2026-10-07): "Save this change?", with Save under
/// the keyboard and Don't save beside it. Esc or a press elsewhere is neither
/// answer: the field comes back with what was typed.
export function CellSavePrompt({ open, anchorRef, onSave, onDiscard, onKeep }: {
  open: boolean;
  /** The field it asks about. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onSave: () => void;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  const t = useT();
  const saveRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => { if (!o) onKeep(); }}
      anchorRef={anchorRef}
      align="start"
      aria-label={t("cellSave.title")}
      initialFocusRef={saveRef}
      className="w-[232px] p-[12px]"
    >
      <p className="m-0 text-ui text-text-strong-950">{t("cellSave.title")}</p>
      <div className="mt-[12px] flex justify-end gap-[8px]">
        <Button size="xsmall" variant="neutral" mode="stroke" onClick={onDiscard}>{t("cellSave.dontSave")}</Button>
        <Button ref={saveRef} size="xsmall" onClick={onSave}>{t("cellSave.save")}</Button>
      </div>
    </Popover>
  );
}
