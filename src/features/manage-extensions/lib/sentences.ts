/** Sentences in a row: no space after a full-width stop (Chinese "。"). */
export function sentences(parts: string[]): string {
  const list = parts.filter(Boolean);
  return list.length === 0 ? "" : list.reduce((a, b) => (/[。！？]$/.test(a) ? a + b : `${a} ${b}`));
}
