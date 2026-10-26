/// Shortens `text` to `max` characters by cutting its middle, so a path keeps
/// the folder or file name at its end (TYPE-07): "/Users/me/…/ShardBrowser/data".
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 3);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}
