import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { failures, pairs, popoverStepFailures, themeTokens } from "./check-contrast.mjs";
import { over, parseHex, toHex } from "../ui-kit/scripts/color-math.mjs";

const kit = readFileSync(new URL("../ui-kit/src/styles/tokens.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app/styles/index.css", import.meta.url), "utf8");

test("the shipped tokens pass every pair in both themes and both contrast modes", () => {
  assert.deepEqual(failures(kit, app), []);
});

test("a failing text level is reported with its layer and ratio", () => {
  // Today's tertiary text (#a3a3a3) on white is 2.52:1 (COLOR-02).
  const weak = kit.replace("--text-soft-400: #696969;", "--text-soft-400: #a3a3a3;");
  const bad = failures(weak, app).filter((f) => f.where === "light");
  assert.ok(bad.some((f) => f.name === "--text-soft-400 on surface" && Math.abs(f.ratio - 2.52) < 0.01));
});

test("the dark theme reads its own block over the light one", () => {
  assert.equal(themeTokens(kit, app, "light")["--text-soft-400"], "#696969");
  assert.equal(themeTokens(kit, app, "dark")["--text-soft-400"], "#9e9e9e");
  assert.equal(themeTokens(kit, app, "dark")["--label-green"], "#24c460");
});

test("the focus outline and the control edge are measured on every layer", () => {
  const names = pairs(themeTokens(kit, app, "light")).map(([n]) => n);
  for (const layer of ["canvas", "surface", "raised", "sunken", "active/canvas", "selected/surface"]) {
    assert.ok(names.includes(`--focus on ${layer}`), `--focus on ${layer}`);
    assert.ok(names.includes(`--stroke-control on ${layer}`), `--stroke-control on ${layer}`);
  }
});

test("state text is measured on its tint and tint-hover over rows, and state base on rows", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const st of ["error", "warning", "success", "information"]) {
      for (const fill of ["tint", "tint-hover"]) {
        for (const layer of ["surface", "hover/surface", "active/surface", "selected/surface"]) {
          const name = `--${st}-text on --${st}-${fill} over ${layer}`;
          assert.ok(names.includes(name), `${theme}: ${name}`);
        }
      }
      for (const layer of ["canvas", "surface", "hover/surface", "active/surface", "selected/surface"]) {
        assert.ok(names.includes(`--${st}-base on ${layer}`), `${theme}: --${st}-base on ${layer}`);
      }
    }
  }
});

test("the cascade follows index.css: kit light, kit dark, then the app's blocks", () => {
  const appDark = '[data-theme="dark"] { --label-green: #24c460; }';
  // An app :root value comes after the kit's dark block, so it wins in dark too.
  assert.equal(themeTokens(kit, `:root { --text-soft-400: #777777; }\n${appDark}`, "dark")["--text-soft-400"], "#777777");
  assert.equal(themeTokens(kit, app, "dark")["--text-soft-400"], "#9e9e9e");
});

test("the primary fill is measured from its token", () => {
  const pale = kit.replace("--color-primary-base: #535efd;", "--color-primary-base: #a3a8ff;");
  assert.ok(failures(pale, app).some((f) => f.name === "white on --color-primary-base" && f.where === "light"));
});

test("the popover surface is measured and sits at least 0.04 OKLCH above the dark list tile", () => {
  const names = pairs(themeTokens(kit, app, "dark")).map(([n]) => n);
  for (const layer of ["popover", "hover/popover", "active/popover"]) {
    assert.ok(names.includes(`--text-strong-950 on ${layer}`), layer);
    assert.ok(names.includes(`--text-sub-600 on ${layer}`), layer);
  }
  assert.ok(names.includes("--text-soft-400 on popover"));
  assert.deepEqual(popoverStepFailures(kit, app), []);
  // The old value (the tile's own #222222) is reported with its step.
  const flat = kit.replace(/(\[data-theme="dark"\] \{[\s\S]*?--bg-popover:\s*)#[0-9a-f]{6}/, "$1#222222");
  const bad = popoverStepFailures(flat, app);
  assert.equal(bad.length, 1);
  assert.ok(Math.abs(bad[0].step) < 1e-6);
});

// Review I1 (clarity fixes): the highlighted and pressed row of the lighter dark
// popover lies under the chips, badges and icons in it.
test("a highlighted or pressed popover row is measured for chips, state tints, pills and the sub icon", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const layer of ["hover/popover", "active/popover"]) {
      assert.ok(names.includes(`label-chip violet text on its tint over ${layer}`), `${theme}: chip over ${layer}`);
      assert.ok(names.includes(`--icon-sub-600 on ${layer}`), `${theme}: icon over ${layer}`);
      assert.ok(names.includes(`--text-strong-950 on --bg-weak-50 over ${layer}`), `${theme}: pill over ${layer}`);
      for (const st of ["error", "warning", "success", "information"]) {
        assert.ok(names.includes(`--${st}-text-on-highlight on --${st}-tint over ${layer}`), `${theme}: ${st} over ${layer}`);
      }
      assert.ok(names.includes(`--primary-text-on-highlight on --primary-tint over ${layer}`), `${theme}: primary over ${layer}`);
    }
  }
  assert.deepEqual(failures(kit, app), []);
});

