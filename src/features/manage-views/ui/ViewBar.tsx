import { useEffect, useLayoutEffect, useRef } from "react";
import { Badge, Button, IconButton } from "@proxyshard/shardx-ui-kit";
import { AddIcon, CloseIcon, CopyIcon, SaveIcon, UndoIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { isMod, overlayHasKeyboard } from "../../../shared/lib/keyboard";
import { toast } from "../../../shared/model/toast";
import { useUnsaved } from "../../../shared/model/unsaved";
import { currentQuery, useCurrentView, useProfileUi, useViewEditing, useViewModified, useViews } from "../../../entities/profile";

/// Beside the Profiles title while a View's list has been changed: says so,
/// puts the View back, and keeps the change: into a custom View, which can
/// also go to a new View as a copy (Pair 24 review, Important 1), or as a new
/// View for a built-in (those cannot change). Below 960 px of header the
/// actions are icons (the header's container query: the 1024 px window's
/// header is 926 px wide, the 1280 px window's 998), so the header still
/// fits the smallest window and the title keeps its room (LAYOUT-05).
///
/// While a custom View is being edited ("Edit view") it says so instead, with
/// Cancel and Save view: the View's own filters are open then, and nothing is
/// written to the View until Save view (manual save). An edit that differs
/// from the saved View joins the unsaved-changes guard, and Cmd/Ctrl+S saves it.
export function ViewBar() {
  const t = useT();
  const view = useCurrentView();
  const modified = useViewModified();
  const editing = useViewEditing();
  const resetView = useProfileUi((s) => s.resetView);
  const cancelViewEdit = useProfileUi((s) => s.cancelViewEdit);
  const finishViewEdit = useProfileUi((s) => s.finishViewEdit);
  const setViewDialog = useProfileUi((s) => s.setViewDialog);
  const update = useViews((s) => s.update);

  /** Writes the list's query (filters, order, columns) into the View. */
  const saveEdit = async (): Promise<boolean> => {
    if (!view) return false;
    update(view.id, currentQuery());
    finishViewEdit();
    toast.saved(t("viewDialog.saved", { name: view.name }));
    return true;
  };
  const dirty = editing && modified;
  useUnsaved(dirty && view ? { id: "view-edit", label: view.name, save: saveEdit, discard: cancelViewEdit } : null);
  const latest = useRef({ dirty, saveEdit });
  useLayoutEffect(() => { latest.current = { dirty, saveEdit }; });
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      // Never the browser's own Save page; with nothing to save, nothing happens.
      e.preventDefault();
      if (e.repeat || overlayHasKeyboard() || !latest.current.dirty) return;
      void latest.current.saveEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  if (!view) return null;
  if (editing) {
    return (
      <div data-view-edit className="flex shrink-0 items-center gap-1.5">
        <Badge size="small">{t("viewBar.editing")}</Badge>
        <span className="flex items-center gap-1.5 @max-[960px]:hidden">
          <Button variant="neutral" mode="ghost" size="3xsmall" onClick={cancelViewEdit}>{t("viewBar.cancel")}</Button>
          <Button variant="primary" mode="filled" size="3xsmall" disabled={!modified} onClick={() => void saveEdit()}>{t("viewBar.saveView")}</Button>
        </span>
        <span className="flex items-center gap-1.5 @min-[960px]:hidden">
          <IconButton label={t("viewBar.cancel")} icon={<CloseIcon className="size-3.5" />} size="3xsmall" tooltipSide="bottom" onClick={cancelViewEdit} />
          <IconButton label={t("viewBar.saveView")} icon={<SaveIcon className="size-3.5" />} size="3xsmall" tooltipSide="bottom" disabled={!modified} onClick={() => void saveEdit()} />
        </span>
      </div>
    );
  }
  if (!modified) return null;

  const saveNew = () => setViewDialog({ mode: "save" });
  const keep = view.builtin
    ? { label: t("viewBar.saveAs"), icon: <AddIcon className="size-3.5" />, onClick: saveNew }
    : { label: t("viewBar.update"), icon: <SaveIcon className="size-3.5" />, onClick: () => update(view.id, currentQuery()) };
  // A custom View's change can go to a new View and leave this one as it was.
  const copy = view.builtin ? null : { label: t("viewBar.saveCopy"), icon: <CopyIcon className="size-3.5" />, onClick: saveNew };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Badge size="small">{t("viewBar.modified")}</Badge>
      <span className="flex items-center gap-1.5 @max-[960px]:hidden">
        <Button variant="neutral" mode="ghost" size="3xsmall" onClick={resetView}>{t("viewBar.reset")}</Button>
        {copy && <Button variant="neutral" mode="ghost" size="3xsmall" onClick={copy.onClick}>{copy.label}</Button>}
        <Button variant="neutral" mode="stroke" size="3xsmall" onClick={keep.onClick}>{keep.label}</Button>
      </span>
      <span className="flex items-center gap-1.5 @min-[960px]:hidden">
        <IconButton label={t("viewBar.reset")} icon={<UndoIcon className="size-3.5" />} size="3xsmall" tooltipSide="bottom" onClick={resetView} />
        {copy && <IconButton label={copy.label} icon={copy.icon} size="3xsmall" tooltipSide="bottom" onClick={copy.onClick} />}
        <IconButton label={keep.label} icon={keep.icon} size="3xsmall" tooltipSide="bottom" onClick={keep.onClick} />
      </span>
    </div>
  );
}
