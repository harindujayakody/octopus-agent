/// Imported projects that reach beyond the page and have not run yet: their
/// first Run shows the review again (SEC-02). Kept on this computer.
const KEY = "shardx.automation.unreviewed";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function write(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode */ }
}

export const markUnreviewed = (id: string) => write([...new Set([...read(), id])]);
export const isUnreviewed = (id: string) => read().includes(id);
export const markReviewed = (id: string) => write(read().filter((x) => x !== id));
