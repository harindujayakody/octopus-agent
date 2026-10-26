import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

type Mock = { __shardxMock: { state: { profiles: Record<string, { _meta: { folder: string; pinned: boolean } }> } } };

// The sidebar at scale (LAYOUT-01): 12 Folders and 5 pinned profiles, as
// the layout audit measured. The seed has 2 Folders and 2 pinned profiles.
test("the mock seeds more Folders and pinned profiles on request", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockFolders: 10, __shardxMockPinned: 3 }));
  await openApp(page);
  const seen = await page.evaluate(() => {
    const metas = Object.values((window as unknown as Mock).__shardxMock.state.profiles).map((p) => p._meta);
    return { folders: new Set(metas.map((m) => m.folder).filter(Boolean)).size, pinned: metas.filter((m) => m.pinned).length };
  });
  expect(seen).toEqual({ folders: 12, pinned: 5 });
});
