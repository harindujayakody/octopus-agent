import { useState } from "react";
import { DialogModal, Input, Label } from "@proxyshard/shardx-ui-kit";
import { FolderIcon } from "../../../shared/icons";
import { LABEL_COLORS, type LabelColorId } from "../../../shared/constants";
import { ColorRadios } from "../../../shared/ui/ColorRadios";
import { useT } from "../../../shared/i18n";
import { teamError, useTeamAdmin, type TeamFolder } from "../../../entities/team";

const asColor = (c: string): LabelColorId | null => (LABEL_COLORS.some((x) => x.id === c) ? (c as LabelColorId) : null);

/// Makes a team folder, or renames and recolors one. A name in use is said
/// under the field; any other refusal stays in the footer.
export function TeamFolderDialog({ folder, open, onClose, onSaved }: {
  folder: TeamFolder | null;
  open: boolean;
  onClose: () => void;
  /** The folder's name once saved, for the page to put the keyboard on its row. */
  onSaved?: (name: string) => void;
}) {
  const t = useT();
  const folders = useTeamAdmin((s) => s.overview?.folders ?? []);
  const createFolder = useTeamAdmin((s) => s.createFolder);
  const editFolder = useTeamAdmin((s) => s.editFolder);
  // The folder's name on the server now: a rename that went through before a refused color moves it.
  const [base, setBase] = useState(folder?.name ?? null);
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState<LabelColorId | null>(asColor(folder?.color ?? ""));
  const [colorTouched, setColorTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = name.trim();
  const taken = trimmed !== "" && folders.some((f) => f.name !== base && f.name.toLowerCase() === trimmed.toLowerCase());
  const colorChanged = colorTouched && (color ?? "") !== (folder?.color ?? "");
  const dirty = trimmed !== (folder?.name ?? "") || colorChanged;

  const submit = async () => {
    if (!trimmed || taken || busy) return;
    if (base !== null && trimmed === base && !colorChanged) { onClose(); return; }
    setBusy(true);
    setErr(null);
    try {
      // A color the person did not touch is not sent: one the picker does not know stays.
      if (base !== null) await editFolder(base, trimmed, colorChanged ? color ?? "" : null, setBase);
      else await createFolder(trimmed, color ?? "");
      onSaved?.(trimmed);
      onClose();
    } catch (e) {
      setErr(teamError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      dirty={dirty}
      icon={<FolderIcon className="size-3.5" />}
      title={folder ? t("team.folderEditTitle") : t("team.folderNewTitle")}
      confirmLabel={folder ? t("team.folderSave") : t("team.folderCreate")}
      onConfirm={() => void submit()}
      isLoading={busy}
      isDisabled={!trimmed || taken}
      footerNote={err ? <span role="alert" data-folder-error className="text-error-text">{err}</span> : !trimmed ? t("team.folderNeedName") : undefined}
    >
      <div className="flex flex-col gap-4 py-4">
        <Input
          autoFocus
          inputSize="xsmall"
          label={t("team.folderName")}
          value={name}
          maxLength={200}
          error={taken ? t("team.folderTaken", { name: trimmed }) : undefined}
          onChange={(e) => { setName(e.target.value); setErr(null); }}
        />
        {/* The dialog is the raised layer: the checked ring's gap takes it. */}
        <div className="flex flex-col gap-1.5 [--swatch-bg:var(--bg-raised)]">
          <Label as="span">{t("team.folderColor")}</Label>
          <ColorRadios label={t("team.folderColor")} value={color} onChange={(c) => { setColor(c); setColorTouched(true); setErr(null); }} allowNone />
        </div>
        {folder && folder.name !== trimmed && trimmed !== "" && <p className="m-0 text-help text-text-sub-600">{t("team.folderRenameNote")}</p>}
      </div>
    </DialogModal>
  );
}
