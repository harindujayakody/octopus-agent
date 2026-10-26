import type { Tag } from "../model/types";
import type { TagState } from "../model/api";

/// Tags as the backend, or a build before it, hands them over, made whole.
/// Only types are imported, so `npm run test:unit` runs it as it is.

export type Shown = { tags: Tag[]; byProfile: Record<string, string[]> };

/** The shape builds before the backend kept in this window. */
const LEGACY_VERSION = 1;

/** Tags of a known color (one of `colors`), and only their ids on profiles, each once. */
export function whole(rawTags: unknown, rawByProfile: unknown, colors: readonly string[]): Shown {
  if (!Array.isArray(rawTags)) return { tags: [], byProfile: {} };
  const tags = rawTags.filter((t): t is Tag =>
    !!t && typeof t.id === "string" && typeof t.name === "string" && colors.includes(t.color));
  const known = new Set(tags.map((t) => t.id));
  const byProfile: Record<string, string[]> = {};
  const given = rawByProfile && typeof rawByProfile === "object" ? rawByProfile as Record<string, unknown> : {};
  for (const [pid, ids] of Object.entries(given)) {
    if (!Array.isArray(ids)) continue;
    const kept = ids.filter((id): id is string => typeof id === "string" && known.has(id));
    if (kept.length) byProfile[pid] = [...new Set(kept)];
  }
  return { tags, byProfile };
}

/** What a build before the backend kept: nothing when it is broken or of another version. */
export function fromLegacy(text: string | null, colors: readonly string[]): TagState {
  try {
    const raw = JSON.parse(text ?? "null") as { version?: unknown; tags?: unknown; byProfile?: unknown } | null;
    if (!raw || raw.version !== LEGACY_VERSION) return { tags: [], by_profile: {} };
    const { tags, byProfile } = whole(raw.tags, raw.byProfile, colors);
    return { tags, by_profile: byProfile };
  } catch {
    return { tags: [], by_profile: {} };
  }
}