test("the old chip share and the plain state text fail on a highlighted popover row", () => {
  // Before: a chip kept its resting 70% text share, a badge its resting text.
  const oldChip = app.replace(/(--label-chip-text-highlight: )45%/, "$170%");
  const chips = failures(kit, oldChip).filter((f) => f.where === "dark" && f.name.startsWith("label-chip") && /over (hover|active)\/popover/.test(f.name));
  assert.equal(chips.length, 16, "8 hues on a highlighted and on a pressed row");
  assert.ok(chips.every((f) => f.ratio < 4.5));
  const dark = themeTokens(kit, app, "dark");
  const plain = kit.replace(dark["--error-text-on-highlight"], dark["--error-text"]);
  assert.ok(failures(plain, app).some((f) => f.where === "dark" && f.name === "--error-text-on-highlight on --error-tint over hover/popover"));
});

test("the CLI runs through a symlink whose path has spaces", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "contrast check "));
  try {
    const link = join(dir, "check contrast.mjs");
    try {
      symlinkSync(fileURLToPath(new URL("./check-contrast.mjs", import.meta.url)), link);
    } catch {
      t.skip("symlinks are not allowed here");
      return;
    }
    assert.match(execFileSync(process.execPath, [link], { encoding: "utf8" }), /^contrast OK: \d+ pairs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tinted Alert's text and icons are measured on every state tint, over canvas, surface and raised", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const st of ["error", "warning", "success", "information", "primary"]) {
      for (const fill of ["tint", "tint-hover"]) {
        for (const layer of ["canvas", "surface", "raised"]) {
          for (const fg of ["--text-strong-950", "--text-sub-600", "--icon-sub-600", `--${st}-text`]) {
            const name = `${fg} on --${st}-${fill} over ${layer}`;
            assert.ok(names.includes(name), `${theme}: ${name}`);
          }
        }
      }
    }
  }
});

test("a filled Alert's white text is measured on each state's fill", () => {
  const names = pairs(themeTokens(kit, app, "dark")).map(([n]) => n);
  for (const f of ["--warning-fill", "--success-fill", "--information-fill"]) assert.ok(names.includes(`white on ${f}`), f);
  // The dark warning base (#f28f29) holds white at 2.40:1: a fill that fell back to it fails.
  const pale = kit.replace(/--warning-fill: #[0-9a-f]+;/g, "--warning-fill: #f28f29;");
  assert.ok(failures(pale, app).some((f) => f.name === "white on --warning-fill" && f.where === "dark" && Math.abs(f.ratio - 2.4) < 0.01));
});

// Owner (Task 14 fix round): in dark a filled Alert is the state's tint, as
// every other state surface, not a solid block; light keeps the solid fill.
test("a filled Alert's text and dismiss are measured on its own fill: solid in light, the state tint in dark", () => {
  const light = themeTokens(kit, app, "light");
  const dark = themeTokens(kit, app, "dark");
  for (const st of ["error", "warning", "success", "information", "primary"]) {
    assert.equal(dark[`--${st}-alert`], `var(--${st}-tint-hover)`, `dark --${st}-alert`);
    assert.notEqual(light[`--${st}-alert`], `var(--${st}-tint-hover)`, `light --${st}-alert`);
  }
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const st of ["error", "warning", "success", "information", "primary"]) {
      for (const layer of ["canvas", "surface", "raised"]) {
        assert.ok(names.includes(`--on-alert on --${st}-alert over ${layer}`), `${theme}: --on-alert on --${st}-alert over ${layer}`);
        assert.ok(names.includes(`--on-alert-soft on --${st}-alert over ${layer}`), `${theme}: --on-alert-soft on --${st}-alert over ${layer}`);
      }
    }
  }
  // Dark text on the dark tint fails: the pair is really measured.
  const dim = kit.replace(/(\[data-theme="dark"\] \{[\s\S]*?--on-alert: )[^;]+;/, "$1#303030;");
  assert.ok(failures(dim, app).some((f) => f.where === "dark" && f.name === "--on-alert on --warning-alert over canvas"));
});

test("the CLI guard takes an argv[1] that is not a file", () => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `process.argv[1] = "[eval]"; await import(${JSON.stringify(new URL("./check-contrast.mjs", import.meta.url).href)}); console.log("imported")`], { encoding: "utf8" });
  assert.equal(out.trim(), "imported");
});

test("Increase contrast reads its own block in each theme", () => {
  assert.equal(themeTokens(kit, app, "light", true)["--text-soft-400"], "#404040");
  assert.equal(themeTokens(kit, app, "dark", true)["--text-soft-400"], "#cecece");
  assert.equal(themeTokens(kit, app, "dark", true)["--text-strong-950"], "#ededed");
});

