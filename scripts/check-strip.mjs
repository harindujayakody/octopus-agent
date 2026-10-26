// Builds what a release ships (no mock) into a temporary folder and fails if
// a dev-only aid made it in (overview A3). Run it with `npm run check:strip`. The kit must be built
// (`npm run kit:build`), as for any app build.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a URL keeps "%20" where the path has a
// space and keeps a leading slash before a drive letter, so a checkout
// under "My Project" or on Windows looked for files that are not there.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MARKERS = ["__shardxMock", "shardx-mock-state", "__shardxToast", "__shardxAnalytics", "src/dev"];

if (!existsSync(join(ROOT, "ui-kit/dist/index.js"))) {
  console.log("The kit is not built: run `npm run kit:build` first.");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "shardx-strip-"));
const problems = [];
let files = [];
try {
  execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_MOCK: "" },
  });
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  })(out);
  for (const file of files) {
    const rel = relative(out, file);
    if (!/\.(js|html|css)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of MARKERS) if (text.includes(m)) problems.push(`${rel}: contains "${m}"`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.log(`${problems.join("\n")}\n\n${problems.length} dev-only item(s) in the release build`);
  process.exitCode = 1;
} else {
  console.log(`strip OK: ${files.length} files in the release build, none dev-only`);
}
