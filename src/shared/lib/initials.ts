/** Two letters for a profile (the rail's pinned items, a Continue tile): the first letters of the
 *  first two words, or the first two letters of one word ("FB Ads acc-01"
 *  is "FA", "Sandbox" "Sa"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").replace(/^./, (c) => c.toUpperCase());
  return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
}
