import type { ReactNode } from "react";

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-0.5 flex items-center gap-1.5 text-section-label text-text-soft-400">
      {children}
    </div>
  );
}
