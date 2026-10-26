// Real-browser test page for the Live layer's header material (spec 7): a
// sticky header on the translucent material over a list that scrolls under
// it, with the scroll-edge fade once it has scrolled, as the lists will use
// it. Served by the dev server at /e2e/kit/material.html (add ?theme=dark
// for the dark theme); never part of a build. Read by e2e/material.spec.ts.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/app/styles/index.css";

const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-theme", theme);

const TONES = ["bg-success-tint", "bg-information-tint", "bg-warning-tint", "bg-error-tint"];

function List() {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      data-list
      className="relative h-[240px] w-[360px] overflow-y-auto rounded-surface border border-stroke-soft-200 bg-bg-white-0"
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
    >
      <div
        data-header
        data-scrolled={scrolled || undefined}
        className="material-bar scroll-edge sticky top-0 z-(--layer-raised) flex h-[32px] items-center px-cell text-secondary font-medium text-text-soft-400"
      >
        Name
      </div>
      {Array.from({ length: 30 }, (_, i) => (
        <div key={i} className={`flex h-[36px] items-center px-cell text-secondary text-text-strong-950 ${TONES[i % TONES.length]}`}>
          Profile {i + 1}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="bg-bg-canvas p-5 text-ui text-text-strong-950">
      <List />
    </main>
  </StrictMode>,
);
