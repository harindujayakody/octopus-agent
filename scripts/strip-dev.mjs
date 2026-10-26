// Removes the development scaffolding in one command (owner requirement,
// overview A3, owner decision O12). Never touches src-tauri/.
// The frozen old UI and the old/new switch are gone (owner, 2026-10-02).
//
//   npm run strip:dev                  the mock backend and its hooks (src/dev/),
//                                      their npm scripts and output folders;
//                                      e2e/ stays as documentation (it cannot
//                                      run until a backend-backed runner exists)
//   npm run strip:dev -- --all         also e2e/, playwright.config.ts and
//                                      the @playwright/test dev dependency
//   add --dry-run to any of them       list what would go and change nothing
//
// Afterwards: `npm install` when a dependency went, then
// `npm run build && npm run check:strip`.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a URL keeps "%20" where the path has a
// space and keeps a leading slash before a drive letter, so a checkout
// under "My Project" or on Windows looked for files that are not there.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KNOWN = new Set(["--dry-run", "--all"]);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !KNOWN.has(a));
if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown.join(" ")}. Use --dry-run or --all.`);
  process.exit(2);
}
const dry = args.includes("--dry-run");
const all = args.includes("--all");

const paths = ["src/dev", "dist-mock", "test-results", "playwright-report", "blob-report"];
const scripts = ["dev:mock", "preview:mock"];
const devDeps = [];
if (all) {
  paths.push("e2e", "playwright.config.ts");
  scripts.push("test:e2e");
  devDeps.push("@playwright/test");
}

const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const goPaths = paths.filter((p) => existsSync(join(ROOT, p)));
const goScripts = scripts.filter((s) => pkg.scripts?.[s] !== undefined);
const goDeps = devDeps.filter((d) => pkg.devDependencies?.[d] !== undefined);

console.log(dry ? "Would remove:" : "Removing:");
for (const p of goPaths) console.log(`  ${p}`);
for (const s of goScripts) console.log(`  package.json scripts.${s}`);
for (const d of goDeps) console.log(`  package.json devDependencies.${d}`);
if (goPaths.length + goScripts.length + goDeps.length === 0) console.log("  nothing: already stripped");
if (dry) process.exit(0);

for (const p of goPaths) rmSync(join(ROOT, p), { recursive: true, force: true });
for (const s of goScripts) delete pkg.scripts[s];
for (const d of goDeps) delete pkg.devDependencies[d];
if (goScripts.length + goDeps.length > 0) writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
if (goDeps.length > 0) console.log("\nRun `npm install` to update package-lock.json and node_modules.");
console.log("\nThen: npm run build && npm run check:strip");
