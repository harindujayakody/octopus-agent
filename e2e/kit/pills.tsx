// Real-browser test page for the Live layer's pills (StatusPill,
// ProxyTestPill, ProtocolPill) in every state, before any screen uses them.
// Served by the dev server at /e2e/kit/pills.html (add ?theme=dark for the
// dark theme); never part of a build. Read by e2e/status-dots.spec.ts, the
// forced-colors case in e2e/focus.spec.ts and e2e/status-model.spec.ts.
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { profileStatus } from "../../src/entities/profile/lib/status";
import { ProtocolPill } from "../../src/shared/ui/ProtocolPill";
import { ProxyTestPill, StatusPill } from "../../src/shared/ui/StatusPill";
import { TagChip } from "../../src/shared/ui/TagChip";
import "../../src/app/styles/index.css";

const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-theme", theme);

const NOW = Date.parse("2026-09-01T12:00:00Z");
const MIN = 60_000;
const stamp = (ms: number) => `@${Math.floor(ms / 1000)}`;
const base = { starting: false, runningSince: undefined, now: NOW, lang: "en" as const, proxyMissing: false };
const threeDaysAgo = stamp(NOW - 3 * 1440 * MIN);

const profiles = {
  running: profileStatus({ last_launched_at: stamp(NOW - 120 * MIN) }, { ...base, runningSince: NOW - 120 * MIN }),
  starting: profileStatus({ last_launched_at: threeDaysAgo }, { ...base, starting: true }),
  stopping: profileStatus({ last_launched_at: threeDaysAgo }, { ...base, stopping: true }),
  failed: profileStatus({ last_launched_at: threeDaysAgo }, { ...base, failedAt: NOW - MIN }),
  idle: profileStatus({ last_launched_at: threeDaysAgo }, base),
  never: profileStatus({ last_launched_at: null }, base),
  warning: profileStatus({ last_launched_at: null }, { ...base, proxyMissing: true }),
};

/** One case: a row-like line on the list surface, as a pill sits in a row. */
const Case = ({ name, children }: { name: string; children: ReactNode }) => (
  <div data-case={name} className="flex h-9 items-center gap-2 px-3">{children}</div>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="bg-bg-white-0 py-2 text-ui text-text-strong-950">
      {Object.entries(profiles).map(([name, status]) => (
        <Case key={name} name={`profile-${name}`}><StatusPill status={status} /></Case>
      ))}
      <Case name="proxy-ok"><ProxyTestPill state="ok" ms={120} busy={false} detail="Reached in 120 ms, Sep 1, 12:00 PM" /></Case>
      <Case name="proxy-failed"><ProxyTestPill state="failed" busy={false} /></Case>
      <Case name="proxy-untested"><ProxyTestPill state="untested" busy={false} /></Case>
      <Case name="proxy-busy"><ProxyTestPill state="ok" ms={120} busy /></Case>
      <Case name="protocol-socks5"><ProtocolPill kind="socks5" /></Case>
      <Case name="protocol-http"><ProtocolPill kind="http" /></Case>
      <Case name="protocol-https"><ProtocolPill kind="https" /></Case>
      {/* A row's chips and pills line up (spec 4.2): a Tag chip beside a pill. */}
      <Case name="beside-tag">
        <StatusPill status={profiles.running} />
        <TagChip tag={{ id: "t-blue", name: "blue", color: "blue" }} />
      </Case>
    </main>
  </StrictMode>,
);
