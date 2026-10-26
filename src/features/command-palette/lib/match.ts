import type { ReactNode } from "react";

/** The palette's groups, in the order they show when nothing is typed. */
export const GROUP_ORDER = ["context", "recent", "profiles", "proxies", "projects", "actions", "pages", "views", "folders", "settings"] as const;
export type PaletteGroup = (typeof GROUP_ORDER)[number];

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  /** After the label, quieter: a profile's Folder and proxy country (Task 9). */
  subtitle?: string;
  /** Where it lives ("Proxies", "Profiles / Shops"): the Recent group prints
   *  it, soft, before the name (air and hierarchy, section 5). */
  area?: string;
  /** Other words that find it: a Folder, tag names, the English label. */
  keywords?: string[];
  /** Right-aligned, before `hint`: a state word ("Running"), never a color alone. */
  meta?: string;
  /** Right-aligned: what Enter does, a count, "Current". */
  hint?: string;
  /** The key caps of the key that does the same outside the palette. */
  keys?: string[];
  /** `aria-keyshortcuts` for those keys. */
  aria?: string;
  icon?: ReactNode;
  /** Applies but cannot run now: why. Shown in place of the hint; the
   *  highlight skips it and a click runs nothing (EMIL-05). */
  disabled?: string;
  /** False: only a search shows it (most profiles). */
  featured?: boolean;
  run: () => void;
  /** Mod+Enter, when it differs from Enter. */
  runAlt?: () => void;
  /** `run` (and `runAlt`) puts the keyboard somewhere: it runs a frame after
   *  the palette hands the keyboard back (the registry's `focusAfter`). */
  focusAfter?: boolean;
  focusAfterAlt?: boolean;
  /** Tab or ArrowRight: this result's actions, shown in place of the results (ruling 11). */
  actions?: () => PaletteItem[];
  /** Enter opens the actions instead of running (a command that asks which: "Change theme…"). */
  enterOpensActions?: boolean;
  /** The registry command behind it, or the profile it is. */
  commandId?: string;
  profileId?: string;
};

/** Profiles shown at once, at most. */
const PROFILE_LIMIT = 12;
/** Results the Recent group shows, at most. */
const RECENT_LIMIT = 5;
/** Proxies and Automation projects shown at once, at most. */
const OBJECT_LIMIT = 5;

/// Whether Recent remembers and shows a result: never a selection's command,
/// and never one only a search shows (a theme row: "Change theme…" is what
/// comes back; Pair 45 review, I1). A profile is the exception: it is left
/// out of the list with nothing typed only to keep the list short, and the
/// one searched for and run is what Recent is for (EMIL-16).
export const remembers = (c: PaletteItem): boolean =>
  c.group !== "context" && (c.featured !== false || c.group === "profiles" || c.group === "proxies" || c.group === "projects");

/// Lowercase, one space between words, and ё as е: Russian is mostly typed
/// without ё, and «Закреплённые» must still be found by «закрепленные».
const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
/** The joiners names use ("acc-02", "a/b", "v1.2"): a word ends at them. */
const JOINERS = /[\s\-_/.,:()]+/;
const JOINERS_ALL = /[\s\-_/.,:()]+/g;
/** A label's words: split at spaces and at the joiners. */
const wordsOf = (s: string) => norm(s).split(JOINERS).filter(Boolean);
/** Letters only, for a query typed without its spaces ("fbads"). */
const compact = (s: string) => s.replace(JOINERS_ALL, "");
/// A light English stem, so a singular finds a plural and back ("proxy" and
/// "Proxies", "profile" and "Profiles"). Only words of four letters or more:
/// "s" must not match everything.
const stem = (w: string) => (w.length < 4 ? w : w.replace(/ies$/, "y").replace(/(ch|sh|x|s)es$/, "$1").replace(/s$/, ""));

/// A result's words, split, stemmed and lowercased once, not on every key
/// (Pair 44 review, I1): a profile's keywords hold its whole notes. Kept per
/// item object, and made again when its label or keywords are replaced.
type Words = {
  label: string;
  keywords: string[] | undefined;
  norm: string;
  compact: string;
  words: string[];
  stems: string[];
  initials: string;
  keyWords: string[];
  keyStems: string[];
};
const wordsCache = new WeakMap<PaletteItem, Words>();

function wordsOfItem(item: PaletteItem): Words {
  const cached = wordsCache.get(item);
  if (cached && cached.label === item.label && cached.keywords === item.keywords) return cached;
  const words = wordsOf(item.label);
  const keyWords = (item.keywords ?? []).flatMap(wordsOf);
  const made: Words = {
    label: item.label,
    keywords: item.keywords,
    norm: norm(item.label),
    compact: compact(norm(item.label)),
    words,
    stems: words.map(stem),
    initials: words.map((w) => w[0]).join(""),
    keyWords,
    keyStems: keyWords.map(stem),
  };
  wordsCache.set(item, made);
  return made;
}

