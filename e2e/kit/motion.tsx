// Real-browser test page for the Live layer's motion primitives (the halo,
// its swell and breath, the row flash, the slide-in, the card lift,
// CountRoll and animateFrom), before any screen uses them. Served by the dev
// server at /e2e/kit/motion.html (add ?theme=dark for the dark theme); never
// part of a build. Read by e2e/motion-tokens.spec.ts.
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { animateFrom, CountRoll } from "@proxyshard/shardx-ui-kit";
import { StatusDot } from "../../src/shared/ui/StatusDot";
import "../../src/app/styles/index.css";

const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-theme", theme);

// For the tests to drive a move and redirect it mid-flight.
(window as unknown as { animateFrom: typeof animateFrom }).animateFrom = animateFrom;

const Case = ({ name, children }: { name: string; children: ReactNode }) => (
  <div data-case={name} className="flex h-9 items-center gap-2 px-3">{children}</div>
);

function Count() {
  const [n, setN] = useState(2);
  return (
    <>
      <Case name="count">
        <span className="text-page-title"><CountRoll value={n} /></span>
        <button type="button" onClick={() => setN((v) => v + 1)}>More</button>
        <button type="button" onClick={() => setN((v) => v - 1)}>Fewer</button>
      </Case>
      {/* In running text, as a sidebar or header count sits. */}
      <Case name="count-inline"><p className="text-ui">Running <CountRoll value={n} /> of <span>8</span></p></Case>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="bg-bg-white-0 py-2 text-ui text-text-strong-950">
      <Case name="halo"><StatusDot tone="success" halo /><span>Running</span></Case>
      <Case name="halo-once"><StatusDot tone="success" halo className="animate-halo-once" /><span>Running</span></Case>
      <Case name="breathe"><StatusDot tone="success" halo className="animate-breathe" /><span>Running</span></Case>
      <Case name="row-flash"><div className="row-flash relative h-9 flex-1 rounded-control" /></Case>
      <Case name="slide-in"><div className="slide-in relative h-9 flex-1 rounded-control" /></Case>
      <Case name="lift"><div className="hover-lift h-9 flex-1 rounded-surface border border-stroke-soft-200 bg-bg-white-0" /></Case>
      <Count />
      <Case name="move"><div className="size-6 rounded-chip bg-bg-sunken" style={{ transform: "translateY(8px)" }} /></Case>
    </main>
  </StrictMode>,
);
