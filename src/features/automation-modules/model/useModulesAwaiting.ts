import { useCallback, useEffect, useMemo, useState } from "react";
import {
  automationModulePermissions,
  automationModules,
  useAutomation,
  type ModulePermissions,
} from "../../../entities/automation";
import { needsApproval } from "./requests";

/// How many modules wait for an answer to their request (to call other
/// projects or modules), for the Automation page's header: the modules are
/// managed from Add step, so a request would otherwise sit unseen. Read again
/// when `enabled` turns on and when `refresh` is called (the Modules dialog
/// closing, where Allow and Deny are answered).
export function useModulesAwaiting(enabled: boolean): { count: number; refresh: () => void } {
  const projects = useAutomation((s) => s.projects);
  const [perms, setPerms] = useState<ReadonlyMap<string, ModulePermissions>>(new Map());
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      const modules = await automationModules().catch(() => []);
      const got = await Promise.all(modules.map((m) => automationModulePermissions(m.id).then((p) => [m.id, p] as const).catch(() => null)));
      if (alive) setPerms(new Map(got.filter((e): e is readonly [string, ModulePermissions] => e !== null)));
    })();
    return () => { alive = false; };
  }, [enabled, round]);

  // A Deny is kept on this computer apart from the backend's answer (it is
  // read inside `needsApproval`): each read replaces `perms`, which is when a
  // Deny can have changed.
  const count = useMemo(() => {
    const flows = projects.map((p) => ({ id: p.id, name: p.name }));
    return [...perms].filter(([id, perm]) => needsApproval(id, perm, flows)).length;
  }, [perms, projects]);

  return { count, refresh };
}
