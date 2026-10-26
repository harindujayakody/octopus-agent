import { expect, test, type Page } from "@playwright/test";
import { appModule } from "./support/app";

// The Live layer's status model (Task 2, spec 4.2): `profileStatus` adds
// Stopping and Failed to start to the states the Profiles list, Peek, the
// pinned sidebar items and the palette already share. Run as the app loads
// it from the dev server, on the pills test page (no mock backend needed).

type Mod = typeof import("../src/entities/profile/lib/status");
type Opts = Parameters<Mod["profileStatus"]>[1];
type Win = { __status: Mod };

const NOW = Date.parse("2026-09-01T12:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
/** A launcher stamp, as the backend writes it ("@<unix seconds>"). */
const stamp = (ms: number) => `@${Math.floor(ms / 1000)}`;

async function load(page: Page) {
  await page.goto("/e2e/kit/pills.html");
  await appModule(page, "/src/entities/profile/lib/status.ts", "__status");
}

/** `profileStatus` for each case, in the browser: tone, label, dot and detail. */
function statuses(page: Page, cases: Record<string, { last: string | null; opts: Omit<Opts, "now" | "lang"> }>) {
  return page.evaluate(({ cases, now }) => {
    const m = (window as unknown as Win).__status;
    return Object.fromEntries(Object.entries(cases).map(([name, c]) =>
      [name, m.profileStatus({ last_launched_at: c.last }, { ...c.opts, now, lang: "en" })]));
  }, { cases, now: NOW });
}

const base = { starting: false, runningSince: undefined, proxyMissing: false };

test("Stopping wins over Running, and Starting over both", async ({ page }) => {
  await load(page);
  const s = await statuses(page, {
    stopping: { last: stamp(NOW - 5 * MIN), opts: { ...base, runningSince: NOW - 5 * MIN, stopping: true } },
    stoppingStopped: { last: stamp(NOW - 5 * MIN), opts: { ...base, stopping: true } },
    startingToo: { last: null, opts: { ...base, starting: true, stopping: true } },
  });
  expect(s.stopping).toEqual({ tone: "stopping", label: "Stopping…", dot: "info" });
  expect(s.stoppingStopped).toEqual({ tone: "stopping", label: "Stopping…", dot: "info" });
  expect(s.startingToo.tone).toBe("starting");
});

test("Failed to start shows while the failure is newer than the last launch and it is not running", async ({ page }) => {
  await load(page);
  const s = await statuses(page, {
    failed: { last: stamp(NOW - 3 * DAY), opts: { ...base, failedAt: NOW - MIN } },
    failedNeverRun: { last: null, opts: { ...base, failedAt: NOW - MIN } },
    // A failure outranks the proxy warning: it is what just happened.
    failedMissing: { last: null, opts: { ...base, proxyMissing: true, failedAt: NOW - MIN } },
    // A launch after the failure (here, or anywhere the backend saw one) settles it.
    launchedSince: { last: stamp(NOW - MIN), opts: { ...base, failedAt: NOW - 2 * MIN } },
  });
  expect(s.failed).toEqual({ tone: "failed", label: "Failed to start", dot: "error" });
  expect(s.failedNeverRun.tone).toBe("failed");
  expect(s.failedMissing.tone).toBe("failed");
  expect(s.launchedSince.tone).toBe("idle");
});

test("Failed to start clears once the profile runs, starts or stops", async ({ page }) => {
  await load(page);
  const s = await statuses(page, {
    running: { last: stamp(NOW - 3 * DAY), opts: { ...base, runningSince: NOW - 2 * MIN, failedAt: NOW - MIN } },
    starting: { last: stamp(NOW - 3 * DAY), opts: { ...base, starting: true, failedAt: NOW - MIN } },
    stopping: { last: stamp(NOW - 3 * DAY), opts: { ...base, stopping: true, failedAt: NOW - MIN } },
  });
  expect(s.running.tone).toBe("running");
  expect(s.starting.tone).toBe("starting");
  expect(s.stopping.tone).toBe("stopping");
});

test("without the new options every state reads as before", async ({ page }) => {
  await load(page);
  const s = await statuses(page, {
    starting: { last: null, opts: { ...base, starting: true } },
    running: { last: stamp(NOW - 3 * DAY), opts: { ...base, runningSince: NOW - (2 * 60 + 14) * MIN } },
    missing: { last: null, opts: { ...base, proxyMissing: true } },
    never: { last: null, opts: base },
    idle: { last: stamp(NOW - 3 * DAY), opts: base },
  });
  expect(s.starting).toEqual({ tone: "starting", label: "Starting…", dot: "info" });
  expect(s.running).toEqual({ tone: "running", label: "Running", dot: "success", detail: "Running for 2\u00a0h 14\u00a0min" });
  expect(s.missing).toMatchObject({ tone: "warning", label: "Proxy missing", dot: "warning" });
  expect(s.never).toEqual({ tone: "never", label: "Never run", dot: "outline" });
  expect(s.idle).toMatchObject({ tone: "idle", label: "3 days ago", dot: "neutral" });
});