/** A query, split and stemmed once for all the results. */
type Query = { q: string; tokens: string[]; stems: string[]; letters: string };

/// How well one typed token matches a list of words: 4 a whole word, 3 a
/// word's start or its stem, 2 inside a word, 1 the initials ("fa" for "FB
/// Ads"); 0 not at all.
function tokenScore(token: string, tokenStem: string, words: string[], stems: string[], initials: string): number {
  if (words.includes(token)) return 4;
  if (words.some((w) => w.startsWith(token))) return 3;
  if (tokenStem.length >= 3 && stems.some((w) => w.startsWith(tokenStem))) return 3;
  if (words.some((w) => w.includes(token))) return 2;
  if (token.length >= 2 && initials.startsWith(token)) return 1;
  return 0;
}

/// A result's score for a normalized query; 0 hides it. Every token must
/// match a word of the label (worth double) or of the keywords. Then bonuses:
/// the label is the query, starts with it, or holds the tokens in order. A
/// query typed without its spaces ("fbads") still finds "FB Ads" by the
/// label's letters. Plain string tests: a query is never a pattern.
function score(item: PaletteItem, { q, tokens, stems, letters }: Query): number {
  if (tokens.length === 0) return 0;
  const w = wordsOfItem(item);
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const inLabel = tokenScore(tokens[i], stems[i], w.words, w.stems, w.initials);
    const inKeys = inLabel > 0 ? 0 : tokenScore(tokens[i], stems[i], w.keyWords, w.keyStems, "");
    if (inLabel === 0 && inKeys === 0) return letters && w.compact.includes(letters) ? 2 : 0;
    total += inLabel > 0 ? inLabel * 2 : inKeys;
  }
  if (w.norm === q) total += 20;
  else if (w.norm.startsWith(q)) total += 10;
  let at = -1;
  const inOrder = tokens.every((token) => {
    const next = w.words.findIndex((x, i) => i > at && x.startsWith(token));
    if (next < 0) return false;
    at = next;
    return true;
  });
  if (inOrder && tokens.length > 1) total += 3;
  return total;
}

/// The results to show, grouped, profiles capped. Nothing typed: the five
/// heaviest by `weights` as Recent (they leave their own groups), then the
/// featured ones, groups in their fixed order. A search: the matches, best
/// first (ties by `weights`, then by position); groups ordered by their best
/// match.
export function matchCommands(
  items: PaletteItem[],
  query: string,
  weights: Map<string, number> = new Map(),
): { group: PaletteGroup; items: PaletteItem[] }[] {
  const q = norm(query);
  const tokens = q.split(" ").filter(Boolean);
  const parsed: Query = { q, tokens, stems: tokens.map(stem), letters: compact(q) };
  // What was run and still weighs, the selection's commands aside (they act
  // on a subject that changes; the result that led there is what counts).
  // Ties go to the one used last (`weights` lists the newest first).
  const rank = new Map([...weights.keys()].map((id, i) => [id, i]));
  const recent = !q
    ? items.filter((c) => (weights.get(c.id) ?? 0) > 0 && remembers(c))
      .sort((a, b) => weights.get(b.id)! - weights.get(a.id)! || rank.get(a.id)! - rank.get(b.id)!)
      .slice(0, RECENT_LIMIT)
    : [];
  const inRecent = new Set(recent.map((c) => c.id));
  const groups = GROUP_ORDER.map((group) => {
    if (group === "recent") return { group, items: recent, best: 0 };
    const own = items.filter((c) => c.group === group && !inRecent.has(c.id));
    if (!q) {
      const featured = own.filter((c) => c.featured !== false);
      return { group, items: group === "profiles" ? featured.slice(0, PROFILE_LIMIT) : featured, best: 0 };
    }
    const scored = own.map((c, i) => ({ c, i, s: score(c, parsed), w: weights.get(c.id) ?? 0 })).filter((x) => x.s > 0);
    scored.sort((a, b) => b.s - a.s || b.w - a.w || a.i - b.i);
    const list = scored.map((x) => x.c);
    return { group, items: group === "profiles" ? list.slice(0, PROFILE_LIMIT) : group === "proxies" || group === "projects" ? list.slice(0, OBJECT_LIMIT) : list, best: scored[0]?.s ?? 0 };
  }).filter((g) => g.items.length > 0);
  if (q) groups.sort((a, b) => b.best - a.best || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return groups.map(({ group, items: list }) => ({ group, items: list }));
}
