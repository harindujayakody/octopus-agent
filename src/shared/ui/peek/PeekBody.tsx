import type { ReactNode } from "react";

/// Peek's scrolling body, under the header. It clips its own scroll corners,
/// at the panel's radius (the panel has no border), so the panel clips
/// nothing and the header's focus rings reach the panel's edge (Pair 18
/// review, M4).
export function PeekBody({ children }: { children: ReactNode }) {
  return <div data-peek-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-panel">{children}</div>;
}
