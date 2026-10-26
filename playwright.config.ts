import { defineConfig } from "@playwright/test";

// A parallel worktree sets E2E_PORT to run its own dev server beside the main
// tree's 1420. It runs no preview server: the timing projects stay with the
// main tree.
const lanePort = process.env.E2E_PORT;
// E2E_BUILT=1 serves the app projects from a production build of the mock
// (dist-mock-e2e, `vite preview`) instead of the dev server: several times
// faster to load, and it fails fast. It needs E2E_PORT: the main tree's 1420
// and 4173 belong to the owner.
const built = process.env.E2E_BUILT === "1";
if (built && !lanePort) {
  throw new Error("E2E_BUILT=1 needs E2E_PORT (a free port; never 1420 or 4173, which are the owner's).");
}
const devURL = `http://127.0.0.1:${lanePort ?? "1420"}`;
// A lane measures timing on a preview build of its own, on its own port
// (PERF_PORT), never the main tree's 4173.
const perfPort = lanePort ? process.env.PERF_PORT : undefined;
const perfURL = `http://127.0.0.1:${perfPort ?? "4173"}`;
// Whole tiles only: a partial re-raster kept edge pixels from earlier paints,
// so an icon's anti-aliasing depended on the session's paint history.
const wholeRaster = { args: ["--disable-partial-raster"] };

// Screenshot and flow tests run against `npm run dev:mock`: the app in a plain
// browser with an in-page stand-in for the Tauri backend and seeded data.
// Baselines are per OS because fonts render differently on each.
export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "e2e/__screenshots__/{platform}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  // Built mode fails fast: a test that needs longer says so itself (test.slow()).
  ...(built ? { timeout: 15_000 } : {}),
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  },
  expect: {
    // The dev server re-transforms modules after an edit; the first page
    // load after that can take several seconds.
    timeout: built ? 5_000 : 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Renders are deterministic (fixed clock, mock data, idle wait, and
      // states.spec.ts settles hover and row focus), so no pixel past the
      // threshold may change. A ratio let ~1,000-pixel changes through, and
      // the default per-pixel threshold (0.2) let a gray shift of about
      // 50/255 pass as equal, which hid most dark-theme fill changes: 0.02
      // counts a step of 6/255 or more; anti-aliased edge pixels are
      // ignored (Audit Phase B, Task 17).
      maxDiffPixels: 0,
      threshold: 0.02,
    },
  },
  projects: [
    // Everything except the forced-colors shots and the timing tests.
    { name: "dev", grepInvert: built ? /@forced|@devserver/ : /@forced/, testIgnore: /(perf(-probe|-budget)?|startup)\.spec\.ts/, use: { baseURL: devURL, launchOptions: wholeRaster } },
    // The smallest window the app allows: compact sidebar, nothing clipped.
    {
      name: "compact",
      testMatch: /pages\.spec\.ts/,
      grepInvert: built ? /@devserver/ : undefined,
      snapshotPathTemplate: "e2e/__screenshots__/{platform}/{arg}-compact{ext}",
      use: { baseURL: devURL, viewport: { width: 1024, height: 680 }, launchOptions: wholeRaster },
    },
    // Windows High Contrast (forced colors): the state matrix's @forced shots
    // and the focus checks (focus.spec.ts).
    {
      name: "forced-colors",
      testMatch: /(states|focus)\.spec\.ts/,
      grep: /@forced/,
      grepInvert: built ? /@devserver/ : undefined,
      snapshotPathTemplate: "e2e/__screenshots__/{platform}/{arg}-forced{ext}",
      use: { baseURL: devURL, forcedColors: "active", launchOptions: wholeRaster },
    },
    // Timing and startup tests run on the production build of the mock, as the
    // audit measured (development React is several times slower), after every other
    // project so no other browser competes for the CPU, one file at a time.
    // Alone: `npx playwright test e2e/perf.spec.ts --project=perf --no-deps`.
    {
      name: "perf",
      testMatch: /(perf(-probe|-budget)?|startup)\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      dependencies: ["dev", "compact", "forced-colors"],
      use: { baseURL: perfURL },
    },
  ],
  webServer: [
    built
      // Built once per run (the e2e:built script builds first); a server left
      // from an earlier run is never reused, since it may serve an old build.
      ? { command: `VITE_MOCK=1 VITE_E2E_MODULES=1 npx vite build --outDir dist-mock-e2e && npx vite preview --outDir dist-mock-e2e --host 127.0.0.1 --port ${lanePort} --strictPort`, url: devURL, reuseExistingServer: false, timeout: 300_000 }
      : {
        command: lanePort ? `npm run dev:mock -- --port ${lanePort}` : "npm run dev:mock",
        url: devURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
    // The production build of the mock: the timing tests.
    ...(lanePort
      ? (perfPort
        ? [{ command: `VITE_MOCK=1 npx vite build --outDir dist-mock && npx vite preview --outDir dist-mock --host 127.0.0.1 --port ${perfPort} --strictPort`, url: perfURL, reuseExistingServer: false, timeout: 300_000 }]
        : [])
      : [{ command: "npm run preview:mock", url: "http://127.0.0.1:4173", reuseExistingServer: !process.env.CI, timeout: 300_000 }]),
  ],
});