// Live layer (Task 2): Folder, Tag and protocol chips (`.label-chip`) mix
// their hue into a tint and a text color; the check reads the same recipe
// tokens the stylesheet uses, so a change to the mix is measured.
test("label-chip text is measured on its own tint for every hue, over the rows it sits on", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const hue of ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky"]) {
      for (const layer of ["surface", "raised", "hover/surface", "active/surface", "selected/surface"]) {
        assert.ok(names.includes(`label-chip ${hue} text on its tint over ${layer}`), `${theme}: ${hue} over ${layer}`);
      }
    }
  }
  const light = themeTokens(kit, app, "light");
  const dark = themeTokens(kit, app, "dark");
  assert.deepEqual([light["--label-chip-tint"], light["--label-chip-text"], light["--label-chip-ink"]], ["14%", "62%", "#000"]);
  assert.deepEqual([dark["--label-chip-tint"], dark["--label-chip-text"], dark["--label-chip-ink"]], ["22%", "70%", "#fff"]);
});

test("a label-chip text mix too close to its hue fails", () => {
  // 90% of the hue, 10% toward black: light violet text on its own tint.
  const pale = app.replace(/(:root \{[\s\S]*?--label-chip-text: )62%/, (_, head) => `${head}90%`);
  assert.ok(failures(kit, pale).some((f) => f.where === "light" && f.name.startsWith("label-chip violet text on its tint")));
});

// Live layer, Task 5: a gray pill (Badge gray: sub text on the weak fill)
// sits on rows that may be hovered, the keyboard target or checked.
test("a gray pill's text is measured on its fill over every row it sits on", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const layer of ["surface", "hover/surface", "active/surface", "selected/surface"]) {
      assert.ok(names.includes(`--text-sub-600 on --bg-weak-50 over ${layer}`), `${theme}: ${layer}`);
    }
  }
  // A weak fill as dark as the text fails there.
  const heavy = kit.replace("--bg-weak-50: #0000000a;", "--bg-weak-50: #00000066;");
  assert.ok(failures(heavy, app).some((f) => f.where === "light" && f.name === "--text-sub-600 on --bg-weak-50 over active/surface"));
});

// L3 review N5: the Live tint lies over a row's text as well as its fill;
// at its peak the row's gray text stays at 4.5:1 on every row state.
test("a row's gray text is measured under the Live tint at its peak, on every row state", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const tint of ["--success-tint", "--primary-tint"]) {
      for (const layer of ["surface", "hover/surface", "active/surface", "selected/surface"]) {
        assert.ok(names.includes(`--text-sub-600 under ${tint} at its peak over ${layer}`), `${theme}: ${tint} over ${layer}`);
      }
    }
  }
  // A tint as strong as a fill fails there.
  const loud = kit.replace("--primary-tint: #535efd38;", "--primary-tint: #535efdb3;");
  assert.ok(failures(kit, app).length === 0);
  assert.ok(failures(loud, app).some((f) => f.where === "dark" && f.name.startsWith("--text-sub-600 under --primary-tint at its peak")));
});

test("borderless tiles: the text levels, the control edge and the focus outline are measured on a tile, a hovered row on it and a control on it", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const layer of ["tile", "hover/tile", "on-tile"]) {
      for (const fg of ["--text-strong-950", "--text-sub-600", "--text-soft-400", "--stroke-control", "--focus"]) {
        assert.ok(names.includes(`${fg} on ${layer}`), `${theme}: ${fg} on ${layer}`);
      }
    }
    assert.ok(names.includes("--success-text on --success-tint over hover/tile"), `${theme}: a badge on a hovered tile row`);
  }
});

test("--bg-tile is the tile as one opaque color: white in light (light flip), the weak fill over the panel in dark", () => {
  const light = themeTokens(kit, app, "light");
  assert.equal(light["--bg-tile"], light["--bg-tile-fill"]);
  assert.equal(light["--bg-tile"], "#ffffff");
  const dark = themeTokens(kit, app, "dark");
  assert.equal(dark["--bg-tile"], toHex(over(parseHex(dark["--bg-tile-fill"]), parseHex(dark["--bg-white-0"])), 1));
  // Dark keeps step 1: the tile's fill is the weak fill.
  assert.equal(dark["--bg-tile-fill"], dark["--bg-weak-50"]);
});

test("light flip: soft text keeps 4.5:1 on the white tile, a control on the ground and a selected segment", () => {
  for (const theme of ["light", "dark"]) {
    const names = pairs(themeTokens(kit, app, theme)).map(([n]) => n);
    for (const layer of ["tile", "page", "on-page", "selected/on-page"]) {
      assert.ok(names.includes(`--text-soft-400 on ${layer}`), `${theme}: --text-soft-400 on ${layer}`);
    }
  }
});
