import { useEffect } from "react";
import { useLatched } from "@proxyshard/shardx-ui-kit";
import { useProfile, useProfileUi } from "../../../entities/profile";
import { setOnAssignReplacements } from "../../../entities/proxy";
import { useDialogLife } from "../../../shared/lib/useDialogLife";
import { AssignDialog } from "../../assign-proxies";

/// The one Assign dialog, both ways (IFACE-03). The Profiles bulk bar opens
/// it, and so do a Start refused because the profile's proxy is gone, a
/// proxy delete's "Assign replacements…" and, on proxies, "Assign to profiles…" on the
/// Proxies page. It stays mounted, with what it opened on, through its exit
/// (FEEL-01). The selection is left as it is (R26 a).
export function AssignProxiesHost() {
  const assign = useProfileUi((s) => s.assign);
  const closeAssign = useProfileUi((s) => s.closeAssign);
  const life = useDialogLife(assign != null);
  const shown = useLatched(assign);

  // After a delete: the Profiles store first learns the proxy is gone, so
  // the dialog lists only proxies that still exist.
  useEffect(() => {
    setOnAssignReplacements((ids) => {
      void useProfile.getState().reload().then(() => useProfileUi.getState().openAssign(ids));
    });
    return () => setOnAssignReplacements(null);
  }, []);

  if (!life.mounted || !shown) return null;
  return (
    <AssignDialog
      key={life.session}
      open={assign != null}
      from={shown.from ?? { kind: "profiles", profileIds: shown.ids }}
      onClose={closeAssign}
    />
  );
}
