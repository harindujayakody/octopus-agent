let lastX = Number.NaN;
let lastY = Number.NaN;

/// Whether the pointer really moved since the last pointer event a list row
/// saw. A list scrolling under a still pointer makes the browser send events
/// at the old position; those are not a move (O5, ruling 7).
export function pointerMoved(e: { clientX: number; clientY: number }): boolean {
  const moved = e.clientX !== lastX || e.clientY !== lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  return moved;
}
