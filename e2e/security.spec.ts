import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { isStoreLink } from "../src/entities/extension/model/link";
import { riskyLaunchArgs } from "../src/shared/lib/launchArgs";

// Frontend security hardening (overview A10). Each test names its finding.
type Mock = { __shardxMock: { calls: Record<string, number> } };
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as Mock).__shardxMock.calls[c] ?? 0, cmd);
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name });
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("SEC-04: folders are revealed, never opened", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Storage").click();
  await page.getByRole("button", { name: "Open folder" }).click();
  await page.locator("aside [data-nav='fingerprints']").click();
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Show library folder" }).click();
  await expect.poll(() => calls(page, "plugin:opener|reveal_item_in_dir")).toBe(2);
  expect(await calls(page, "plugin:opener|open_path")).toBe(0);
});

async function pick(page: Page, open: () => Promise<void>, name: string, content: string | Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await open();
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer: typeof content === "string" ? Buffer.from(content) : content });
}
const importCookies = (page: Page) => async () => {
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Import cookies" }).click();
};

test("SEC-07: cookies come from the file picker, never through a read-any-path command", async ({ page }) => {
  await openApp(page);
  await pick(page, importCookies(page), "cookies.json", JSON.stringify([{ name: "a" }, { name: "b" }]));
  await expect(page.locator("[data-toast]").filter({ hasText: "Imported 2 cookies" })).toBeVisible();
  expect(await calls(page, "read_text_file")).toBe(0);
});

test("SEC-07: a file over the limit is refused before it is read", async ({ page }) => {
  await openApp(page);
  await pick(page, importCookies(page), "cookies.json", Buffer.alloc(21 * 1024 * 1024, 32));
  await expect(page.locator("[data-toast]").filter({ hasText: "cookies.json is larger than 20 MB" })).toBeVisible();
  expect(await calls(page, "cookies_import")).toBe(0);
});

test("SEC-07: a fingerprint comes from the file picker", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const json = JSON.stringify({ name: "Picked one", navigator: { user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0" } });
  await pick(page, async () => {
    await page.locator("main header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Import from file" }).click();
  }, "fp.json", json);
  await expect(page.locator("[data-toast]").filter({ hasText: 'Imported “Picked one”' })).toBeVisible();
});

test("SEC-07: a clipboard import over 5 MB is refused", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = "x".repeat(5 * 1024 * 1024 + 1); });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("import");
  await page.getByRole("option", { name: /^Import profiles/ }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "The clipboard holds more than 5 MB" })).toBeVisible();
  expect(await calls(page, "profile_import")).toBe(0);
});

test("SEC-08: an http link is refused; a link outside the Web Store is flagged", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await page.getByRole("button", { name: "Add extension" }).click();
  await page.getByRole("menuitem", { name: "From a link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add from a link" });
  const field = dialog.getByRole("textbox", { name: /Web Store page/ });
  await field.fill("http://example.com/ext.crx");
  await expect(dialog).toContainText("Use an https link.");
  await expect(dialog.getByRole("button", { name: "Download" })).toBeDisabled();
  await field.fill("https://example.com/ext.crx");
  await expect(dialog).toContainText("This file is not from the Chrome Web Store.");
  await expect(dialog.getByRole("button", { name: "Download" })).toBeEnabled();
  await field.fill("https://chromewebstore.google.com/detail/ublock/cjpalhdlnbpafiamejdnhcphjbkeiagm");
  await expect(dialog).not.toContainText("not from the Chrome Web Store");
});

test("SEC-17: an extension icon that is not an image data URL is not loaded", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { extensions: { icon: string }[] }; save: () => void } }).__shardxMock;
    m.state.extensions[0].icon = "https://tracker.example/icon.png";
    m.save();
  });
  await page.reload();
  await expect(page.locator("main")).toContainText("uBlock Origin Lite");
  await expect(page.locator("img[src^='https://tracker.example']")).toHaveCount(0);
});

type Args = { __shardxMock: { state: { settings: { extra_args?: string } } } };
const extraArgs = (page: Page) => page.evaluate(() => (window as unknown as Args).__shardxMock.state.settings.extra_args ?? "");

