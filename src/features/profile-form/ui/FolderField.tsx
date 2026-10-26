import { useRef, useState } from "react";
import { FolderChip } from "../../../shared/ui/FolderChip";
import { PropertyButton, PropertyRow } from "../../../shared/ui/peek";
import { hasOwn } from "../../../shared/lib/utils";
import { useT } from "../../../shared/i18n";
import { useFolderMeta, useFolders } from "../../../entities/profile";
import { adminRefusal, inFolder, teamRefusal, useRightsChange } from "../../../entities/space";
import { ComboPopover } from "./fields";

/// The profile form's Folder: a pick changes the form only, and a name no
/// Folder has yet is kept as typed. The profile moves, and a new Folder is
/// made, when the form is saved.
export function FolderField({ value, onChange, keep }: {
  value: string;
  onChange: (folder: string) => void;
  /** The folder the profile is in now: staying there needs no right. */
  keep?: string;
}) {
  const t = useT();
  // In a team a profile goes only where Create is given, and only its admin makes a folder.
  useRightsChange();
  const refusedIn = (name: string) => (name === keep ? null : teamRefusal("create", inFolder(name)));
  const folders = useFolders();
  const metaByName = useFolderMeta((s) => s.byName);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const colorOf = (name: string) => (hasOwn(metaByName, name) ? metaByName[name].color : null);
  const options = [
    { value: "", label: t("peek.noFolder"), disabled: !!refusedIn(""), hint: refusedIn("") ? t("rights.noCreateHere") : undefined },
    // A new one typed here shows with the rest until the form is saved.
    ...[...folders, ...(value && !folders.includes(value) ? [value] : [])].map((name) => ({
      value: name,
      label: name,
      content: <FolderChip name={name} color={colorOf(name)} />,
      disabled: !!refusedIn(name),
      hint: refusedIn(name) ? t("rights.noCreateHere") : undefined,
    })),
  ];
  return (
    <PropertyRow id="folder" label={t("peek.folder")}>
      {(labelId) => (
        <>
          <PropertyButton ref={anchor} labelledBy={labelId} empty={!value} expanded={open} onClick={() => setOpen((v) => !v)}>
            {value ? <FolderChip name={value} color={colorOf(value)} /> : <span className="truncate">{t("peek.noFolder")}</span>}
          </PropertyButton>
          <ComboPopover
            open={open} onOpenChange={setOpen} anchorRef={anchor} label={t("peek.folder")} value={value}
            options={options}
            placeholder={t("folderPicker.find")}
            onChange={(v) => { if (v !== value) onChange(v); }}
            onCreate={adminRefusal() ? undefined : (typed) => { const name = typed.trim(); if (name) onChange(name); }}
            createLabel={(name) => t("folderPicker.create", { name })}
          />
        </>
      )}
    </PropertyRow>
  );
}
