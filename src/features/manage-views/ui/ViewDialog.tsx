import { useState } from "react";
import { DialogModal, Input, Switch, useLatched } from "@proxyshard/shardx-ui-kit";
import { FilterIcon } from "../../../shared/icons";
import { loadAllLangs, useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { currentQuery, useProfileUi, useViews, VIEW_NAME_MAX } from "../../../entities/profile";
import { useDialogLife } from "../../../shared/lib/useDialogLife";

type ViewTarget = NonNullable<ReturnType<typeof useProfileUi.getState>["viewDialog"]>;

/// Saves the list as a new View (it is applied at once), or renames one.
/// Mounted once in the app shell; opened through `useProfileUi.setViewDialog`.
export function ViewDialog() {
  const target = useProfileUi((s) => s.viewDialog);
  const life = useDialogLife(target != null);
  const shown = useLatched(target);
  if (!life.mounted || !shown) return null;
  // Keyed so each opening starts from that View's current name.
  return <ViewDialogBody key={life.session} target={shown} open={target != null} />;
}

function ViewDialogBody({ target, open }: { target: ViewTarget; open: boolean }) {
  const t = useT();
  const setViewDialog = useProfileUi((s) => s.setViewDialog);
  const applyView = useProfileUi((s) => s.applyView);
  const original = useViews((s) => (target.mode === "rename" ? s.views.find((v) => v.id === target.id)?.name : undefined)) ?? "";
  const [name, setName] = useState(original);
  const [pinned, setPinned] = useState(true);
  const [taken, setTaken] = useState(false);
  // Any field other than it opened with (the name, the sidebar switch): Esc, the close button and Cancel ask first.
  const [opening] = useState(original);
  const dirty = name !== opening || pinned !== true;

  const trimmed = name.trim();
  const close = () => setViewDialog(null);
  const submit = async () => {
    if (!trimmed) return;
    // A custom View can't take a built-in's name in any language: the
    // others load on demand (i18n), so their names are in before the check.
    await loadAllLangs();
    let saved: string;
    if (target.mode === "rename") {
      if (!useViews.getState().rename(target.id, name)) { setTaken(true); return; }
      saved = useViews.getState().views.find((v) => v.id === target.id)?.name ?? trimmed;
    } else {
      const view = useViews.getState().save(name, currentQuery(), pinned);
      if (!view) { setTaken(true); return; }
      applyView(view.id);
      saved = view.name;
    }
    toast.saved(t("viewDialog.saved", { name: saved }));
    close();
  };

  return (
    <DialogModal
      open={open}
      onClose={close}
      dirty={dirty}
      icon={<FilterIcon className="size-3.5" />}
      title={target.mode === "rename" ? t("viewDialog.renameTitle") : t("viewDialog.saveTitle")}
      confirmLabel={t("viewDialog.save")}
      onConfirm={() => void submit()}
      isDisabled={!trimmed || taken}
      cancelLabel={t("viewDialog.cancel")}
      onCancel={close}
    >
      <div className="flex flex-col gap-4 py-4">
        <Input
          aria-label={t("viewDialog.name")}
          label={t("viewDialog.name")}
          inputSize="xsmall"
          autoFocus
          value={name}
          maxLength={VIEW_NAME_MAX}
          error={taken ? t("views.nameTaken", { name: trimmed }) : undefined}
          onChange={(e) => { setName(e.target.value); setTaken(false); }}
        />
        {target.mode === "save" && (
          <Switch role="switch" label={t("viewDialog.pinned")} checked={pinned} onChange={setPinned} />
        )}
      </div>
    </DialogModal>
  );
}