test("SEC-10: a risky launch argument is named, and saving it asks first", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Profile defaults").click();
  const field = page.getByRole("textbox", { name: "Extra start arguments" });
  const value = "--proxy-server=direct:// --no-sandbox";
  await field.fill(value);
  const main = page.locator("main");
  await expect(main).toContainText("--proxy-server overrides every profile’s proxy. Sites see your real IP.");
  await expect(main).toContainText("--no-sandbox turns off one of the browser’s own protections.");
  // Save asks first (manual save): leaving the field does not.
  await field.blur();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const save = page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true });
  await save.click();
  const dialog = page.getByRole("alertdialog", { name: "Save these start arguments?" });
  await expect(dialog).toContainText("--proxy-server, --no-sandbox");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await extraArgs(page)).toBe("");
  // Cancel saves nothing and keeps what was typed.
  await expect(field).toHaveValue(value);
  await save.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save anyway" }).click();
  await expect.poll(() => extraArgs(page)).toBe(value);
});

test("SEC-12: the plain-HTTP location service says so, whole, in the field and in its list", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Profile defaults").click();
  const field = page.getByRole("combobox", { name: "Proxy geo checker" });
  await expect(field).toContainText("ip-api.com (HTTP, 45 requests/min)");
  // A badge the label gives way to: never cut (controller ruling, Pair 35).
  const inside = async (inner: Locator, outer: Locator) => {
    const [a, b] = [await inner.boundingBox(), await outer.boundingBox()];
    return !!a && !!b && a.x >= b.x && a.x + a.width <= b.x + b.width + 0.5;
  };
  const badge = field.getByText("Not encrypted", { exact: true });
  await expect(badge).toBeVisible();
  expect(await inside(badge, field)).toBe(true);
  await field.click();
  const list = page.getByRole("listbox", { name: "Proxy geo checker" });
  const option = list.getByRole("option", { name: /ip-api\.com/ });
  await expect(option.getByText("Not encrypted", { exact: true })).toBeVisible();
  expect(await inside(option.getByText("Not encrypted", { exact: true }), option)).toBe(true);
  // The list is as wide as its options, up to 360 px, so they read whole.
  const [fw, lw] = [(await field.boundingBox())!.width, (await list.boundingBox())!.width];
  expect(lw).toBeGreaterThan(fw);
  expect(lw).toBeLessThanOrEqual(360);
});

const proxyRow = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
type Proxies = { __shardxMock: { state: { proxies: { id: string; host: string; username: string }[] } } };
const storedProxy = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as Proxies).__shardxMock.state.proxies.find((p) => p.id === id), id);

test("SEC-15: key and password fields turn off autofill, spellcheck and autocorrect", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "DC Tokyo").locator("[data-cell='name']").click();
  // The panel only shows the password; Edit opens the dialog that has the field.
  await page.locator("aside[data-peek='proxy']").getByRole("button", { name: "Edit", exact: true }).click();
  // Exact: the eye inside the field is "Show password" (F1).
  const pw = page.getByRole("dialog", { name: "Edit DC Tokyo", exact: true }).getByLabel("Password", { exact: true });
  await expect(pw).toHaveAttribute("autocomplete", "off");
  await expect(pw).toHaveAttribute("spellcheck", "false");
  await expect(pw).toHaveAttribute("autocorrect", "off");
});

test("WIG-03: a proxy host pasted with spaces is saved without them", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "DC Tokyo").locator("[data-cell='name']").click();
  await page.locator("aside[data-peek='proxy']").getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit DC Tokyo", exact: true });
  await dialog.getByRole("textbox", { name: "Host" }).fill(" 203.0.113.95 ");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await storedProxy(page, "px-jp-1"))?.host).toBe("203.0.113.95");
});

test("SEC-14: a Folder named like an object property gets the plain look", async ({ page }) => {
  await openApp(page);
  // Through the backend, not the New folder dialog: the dialog path stores
  // an explicit look first, which would pass even with the bug (SEC-14).
  await page.evaluate(() =>
    (window as any).__TAURI_INTERNALS__.invoke("profile_set_folder", { id: "f62a9d43", folder: "constructor" }),
  );
  await page.reload();
  await expect(page.locator("aside [data-folder='constructor'] [data-folder-icon]")).toHaveAttribute("data-folder-icon", "folder");
});

