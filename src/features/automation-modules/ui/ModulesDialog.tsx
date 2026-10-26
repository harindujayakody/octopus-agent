import { Button, Modal } from "@proxyshard/shardx-ui-kit";
import { AddIcon, FolderIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { useModules } from "../model/useModules";
import { ModulesList } from "./ModulesList";

/// The installed modules, in a dialog: opened from the block library (Add
/// step, Manage modules), since a module is a source of steps. It holds the
/// list as the Modules tab did, with Open folder and Add module in its
/// footer. Wide enough for the list's four columns at their least, so the
/// request row (Needs approval, Deny, Allow) is never pushed off to the side.
export function ModulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const modules = useModules();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("automation.tabModules")}
      size="lg"
      className="max-w-[860px]!"
      padded={false}
      footer={
        <>
          <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<FolderIcon className="size-3.5" />} onClick={() => void modules.openFolder()}>
            {t("modulesCard.folderButton")}
          </Button>
          <Button variant="primary" mode="filled" size="xsmall" isLoading={modules.busy === "+"} leftIcon={<AddIcon className="size-3.5" />} onClick={() => void modules.add()}>
            {t("modulesCard.addButton")}
          </Button>
        </>
      }
    >
      {/* A list needs a height of its own to scroll in. */}
      <div className="flex h-[min(420px,calc(var(--viewport-h)*0.55))] flex-col px-inset-dialog pb-2 pt-1">
        <ModulesList modules={modules.modules} loaded={modules.loaded} busy={modules.busy} onRemove={(m) => void modules.remove(m)} onAdd={() => void modules.add()} />
      </div>
    </Modal>
  );
}
