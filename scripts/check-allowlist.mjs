// Fails when eslint.allowlist.json still lists a file that no longer breaks
// the rule it is listed for, so the allowlists only ever shrink.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a URL keeps "%20" where the path has a
// space and keeps a leading slash before a drive letter, so a checkout
// under "My Project" or on Windows looked for files that are not there.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const allow = JSON.parse(readFileSync(new URL("../eslint.allowlist.json", import.meta.url), "utf8"));
const RULES = { rawControls: /^Raw </, nativeTitle: /^Native title= / };

// Lint the listed files with the base rules only (the ignores and the main
// block), i.e. as if no allowlist existed.
const base = (await import("../eslint.config.js")).default.slice(0, 2);
const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: base });
const listed = [...new Set([...allow.rawControls, ...allow.nativeTitle])];
const files = listed.filter((f) => existsSync(join(ROOT, f)));
const results = files.length > 0 ? await eslint.lintFiles(files) : [];

const stale = listed.filter((f) => !files.includes(f)).map((f) => `deleted: ${f}`);
for (const [list, pattern] of Object.entries(RULES)) {
  for (const file of allow[list]) {
    if (!files.includes(file)) continue;
    const result = results.find((r) => r.filePath.endsWith(file));
    if (!result?.messages.some((m) => pattern.test(m.message))) stale.push(`${list}: ${file}`);
  }
}
if (stale.length > 0) {
  console.log(`Remove from eslint.allowlist.json (already clean):\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
console.log(`allowlist OK — ${allow.rawControls.length} raw-control and ${allow.nativeTitle.length} title= files left`);