const dragOverMain = (page: Page, withFile: boolean) =>
  page.evaluate((withFile) => {
    const dt = new DataTransfer();
    if (withFile) dt.items.add(new File(["<h1>x</h1>"], "page.html", { type: "text/html" }));
    else dt.setData("text/plain", "a78a0eea");
    const e = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector("main")!.dispatchEvent(e);
    return e.defaultPrevented;
  }, withFile);
const menuPrevented = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.querySelector(s)!.dispatchEvent(e);
    return e.defaultPrevented;
  }, selector);

test("SEC-18: a file dragged onto the window cannot replace the app; a profile drag is left alone", async ({ page }) => {
  await openApp(page);
  expect(await dragOverMain(page, true)).toBe(true);
  expect(await dragOverMain(page, false)).toBe(false);
});

test("EMIL-22: no webview menu outside fields; fields keep theirs", async ({ page }) => {
  await openApp(page);
  expect(await menuPrevented(page, "main header")).toBe(true);
  expect(await menuPrevented(page, "main header input")).toBe(false);
});

// ## Fix round 1 (review findings on Tasks 23-26)

test("REVIEW-1: one clipboard cap helper, not a hard-coded message at each call site", async ({ page }) => {
  // Both stores must build the "too big" toast from the same helper, so the
  // MB figure always matches CLIPBOARD_MAX_CHARS, never a copied literal that
  // could go stale if the cap ever changes.
  const profileSrc = readFileSync("src/entities/profile/lib/useProfile.tsx", "utf8");
  const proxySrc = readFileSync("src/entities/proxy/lib/useProxy.tsx", "utf8");
  for (const src of [profileSrc, proxySrc]) {
    expect(src).toMatch(/clipboardTooBig\(/);
    expect(src).not.toMatch(/["']5 MB["']/);
  }

  // The proxies clipboard-import path itself, over the cap.
  await openApp(page, { section: "proxies" });
  await page.evaluate(() => {
    (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = "x".repeat(5 * 1024 * 1024 + 1);
  });
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import proxies from clipboard" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "The clipboard holds more than 5 MB" })).toBeVisible();
});

test("REVIEW-2: extension links are allowed only as https or a bare id, after trimming all whitespace including NEL", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await page.getByRole("button", { name: "Add extension" }).click();
  await page.getByRole("menuitem", { name: "From a link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add from a link" });
  const field = dialog.getByRole("textbox", { name: /Web Store page/ });
  const download = dialog.getByRole("button", { name: "Download" });

  // JS `trim()` keeps U+0085 (NEL); the backend's Rust `trim()` strips it, so
  // a prefix check on the JS-trimmed text alone would let this reach the
  // backend as a plain-http link (SEC-08).
  await field.fill("\u0085http://host/x.crx");
  await expect(dialog).toContainText("Use an https link.");
  await expect(download).toBeDisabled();

  await field.fill("http://host/x.crx");
  await expect(download).toBeDisabled();

  await field.fill("https://host/x.crx");
  await expect(download).toBeEnabled();

  await field.fill("cjpalhdlnbpafiamejdnhcphjbkeiagm");
  await expect(download).toBeEnabled();

  await field.fill("javascript:alert(1)");
  await expect(download).toBeDisabled();

  await field.fill("data:text/html,evil");
  await expect(download).toBeDisabled();
});

test("REVIEW-3: store detection normalizes the URL instead of matching a string prefix", () => {
  // A look-alike host: a subdomain of the imitator, not the real store.
  expect(isStoreLink("https://chromewebstore.google.com.evil.com/detail/x/cjpalhdlnbpafiamejdnhcphjbkeiagm")).toBe(false);
  // A userinfo trick: the real host, per the URL parser, is evil.com.
  expect(isStoreLink("https://chromewebstore.google.com@evil.com/detail/x/cjpalhdlnbpafiamejdnhcphjbkeiagm")).toBe(false);
  // A path that only looks like /webstore/... before the ".." resolves away.
  expect(isStoreLink("https://chrome.google.com/webstore/../url?q=https://evil.example/x.crx")).toBe(false);
  // The real store host, but no id segment pointing at a specific extension.
  expect(isStoreLink("https://chromewebstore.google.com/")).toBe(false);
  // Uppercase is not a real extension id.
  expect(isStoreLink("CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM")).toBe(false);

  // A real store detail URL, either host form.
  expect(isStoreLink("https://chromewebstore.google.com/detail/ublock/cjpalhdlnbpafiamejdnhcphjbkeiagm")).toBe(true);
  expect(isStoreLink("https://chrome.google.com/webstore/detail/ublock/cjpalhdlnbpafiamejdnhcphjbkeiagm")).toBe(true);
  // A lowercase bare id.
  expect(isStoreLink("cjpalhdlnbpafiamejdnhcphjbkeiagm")).toBe(true);
});

test("REVIEW-3: the extensions dialog reflects store detection (off-store link flagged, store link not)", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await page.getByRole("button", { name: "Add extension" }).click();
  await page.getByRole("menuitem", { name: "From a link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add from a link" });
  const field = dialog.getByRole("textbox", { name: /Web Store page/ });

  // Real store host, but no id segment: still flagged (SEC-08 review).
  await field.fill("https://chromewebstore.google.com/");
  await expect(dialog).toContainText("This file is not from the Chrome Web Store.");

  // A path that only looks like it is under /webstore/ before ".." resolves
  // it away: still flagged, not treated as a store link (SEC-08 review).
  await field.fill("https://chrome.google.com/webstore/../url?q=https://evil.example/x.crx");
  await expect(dialog).toContainText("This file is not from the Chrome Web Store.");

  await field.fill("https://chromewebstore.google.com/detail/ublock/cjpalhdlnbpafiamejdnhcphjbkeiagm");
  await expect(dialog).not.toContainText("not from the Chrome Web Store");
});

// ## Fix round 2 (review findings on Tasks 27, 29, 30)

test("REVIEW-4: launch-argument switches are recognized under any Chromium prefix and the Rust whitespace set", () => {
  // Chromium accepts `-`, `--` or (Windows) `/` as a switch prefix; all three
  // must normalize to the same flag (review finding on SEC-10/Task 27).
  expect(riskyLaunchArgs("-no-sandbox").map((r) => r.flag)).toEqual(["--no-sandbox"]);
  expect(riskyLaunchArgs("-remote-debugging-port=9222").map((r) => r.flag)).toEqual(["--remote-debugging-port"]);
  expect(riskyLaunchArgs("/proxy-server=direct://").map((r) => r.flag)).toEqual(["--proxy-server"]);

  // The backend's Rust tokenizer splits on `char::is_whitespace` (JS `\s`
  // plus U+0085 NEL); U+FEFF is in JS `\s` but is not Unicode White_Space and
  // must not split a token here either.
  expect(riskyLaunchArgs("x\u0085--no-sandbox").map((r) => r.flag)).toEqual(["--no-sandbox"]);
  expect(riskyLaunchArgs("x﻿--no-sandbox")).toEqual([]);

  // The three switches this round adds.
  expect(riskyLaunchArgs("--user-data-dir=/tmp/x")).toEqual([{ flag: "--user-data-dir", risk: "profile" }]);
  expect(riskyLaunchArgs("--load-extension=/tmp/ext")).toEqual([{ flag: "--load-extension", risk: "extension" }]);
  expect(riskyLaunchArgs("--ignore-certificate-errors")).toEqual([{ flag: "--ignore-certificate-errors", risk: "cert" }]);

  // A harmless argument is never flagged.
  expect(riskyLaunchArgs("--window-size=1280,800")).toEqual([]);
});

test("REVIEW-4: each new/normalized form is named in the warning and asks on save; a harmless argument does not ask", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Profile defaults").click();
  const field = page.getByRole("textbox", { name: "Extra start arguments" });
  const main = page.locator("main");
  const save = page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true });

  await field.fill("-no-sandbox -remote-debugging-port=9222 /proxy-server=direct://");
  await expect(main).toContainText("--no-sandbox turns off one of the browser’s own protections.");
  await expect(main).toContainText("--remote-debugging-port lets other programs control the browser over a network port.");
  await expect(main).toContainText("--proxy-server overrides every profile’s proxy. Sites see your real IP.");
  // Save asks (manual save).
  await save.click();
  await expect(page.getByRole("alertdialog", { name: "Save these start arguments?" })).toContainText(
    "--no-sandbox, --remote-debugging-port, --proxy-server",
  );
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

  await field.fill("--user-data-dir=/tmp/x --load-extension=/tmp/ext --ignore-certificate-errors");
  await expect(main).toContainText("--user-data-dir would make every profile share one data folder.");
  await expect(main).toContainText("--load-extension runs code in every profile.");
  await expect(main).toContainText("--ignore-certificate-errors lets sites with bad certificates load without a warning.");
  await save.click();
  await expect(page.getByRole("alertdialog", { name: "Save these start arguments?" })).toContainText(
    "--user-data-dir, --load-extension, --ignore-certificate-errors",
  );
  await page.getByRole("alertdialog").getByRole("button", { name: "Save anyway" }).click();
  await expect.poll(() => extraArgs(page)).toBe("--user-data-dir=/tmp/x --load-extension=/tmp/ext --ignore-certificate-errors");

  await field.fill("--window-size=1280,800");
  await save.click();
  await expect.poll(() => extraArgs(page)).toBe("--window-size=1280,800");
  await expect(page.getByRole("alertdialog", { name: "Save these start arguments?" })).toHaveCount(0);
});

