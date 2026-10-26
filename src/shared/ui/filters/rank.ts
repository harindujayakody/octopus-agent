import type { FilterValue } from "./types";

/// The value search's order (Pair 24 review, Important 3): a value whose
/// label or code (a keyword) is the query first; then one that starts with
/// it, or has a word that does; then one with the letters mid-word; the rest
/// drop. Each rank keeps the field's own order, so Enter picks what was
/// typed: "us" is the US, not Australia (sorted first by code). The count is
/// a hint and never matched, or a digit would match every value it is in.
export function rankValues(values: FilterValue[], query: string): FilterValue[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return values;
  const parts = q.split(/\s+/);
  const ranks: FilterValue[][] = [[], [], []];
  for (const v of values) {
    const r = rankOf(v, q, parts);
    if (r !== null) ranks[r].push(v);
  }
  return ranks.flat();
}

function rankOf(v: FilterValue, q: string, parts: string[]): 0 | 1 | 2 | null {
  const terms = [v.label, ...(v.keywords ?? [])].map((s) => s.toLocaleLowerCase());
  if (terms.includes(q)) return 0;
  if (terms.some((t) => t.startsWith(q))) return 1;
  const words = terms.flatMap((t) => t.split(/[^\p{L}\p{N}]+/u)).filter(Boolean);
  if (parts.every((p) => words.some((w) => w.startsWith(p)))) return 1;
  const text = terms.join(" ");
  return parts.every((p) => text.includes(p)) ? 2 : null;
}
