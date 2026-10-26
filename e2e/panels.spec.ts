import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { commits, countCommits } from "./support/perf";

// PERF-23: the always-on-top panels draw only when what they show changed,
// and the fleet monitor asks less often while nothing runs.
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls[c] ?? 0, cmd);

for (const [name, hash] of [["fleet monitor", "#/?fleet=1"], ["sync panel", "#/?syncPanel=g1"], ["helper panel", "#/?helperPanel=f62a9d43"]] as const) {
  test(`an idle ${name} does not draw again`, async ({ page }) => {
    await countCommits(page);
    await openApp(page, { hash, idle: false });
    await page.waitForTimeout(1500);
    const settled = await commits(page);
    await page.waitForTimeout(3000);
    expect(await commits(page)).toBe(settled);
  });
}

test("the fleet monitor asks every 3 s while no run is going", async ({ page }) => {
  await openApp(page, { hash: "#/?fleet=1", idle: false });
  await page.waitForTimeout(500);
  const first = await calls(page, "automation_fleet");
  await page.waitForTimeout(6200);
  expect((await calls(page, "automation_fleet")) - first).toBeLessThanOrEqual(3);
});