test("REVIEW-6: FolderDialog's own-key lookup does not read from Object.prototype", async ({ page }) => {
  await openApp(page);
  // Through the backend, not the New folder dialog: the dialog's create path
  // stores an explicit look first, which would hide the bug (as SEC-14 does).
  await page.evaluate(() =>
    (window as any).__TAURI_INTERNALS__.invoke("profile_set_folder", { id: "f62a9d43", folder: "constructor" }),
  );
  await page.evaluate(() =>
    (window as any).__TAURI_INTERNALS__.invoke("profile_set_folder", { id: "e51f8c32", folder: "toString" }),
  );
  await page.reload();

  for (const name of ["constructor", "toString"]) {
    const folderRow = page.locator(`aside [data-folder='${name}']`);
    await folderRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit folder" }).click();
    await page.getByRole("dialog", { name: "Edit folder" }).getByRole("button", { name: "Save" }).click();
    // Without the `hasOwn` guard, `byName[name]` reads `Object.prototype`'s
    // own "constructor"/"toString" instead of `undefined`, so Save writes an
    // `{icon: undefined, ...}` look and the attribute below goes missing.
    await expect(folderRow.locator("[data-folder-icon]")).toHaveAttribute("data-folder-icon", "folder");
  }
});

type CtxLog = { __ctxLog: { target: string; prevented: boolean }[] };
const armCtxLog = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as CtxLog).__ctxLog = [];
    document.addEventListener("contextmenu", (e) => {
      (window as unknown as CtxLog).__ctxLog.push({ target: (e.target as Element)?.tagName ?? "", prevented: e.defaultPrevented });
    });
  });
