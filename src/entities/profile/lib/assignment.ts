export type AssignPair = { profileId: string; proxyId: string | null };
export type AssignPlan = {
  pairs: AssignPair[];
  /** Profiles that get nothing new: they stay as they are. */
  left: string[];
  /** Proxies passed over because a profile outside this assignment uses them. */
  skippedShared: string[];
  /** How many profiles each proxy gets. */
  perProxy: Record<string, number>;
};

/** Where the one Assign dialog was opened: on profiles (it asks which
 *  proxies) or on proxies (it asks which profiles). */
export type AssignFrom = { kind: "profiles"; profileIds: string[] } | { kind: "proxies"; proxyIds: string[] };

/// The one rule for giving proxies to profiles (IFACE-03, O9b). Profiles
/// come in list order and proxies in the order given. Without sharing, each
/// proxy goes to one profile, and a proxy that a profile outside this
/// assignment already uses is passed over (plan ruling 11); profiles left over
/// keep what they have. With sharing, proxies are handed out in turn. `[null]`
/// means No proxy for every profile.
export function planAssignment(
  profileIds: readonly string[],
  proxyIds: readonly (string | null)[],
  opts: { allowSharing: boolean; usedBy: Readonly<Record<string, readonly string[]>> },
): AssignPlan {
  const perProxy: Record<string, number> = {};
  if (proxyIds.length === 1 && proxyIds[0] === null) {
    return { pairs: profileIds.map((profileId) => ({ profileId, proxyId: null })), left: [], skippedShared: [], perProxy };
  }
  const targets = new Set(profileIds);
  const skippedShared: string[] = [];
  const usable: string[] = [];
  for (const id of proxyIds) {
    if (id === null) continue;
    const outside = (opts.usedBy[id] ?? []).some((p) => !targets.has(p));
    if (outside && !opts.allowSharing) skippedShared.push(id);
    else usable.push(id);
  }
  const pairs: AssignPair[] = [];
  const left: string[] = [];
  profileIds.forEach((profileId, k) => {
    // With sharing and no usable proxy, `usable[k % 1]` is undefined: everyone is left.
    const proxyId = opts.allowSharing ? usable[k % Math.max(1, usable.length)] : usable[k];
    if (proxyId === undefined) { left.push(profileId); return; }
    pairs.push({ profileId, proxyId });
    perProxy[proxyId] = (perProxy[proxyId] ?? 0) + 1;
  });
  return { pairs, left, skippedShared, perProxy };
}
