// Fails when an error toast shows a raw backend string (audit Phase G3). Run
// it with `npm run check:errors`. There is no allowance file: it holds at zero.
import { scanErrors } from "./lib/error-rules.mjs";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a URL keeps "%20" where the path has a
// space and keeps a leading slash before a drive letter, so a checkout
// under "My Project" or on Windows looked for files that are not there.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const found = scanErrors(ROOT);
for (const v of found) console.log(`${v.file}:${v.line}  ${v.rule}: ${v.message}`);
console.log(found.length ? `\n${found.length} problem(s)` : "errors OK: no raw error reaches a toast");
process.exit(found.length ? 1 : 0);