const ctxLog = (page: Page) => page.evaluate(() => (window as unknown as CtxLog).__ctxLog);

test("EMIL-22: a selection keeps the webview menu only at the selected spot; a text field always keeps it, a checkbox never does", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Profile defaults").click();
  await armCtxLog(page);

  // Select a word of plain page prose: nothing here opens its own menu, so
  // only the guard decides (real browser selection, not a synthetic Range:
  // right-clicking elsewhere collapses a real selection, which matters here).
  // A word on the first line: help wraps at its reading width (TYPE-05), and
  // the paragraph's center can fall on the soft wrap, which selects only it.
  const para = page.locator("main p").first();
  // Chrome text is never selectable since Pair 46 (H5); a value a person
  // copies is (fields, code, data-selectable). Mark this line as one, so the
  // guard's rule is what this checks.
  await para.evaluate((el) => el.setAttribute("data-selectable", ""));
  const word = { x: 30, y: 9 };
  await para.dblclick({ position: word });
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).not.toBe("");
  // Right-click on the still-selected word: kept.
  await para.click({ button: "right", position: word });
  // Right-click elsewhere (outside that selection, and outside any field): suppressed.
  await page.locator("main header").click({ button: "right", position: { x: 5, y: 5 } });
  // A text field: kept, selection or not.
  await page.getByRole("textbox", { name: "Extra start arguments" }).click({ button: "right" });
  // A checkbox is not a text field: suppressed.
  await page.getByRole("switch", { name: "Use an Octopus Agent camera in profiles" }).click({ button: "right" });

  expect((await ctxLog(page)).map((e) => e.prevented)).toEqual([false, true, false, true]);
});
