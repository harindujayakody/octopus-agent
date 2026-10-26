import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, row } from "./support/app";

// A client could not scroll the proxy list to its last rows (2.0.3: the panel
// ran past the window). With 40 proxies, at each Interface size and the
// window's least height, every proxy picker shows its last row whole by the
// wheel, by keys and by typing, and a click or Enter takes it.
test.use({ viewport: { width: 1280, height: 680 } });

const SANDBOX = "f62a9d43";
const LAST = "Proxy 0040";
const SIZES = [90, 100, 125, 150] as const;
type Mock = { __shardxMock: { state: { profiles: Record<string, { _meta: { proxy_id: string | null } }> } } };

const setUp = (page: Page, size: number) => page.addInitScript((s) => {
  (window as unknown as { __shardxMockProxies: number }).__shardxMockProxies = 40;
  localStorage.setItem("shardx.interfaceSize", String(s));
  // Read as a pick: the old build's "100" alone turns into Auto.
  localStorage.setItem("shardx.interfaceSize.auto", "1");
}, size);

/** Drawn whole: inside its list and the window, on top at both edges. */
const whole = (option: Locator) => option.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const list = el.closest("[role='listbox']")!.getBoundingClientRect();
  const onTop = (y: number) => {
    const hit = document.elementFromPoint(r.left + r.width / 2, y);
    return !!hit && el.contains(hit);
  };
  return r.top >= list.top - 0.5 && r.bottom <= list.bottom + 0.5 && r.bottom <= innerHeight && onTop(r.top + 1) && onTop(r.bottom - 1);
});

const option = (list: Locator, name: string) => list.getByRole("option", { name: new RegExp(`^${name}`) });

async function highlightIsWhole(list: Locator, name: string) {
  await expect(list.locator("[data-highlighted]")).toContainText(name);
  await expect.poll(() => whole(option(list, name))).toBe(true);
}

/** Wheel, keys and typing on a picker that `open` opens; `picked` names what it holds. */
async function reach(page: Page, open: () => Promise<void>, picked: () => Promise<string>) {
  const list = page.getByRole("dialog", { name: "Proxy", exact: true }).getByRole("listbox");

  await open();
  await option(list, "No proxy").hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 600);
  await expect.poll(() => whole(option(list, LAST))).toBe(true);
  await option(list, LAST).click();
  await expect.poll(picked).toContain(LAST);

  // It opens on the proxy it holds, the last one; the arrows wrap, the pages jump.
  await open();
  await highlightIsWhole(list, LAST);
  await page.keyboard.press("ArrowDown");
  await highlightIsWhole(list, "No proxy");
  await page.keyboard.press("ArrowUp");
  await highlightIsWhole(list, LAST);
  for (let i = 0; i < 5; i++) await page.keyboard.press("PageUp");
  await highlightIsWhole(list, "No proxy");
  for (let i = 0; i < 5; i++) await page.keyboard.press("PageDown");
  await highlightIsWhole(list, LAST);
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);

  await open();
  await page.keyboard.type("0039");
  await expect.poll(() => whole(option(list, "Proxy 0039"))).toBe(true);
  await option(list, "Proxy 0039").click();
  await expect.poll(picked).toContain("Proxy 0039");
}

for (const size of SIZES) {
  test(`the profile list's proxy picker reaches its last proxy at ${size}%`, async ({ page }) => {
    await setUp(page, size);
    await openApp(page);
    const boundTo = () => page.evaluate((id) => {
      const p = (window as unknown as Mock).__shardxMock.state.profiles[id]._meta.proxy_id;
      return p ? `Proxy ${p.replace("px-bulk-", "").padStart(4, "0")}` : "";
    }, SANDBOX);
    // P on the last row: the trigger sits at the window's foot.
    await reach(page, async () => {
      await row(page, "Sandbox").focus();
      await page.keyboard.press("p");
      await expect(page.getByRole("dialog", { name: "Proxy", exact: true }).getByRole("combobox")).toBeFocused();
    }, boundTo);
  });

  test(`the profile form's proxy picker reaches its last proxy at ${size}%`, async ({ page }) => {
    await setUp(page, size);
    await openApp(page);
    await row(page, "Sandbox").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Edit Sandbox", exact: true });
    await form.getByRole("tab", { name: "Proxy", exact: true }).click();
    const field = form.locator("[data-property='proxy'] button");
    await reach(page, async () => {
      await field.click();
      await expect(page.getByRole("dialog", { name: "Proxy", exact: true }).getByRole("combobox")).toBeFocused();
    }, () => field.innerText());
  });
}

// The toast of the last pick stays under the picker opened again: typing
// shrinks the panel and moves it down onto the toast (WebKit hid rows under it).
// Since the wide-screens round the panel no longer reaches one toast at 100 %,
// so two more stack under it: the overlap is made, not left to the layout.
type Toasts = { __shardxToast: { warn: (t: { title: string; detail?: string }) => number } };
for (const size of [100, 150] as const) {
  test(`a toast stays under the proxy picker that shrank onto it at ${size}%`, async ({ page }) => {
    await setUp(page, size);
    await openApp(page);
    const picker = page.getByRole("dialog", { name: "Proxy", exact: true });
    const open = async () => {
      await row(page, "Sandbox").focus();
      await page.keyboard.press("p");
      await expect(picker.getByRole("combobox")).toBeFocused();
    };
    await open();
    await page.keyboard.type("0040");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-toast]")).toHaveCount(1);
    await page.evaluate(() => {
      for (const n of [1, 2]) (window as unknown as Toasts).__shardxToast.warn({ title: `Check ${n}`, detail: "A line under the title, so the stack reaches up." });
    });
    await expect(page.locator("[data-toast]")).toHaveCount(3);
    await open();
    await page.keyboard.type("0039");
    await expect(picker.getByRole("option")).toHaveCount(1);
    // Where the panel and a toast overlap, a press lands on the panel.
    await expect.poll(() => picker.evaluate((panel) => {
      const p = panel.getBoundingClientRect();
      for (const el of document.querySelectorAll("[data-toast]")) {
        const t = el.getBoundingClientRect();
        const box = { left: Math.max(p.left, t.left), right: Math.min(p.right, t.right), top: Math.max(p.top, t.top), bottom: Math.min(p.bottom, t.bottom) };
        if (box.right - box.left < 4 || box.bottom - box.top < 4) continue;
        const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
        return hit && panel.contains(hit) ? "panel" : "toast";
      }
      return "no overlap";
    })).toBe("panel");
    await picker.getByRole("option", { name: /^Proxy 0039/ }).click();
    await expect(picker).toHaveCount(0);
  });
}
