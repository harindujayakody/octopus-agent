// Generates the role colors of tokens.css (and the launcher's label palette)
// from colors.source.mjs. `--check` (the default) fails when a stylesheet
// value differs from its source; `--write` rewrites the values in place.
// `node ui-kit/scripts/gen-colors.mjs --check` (npm run check:colors).
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oklchToHex, over, parseHex, toHex } from "./color-math.mjs";
import { declarations, setDeclaration } from "./css-tokens.mjs";
import { SOURCES } from "./colors.source.mjs";

/** Where each stylesheet lives, from this script. "app" exists only inside the launcher repo. */
export const FILES = {
  kit: fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
  app: fileURLToPath(new URL("../../src/app/styles/index.css", import.meta.url)),
};

/** The value a source entry stands for: a hex, or `var(--token)` for a role that points at another. */
export function hexOf(src) {
  if (src.oklch) return oklchToHex(...src.oklch);
  if (src.ref) return `var(${src.ref})`;
  // An overlay laid over an opaque color, from their hex values (what the browser composites).
  if (src.over) {
    const [top, base] = src.over.map((s) => parseHex(hexOf(s)));
    return toHex(over(top, base));
  }
  return toHex(parseHex(src.hex), src.pct / 100);
}

/** The @theme block is a Tailwind at-rule, not a selector: read it with a plain scan. */
function themeDecls(css) {
  const m = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  const out = {};
  if (m) for (const d of m[1].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

/** [{ file, sel, media, token, want, have }] for every value that differs from its source. `read(file)` returns null for a missing file. */
export function diffs(read) {
  const out = [];
  for (const [file, sel, media, tokens] of SOURCES) {
    const css = read(file);
    if (css === null) continue;
    const have = sel === "@theme" ? themeDecls(css) : declarations(css, sel, media);
    for (const [token, src] of Object.entries(tokens)) {
      const want = hexOf(src);
      if ((have[token] ?? "").toLowerCase() !== want) out.push({ file, sel, media, token, want, have: have[token] });
    }
  }
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const write = process.argv.includes("--write");
  const text = new Map();
  const read = (f) => {
    if (!text.has(f)) text.set(f, existsSync(FILES[f]) ? readFileSync(FILES[f], "utf8") : null);
    return text.get(f);
  };
  const found = diffs(read);
  if (write) {
    for (const d of found) {
      const css = read(d.file);
      text.set(d.file, d.sel === "@theme"
        ? css.replace(new RegExp(`(\\n\\s*${d.token}\\s*:\\s*)[^;]+;`), `$1${d.want};`)
        : setDeclaration(css, d.sel, d.media, d.token, d.want));
    }
    for (const [f, css] of text) if (css !== null) writeFileSync(FILES[f], css);
    console.log(`wrote ${found.length} value(s)`);
  } else {
    for (const d of found) console.log(`${d.file} ${d.sel}${d.media ? ` @media (${d.media})` : ""} ${d.token}: has ${d.have ?? "nothing"}, colors.source.mjs says ${d.want}`);
    if (found.length > 0) process.exit(1);
    console.log("colors OK: every role color matches colors.source.mjs");
  }
}
