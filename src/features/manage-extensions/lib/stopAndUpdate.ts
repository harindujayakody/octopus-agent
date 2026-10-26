import { confirmModal } from "../../../shared/model/confirm";
import { t } from "../../../shared/i18n";
import { extensionName, type ExtensionEntry, type ExtensionUpdate } from "../../../entities/extension";
import { processKill, useProfile } from "../../../entities/profile";

/// Stop N profiles and update (§3.7): asks with their names, then stops
/// exactly the profiles the update waits for. The update goes in by itself
/// once the last one closes; the launcher never stops profiles on its own.
export async function stopAndUpdate(e: ExtensionEntry, u: ExtensionUpdate): Promise<void> {
  if (u.waiting_on.length === 0) return;
  const ok = await confirmModal({
    title: t("extensions.stopTitle", { name: extensionName(e) }),
    message: t("extensions.stopHelp"),
    items: u.waiting_on.map((h) => ({ label: h.name })),
    confirmLabel: t("extensions.stopConfirm"),
  });
  if (!ok) return;
  const ids = u.waiting_on.map((h) => h.id);
  const profiles = useProfile.getState();
  const tracked = ids.filter((id) => profiles.running[id] !== undefined);
  await profiles.stopMany(tracked);
  // A browser the launcher does not track (left from an earlier start) is stopped directly.
  for (const id of ids) if (!tracked.includes(id)) await processKill(id).catch(() => false);
}
