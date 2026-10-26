import type { AlreadyInLibrary, ExtensionEntry, ExtensionUpdate, UpdateProgress } from "./types";

/// Pure helpers over the Web Store update records. No imports beyond types,
/// so `npm run test:unit` reads this file as it is.

const ALREADY = "already_in_library {";

/** The refusal to add what the library holds (extensions.rs `already_in_library`),
 *  or null. A multi-file import's text holds it after a path. */
export function parseAlreadyInLibrary(e: unknown): AlreadyInLibrary | null {
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? "");
  const at = text.indexOf(ALREADY);
  if (at < 0) return null;
  try {
    const v = JSON.parse(text.slice(at + ALREADY.length - 1)) as Partial<AlreadyInLibrary>;
    if (typeof v.entry_id !== "string") return null;
    return { entry_id: v.entry_id, installed: String(v.installed ?? ""), separate: v.separate === true };
  } catch {
    return null;
  }
}

/** The Web Store item an extension is linked to, if any. */
export const storeIdOf = (e: Pick<ExtensionEntry, "source"> | undefined): string | null =>
  e?.source?.kind === "webstore" ? e.source.id : null;

/** The item's page in the Web Store. */
export const storePage = (id: string) => `https://chromewebstore.google.com/detail/${id}`;

/** Update can put it in now (Update all): a newer version, no Web Store flag. */
export const canUpdate = (u: ExtensionUpdate | undefined): boolean =>
  !!u && (u.state === "available" || u.state === "ready") && u.flags.length === 0;

/** An update waiting for the person (the sidebar's count): one Update puts in, or one that asks first. */
export const offered = (u: ExtensionUpdate | undefined): boolean =>
  canUpdate(u) || (!!u && u.state === "confirm" && u.flags.length === 0);

export const updatableCount = (byId: Record<string, ExtensionUpdate>): number =>
  Object.values(byId).filter(offered).length;

/** Chrome's version order: numbers part by part, a missing part is zero. */
export function versionAtLeast(have: string, need: string): boolean {
  const a = have.split(".").map(Number);
  const b = need.split(".").map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** The Web Store took the item down (updates.rs `record`, Answer::Unknown). */
export const goneFromStore = (u: Pick<ExtensionUpdate, "state" | "error"> | undefined): boolean =>
  u?.state === "failed" && /\bthe Web Store does not know this extension\b/i.test(u.error ?? "");

/** An ID conflict from the person's other computer, not from the Web Store. */
export const conflictFromSync = (u: Pick<ExtensionUpdate, "error">): boolean =>
  /\bfrom the other computer\b/i.test(u.error ?? "");

/** 0..100 while the size is known, else null. */
export function percentOf(p: UpdateProgress | null | undefined): number | null {
  if (!p || p.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((p.received / p.total) * 100)));
}

/** Whole hours since `first_seen` (unix seconds) at `nowMs`. */
export const hoursSince = (firstSeen: number, nowMs: number): number =>
  Math.max(0, Math.floor((nowMs / 1000 - firstSeen) / 3600));
