import { useState } from "react";
import { DialogModal, Input, Label, cn, useLatched } from "@proxyshard/shardx-ui-kit";
import { FOLDER_ICON_GLYPHS, FolderIcon as FolderIconGlyph } from "../../../shared/icons";
import { labelColor, type LabelColorId } from "../../../shared/constants";
import { onRadioKeys } from "../../../shared/lib/radioKeys";
import { hasOwn } from "../../../shared/lib/utils";
import { useDialogLife } from "../../../shared/lib/useDialogLife";
import { ColorRadios } from "../../../shared/ui/ColorRadios";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { adminRefusal, useInTeam } from "../../../entities/space";
import {
  DEFAULT_FOLDER_META, leaveList, useFolderMeta, useFolders, useProfile, useProfileUi,
  type FolderIcon,
} from "../../../entities/profile";

const ICON_IDS = Object.keys(FOLDER_ICON_GLYPHS) as FolderIcon[];

// Literal keys, so the i18n check sees them used.
const ICON_NAME: Record<FolderIcon, string> = {
  folder: "folderIcons.folder", briefcase: "folderIcons.briefcase", cart: "folderIcons.cart",
  megaphone: "folderIcons.megaphone", people: "folderIcons.people", globe: "folderIcons.globe",
  star: "folderIcons.star", code: "folderIcons.code", game: "folderIcons.game",
  wallet: "folderIcons.wallet", mail: "folderIcons.mail", rocket: "folderIcons.rocket",
};

type FolderTarget = NonNullable<ReturnType<typeof useProfileUi.getState>["folderDialog"]>;

/// Creates a Folder, or edits one: name, color and icon. Mounted once in the
/// app shell; opened through `useProfileUi.setFolderDialog`. The one place a
/// Folder is made: the folder picker's "Create folder “x”" opens it with the
/// name typed there, and the profiles it was moving go into the new Folder.
export function FolderDialog() {
  const target = useProfileUi((s) => s.folderDialog);
  const life = useDialogLife(target != null);
  const shown = useLatched(target);
  if (!life.mounted || !shown) return null;
  // Keyed so each opening starts from that Folder's current values.
  return <FolderDialogBody key={life.session} target={shown} open={target != null} />;
}

function FolderDialogBody({ target, open }: { target: FolderTarget; open: boolean }) {
  const t = useT();
  const setFolderDialog = useProfileUi((s) => s.setFolderDialog);
  const setFolder = useProfileUi((s) => s.setFolder);
  const folders = useFolders();
  const rememberFolder = useProfile((s) => s.rememberFolder);
  const renameFolder = useProfile((s) => s.renameFolder);
  const setMeta = useFolderMeta((s) => s.setMeta);
  const team = useInTeam();
  const original = target.mode === "edit" ? target.name : "";
  // `original` may be a Folder named like an inherited property ("constructor",
  // "toString"): only an own key on `byName` is a real, previously-set look
  // (SEC-14 review; the store's other own-key lookups use the same helper).
  const start = useFolderMeta((s) => (original && hasOwn(s.byName, original) ? s.byName[original] : undefined)) ?? DEFAULT_FOLDER_META;

  // What it opened with: a field that differs from this is an unsaved change.
  const [opening] = useState(() => ({ name: target.mode === "edit" ? target.name : target.name ?? "", color: start.color, icon: start.icon }));
  const [name, setName] = useState(opening.name);
  const [color, setColor] = useState<LabelColorId | null>(opening.color);
  const [icon, setIcon] = useState<FolderIcon>(opening.icon);
  const [busy, setBusy] = useState(false);
  const dirty = name !== opening.name || color !== opening.color || icon !== opening.icon;

  const trimmed = name.trim();
  // Not while it leaves: a saved name is in the list by then, and the fade
  // would show it as taken.
  const taken = open && trimmed !== original && folders.includes(trimmed);
  const close = () => setFolderDialog(null);

  const submit = async () => {
    if (!trimmed || taken) return;
    // A team's folders are its admin's: nothing is shown made that the team refuses.
    const adminOnly = adminRefusal();
    if (adminOnly) { toast.fail({ title: t("folderMeta.saveFailed"), detail: adminOnly }); return; }
    setBusy(true);
    if (target.mode === "create") {
      rememberFolder(trimmed);
      setMeta(trimmed, { color, icon });
      // Made from the folder picker: the profiles move in, and the list stays
      // where it is, with the selection as it was (owner rule). A new Folder
      // from the sidebar opens it instead, after the guard of an unsaved Edit
      // view (the Folder is made either way).
      if (target.moveIds?.length) void useProfile.getState().moveMany(target.moveIds, trimmed);
      else void leaveList(() => setFolder(trimmed));
    } else {
      if (trimmed !== original) {
        // The list (or its View) showing it follows the name.
        const ok = await renameFolder(original, trimmed);
        if (!ok) { setBusy(false); return; }
      }
      setMeta(trimmed, { color, icon });
    }
    setBusy(false);
    toast.saved(target.mode === "create" ? t("folderDialog.created", { name: trimmed }) : t("folderDialog.saved", { name: trimmed }));
    close();
  };

  return (
    <DialogModal
      open={open}
      onClose={close}
      dirty={dirty}
      icon={<FolderIconGlyph className="size-3.5" />}
      title={target.mode === "create" ? t("folderDialog.createTitle") : t("folderDialog.editTitle")}
      confirmLabel={target.mode === "create" ? t("folderDialog.create") : t("folderDialog.save")}
      onConfirm={submit}
      isLoading={busy}
      isDisabled={!trimmed || taken}
      cancelLabel={t("folderDialog.cancel")}
      onCancel={close}
    >
      <div className="flex flex-col gap-4 py-4">
        <Input
          aria-label={t("folderDialog.name")}
          label={t("folderDialog.name")}
          inputSize="xsmall"
          autoFocus
          value={name}
          placeholder={t("folderModal.namePlaceholder")}
          error={taken ? t("folderModal.duplicateError", { name: trimmed }) : undefined}
          onChange={(e) => setName(e.target.value)}
        />

        {/* The dialog is the raised layer: the checked ring's gap takes it. */}
        <div className="flex flex-col gap-1.5 [--swatch-bg:var(--bg-raised)]">
          <Label as="span">{t("folderDialog.color")}</Label>
          <ColorRadios label={t("folderDialog.color")} value={color} onChange={setColor} allowNone />
        </div>

        {/* A team folder's look is its colour alone (space/mod.rs set_meta). */}
        {!team && <div className="flex flex-col gap-1.5">
          <Label as="span">{t("folderDialog.icon")}</Label>
          <div
            role="radiogroup"
            aria-label={t("folderDialog.icon")}
            className="flex flex-wrap items-center gap-1"
            onKeyDown={(e) => onRadioKeys(e, ICON_IDS, icon, setIcon)}
          >
            {ICON_IDS.map((id) => {
              const Glyph = FOLDER_ICON_GLYPHS[id];
              const on = icon === id;
              return (
                // eslint-disable-next-line no-restricted-syntax -- icon choice: the button is the icon
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={t(ICON_NAME[id])}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setIcon(id)}
                  className={cn(
                    "grid size-[28px] place-items-center rounded-control focus-ring",
                    on ? "bg-bg-hover" : "hover:bg-bg-hover",
                  )}
                  style={{ color: labelColor(color) }}
                >
                  <Glyph className="size-3.5" />
                </button>
              );
            })}
          </div>
        </div>}
      </div>
    </DialogModal>
  );
}
