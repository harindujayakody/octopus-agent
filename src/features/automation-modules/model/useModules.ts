import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  automationModuleInstall,
  automationModuleRemove,
  automationModules,
  automationModulesDir,
  type ModuleInfo,
} from "../../../entities/automation";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";

/// The modules an operator wrote themselves, and the three things done to
/// them: add one, remove one, open their folder. The page header holds the
/// buttons and the list holds the rows, so both read this one hook.
export function useModules() {
  const t = useT();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Before the first answer there is nothing to say "no modules" about.
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    automationModules().then(setModules).catch(() => {}).finally(() => setLoaded(true));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    const path = await open({
      title: t("modulesCard.pickerTitle"),
      filters: [{ name: t("modulesCard.pickerFilter"), extensions: ["wasm"] }],
    });
    if (typeof path !== "string") return;
    setBusy("+");
    try {
      const m = await automationModuleInstall(path);
      reload();
      toast.ok(
        m.blocks.length === 0
          ? t("modulesCard.addedNoSteps", { name: m.name })
          : m.blocks.length === 1
            ? t("modulesCard.addedOneStep", { name: m.name })
            : t("modulesCard.addedSteps", { name: m.name, n: m.blocks.length }),
      );
    } catch (e) {
      toast.fail({ title: t("modulesCard.installFailed"), detail: e });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: ModuleInfo) => {
    setBusy(m.id);
    try {
      await automationModuleRemove(m.id);
      reload();
      // Nothing rewrites the projects that used it, so say so plainly.
      toast.ok(t("modulesCard.removed", { name: m.name }));
    } catch (e) {
      toast.fail({ title: t("modulesCard.removeFailed", { name: m.name }), detail: e });
    } finally {
      setBusy(null);
    }
  };

  const openFolder = async () => {
    try {
      await revealItemInDir(await automationModulesDir());
    } catch {
      toast.err(t("modulesCard.folderOpenFailed"));
    }
  };

  return { modules, loaded, busy, add, remove, openFolder };
}
