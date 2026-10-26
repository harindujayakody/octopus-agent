import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { resolveId, useProfile } from "../../../entities/profile";
import { syncCall, syncError } from "../../../entities/sync";

/// Picks profiles to sync, or stops syncing them, in one call. The rows take
/// what the backend answered; answers the ids that failed.
export async function setProfilesSync(ids: string[], on: boolean): Promise<string[]> {
  const byId = new Map(useProfile.getState().profiles.map((p) => [p.id, p]));
  // A row still being created waits for its id; one whose create failed is gone.
  const real = (await Promise.all(ids.map(resolveId))).filter((id): id is string => id !== null);
  // Another computer holds these: stopping them here would let both run it at once.
  const held = on ? [] : real.filter((id) => byId.get(id)?.sync?.open_on);
  const todo = real.filter((id) => !held.includes(id));
  if (held.length > 0) {
    const p = byId.get(held[0])!;
    toast.err(held.length === 1 ? t("profileSync.stopLeasedOne", { name: p.name, device: p.sync!.open_on! }) : t("profileSync.stopLeasedMany", { n: held.length }));
  }
  if (todo.length === 0) return held;
  const name = todo.length === 1 ? byId.get(todo[0])?.name ?? "" : "";
  try {
    useProfile.getState().applyRows(await syncCall("profile_sync_set", { ids: todo, on }));
    if (on) toast.ok(todo.length === 1 ? t("profileSync.onOne", { name }) : t("profileSync.onMany", { n: todo.length }));
    // What the other computers do with it: keep their copy, which no longer updates.
    else toast.ok(todo.length === 1 ? t("profileSync.offOne", { name }) : t("profileSync.offMany", { n: todo.length }), { detail: t("profileSync.offDetail") });
    return held;
  } catch (e) {
    toast.fail({ title: on ? t("profileSync.onFailed") : t("profileSync.offFailed"), detail: syncError(e), subject: name || undefined });
    return [...held, ...todo];
  }
}
