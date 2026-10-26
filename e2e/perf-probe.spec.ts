import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "@playwright/test";
import { arrowDown, arrowDownHandler, backToProfilesMs, bulkUndoTint, createShowsAfterMs, filterTyping, firstPaintMs, firstRowsMs, idleLongTasks, peekBlankFrames, renameShowsAfterMs, scrollScriptPerFrame, scrollWithHeaderBlur, scrollWithHeaderSolid, startupBytes, twoThousandByName } from "./support/perf";
import { openSearch } from "./support/search";

// The numbers the Phase A owner report compares before and after the
// performance quick wins (overview A11). Skipped in normal runs:
//   PERF_PROBE=<label> [PERF_OUT=<file>] npx playwright test e2e/perf-probe.spec.ts --project=perf --no-deps
// merges its results into the output file under that label.
const LABEL = process.env.PERF_PROBE;
// Phase A's numbers are in docs/ui-redesign/audit-phase-a-perf.json; a later
// phase names its own file with PERF_OUT.
const OUT = process.env.PERF_OUT ?? "docs/ui-redesign/audit-phase-a-perf.json";

test("performance probe", async ({ page }) => {
  test.skip(!LABEL, "set PERF_PROBE=<label> to measure");
  test.setTimeout(900_000);
  await twoThousandByName(page);
  const cdp = await page.context().newCDPSession(page);
  const result: Record<string, unknown> = {};
  result.idle1x = await idleLongTasks(page, 10_000);
  result.scroll1xScriptMsPerFrame = await scrollScriptPerFrame(page, cdp);
  // The header material with its blur on (merge point 3 asked for it), and
  // the same frame reading with the header solid beside it (merge point 4),
  // so the blur's slow frames can be told from the scroll's own.
  result.scrollHeaderSolid1x = await scrollWithHeaderSolid(page, cdp);
  result.scrollHeaderBlur1x = await scrollWithHeaderBlur(page, cdp);
  result.arrowDown1x = await arrowDown(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  result.idle4x = await idleLongTasks(page, 10_000);
  result.scroll4xScriptMsPerFrame = await scrollScriptPerFrame(page, cdp);
  result.scrollHeaderSolid4x = await scrollWithHeaderSolid(page, cdp);
  result.scrollHeaderBlur4x = await scrollWithHeaderBlur(page, cdp);
  result.arrowDown4x = await arrowDown(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // An automation project saved through the API: how many profile list reloads follow (PERF-22).
  type M = { __shardxMock: { calls: Record<string, number>; emit: (e: string, p: unknown) => void } };
  const reloads = () => page.evaluate(() => (window as unknown as M).__shardxMock.calls.profile_list ?? 0);
  const before = await reloads();
  await page.evaluate(() => (window as unknown as M).__shardxMock.emit("store-changed", "automation"));
  await page.waitForTimeout(800);
  result.profileListReloadsOnAutomationChange = (await reloads()) - before;
  // Phase D (overview section 2; PERF-04, 13, 14, 16, 24; gap 9).
  result.arrowDownHandler1x = await arrowDownHandler(page);
  result.filterTyping1x = await filterTyping(page, "profile 01");
  await (await openSearch(page)).fill("");
  result.backToProfiles1x = await backToProfilesMs(page);
  // Merge point 3: a bulk Undo tints the whole view for 1 s (Live slide-in).
  result.bulkUndo1x = await bulkUndoTint(page, cdp);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  result.arrowDownHandler4x = await arrowDownHandler(page);
  result.filterTyping4x = await filterTyping(page, "profile 01");
  await (await openSearch(page)).fill("");
  result.backToProfiles4x = await backToProfilesMs(page);
  result.bulkUndo4x = await bulkUndoTint(page, cdp);
  result.firstPaint4x = await firstPaintMs(page, cdp, 4);
  result.firstPaint1x = await firstPaintMs(page, cdp, 1);
  // Window open (navigation start) to the first Profiles rows painted (speed lane 2026-10-02).
  result.firstRows1x = await firstRowsMs(page, 1);
  result.firstRows4x = await firstRowsMs(page, 4);
  result.peekBlankFrames = await peekBlankFrames(page);
  result.renameShowsAfterMs = await renameShowsAfterMs(page);
  result.createShowsAfterMs = await createShowsAfterMs(page);
  result.startupMain = await startupBytes(page);
  result.startupFleet = await startupBytes(page, "#/?fleet=1");
  const all = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  all[LABEL!] = { measuredAt: new Date().toISOString(), build: "preview:mock", profiles: 2000, sort: "name-asc", ...result };
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
  console.log(LABEL, JSON.stringify(result));
});
