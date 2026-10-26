// node --test: the interface size Auto picks for a screen and a window (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoInterfaceSize, sizeOf } from "./interfaceSize.ts";

const s = (width: number, height: number) => ({ width, height });

test("Auto goes by the screen in CSS px, OS scaling already in it", () => {
  // A laptop, a 1920 monitor, and 4K at 200%: 100%.
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080], [2199, 1300]]) assert.equal(autoInterfaceSize(s(w, h)), 100, `${w}`);
  // 2560 x 1440, and 4K at 150% (3840 / 1.5): 125%.
  for (const [w, h] of [[2200, 1300], [2560, 1440], [2560, 1600], [2799, 1600]]) assert.equal(autoInterfaceSize(s(w, h)), 125, `${w}`);
  // 4K and 5K at 100%: 150%.
  for (const [w, h] of [[2800, 1600], [3840, 2160], [5120, 2880]]) assert.equal(autoInterfaceSize(s(w, h)), 150, `${w}`);
  // Nothing to read (no screen): 100%.
  assert.equal(autoInterfaceSize(s(0, 0)), 100);
});

test("an ultrawide counts as its 16:9 part: its height decides, not its width", () => {
  assert.equal(autoInterfaceSize(s(3440, 1440)), 125);
  assert.equal(autoInterfaceSize(s(5120, 1440)), 125);
  assert.equal(autoInterfaceSize(s(2560, 1080)), 100);
});

test("never so big that the window shows less than 1280 x 800", () => {
  const k4 = s(3840, 2160);
  // Full screen: 150%.
  assert.equal(autoInterfaceSize(k4, s(3840, 2100)), 150);
  // The default window and the smallest: 100%.
  assert.equal(autoInterfaceSize(k4, s(1280, 800)), 100);
  assert.equal(autoInterfaceSize(k4, s(1024, 680)), 100);
  // 1920 x 1080: 125% (1536 x 864); 1440 x 900: 110%.
  assert.equal(autoInterfaceSize(k4, s(1920, 1080)), 125);
  assert.equal(autoInterfaceSize(k4, s(1440, 900)), 110);
  // 4K at 150%, the default window: 100%; maximized: 125%.
  assert.equal(autoInterfaceSize(s(2560, 1440), s(1280, 800)), 100);
  assert.equal(autoInterfaceSize(s(2560, 1440), s(2560, 1415)), 125);
});

test("a size a person picked wins over Auto", () => {
  const qhd = s(2560, 1440);
  assert.equal(sizeOf("auto", qhd), 125);
  assert.equal(sizeOf(100, qhd), 100);
  assert.equal(sizeOf(150, s(1280, 800)), 150);
});
