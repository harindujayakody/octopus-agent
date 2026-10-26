/** Profile rows on the move: a JSON list of ids. Folders and All Profiles accept it. */
export const PROFILES_DRAG = "application/x-shardx-profiles";

/// Starts a drag of profiles: the ids as JSON, the same ids as text (Firefox
/// starts no drag without text/plain, and some Chromium builds hide a custom
/// type from `dataTransfer.types` during dragover), and a small chip near
/// the cursor in place of the row-wide ghost that hides the sidebar's
/// Folders and stops the drop firing on them.
export function writeProfileDrag(dt: DataTransfer, ids: string[], label: string): void {
  dt.effectAllowed = "move";
  dt.setData(PROFILES_DRAG, JSON.stringify(ids));
  dt.setData("text/plain", ids.join("\n"));
  const chip = document.createElement("div");
  chip.className = "drag-chip";
  chip.textContent = label;
  document.body.appendChild(chip);
  dt.setDragImage(chip, 12, 12);
  // The ghost is drawn at once, so removing it next tick is safe.
  setTimeout(() => chip.remove(), 0);
}

/** The profile ids a drop carries; none when it carries something else. */
export function readDragIds(dt: DataTransfer): string[] {
  try {
    const raw = dt.getData(PROFILES_DRAG);
    if (raw) {
      const ids: unknown = JSON.parse(raw);
      if (Array.isArray(ids) && ids.every((x) => typeof x === "string")) return ids;
    }
  } catch { /* not ours */ }
  return dt.getData("text/plain").split("\n").map((s) => s.trim()).filter(Boolean);
}
