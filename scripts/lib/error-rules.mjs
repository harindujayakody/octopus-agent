// The error-toast rules of audit Phase G3 (WRITE-01; overview section 2: "No
// raw backend string reaches a toast as its title"). Pure, so
// scripts/check-errors.test.mjs tests them without the repository.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ERROR_RULES = [
  {
    id: "raw-error-toast",
    message: "an error toast needs a title naming the action and its subject: toast.fail({ title: t(\"...\"), detail: e, subject })",
    re: /toast\.err\(\s*(?:String\(|`[^`]*\$\{|(?:e|err|error|reason)\b|[A-Za-z_$][\w$]*\.(?:message|payload)\b)/g,
  },
  {
    id: "raw-error-in-copy",
    message: "a raw error inside a translated string: pass it as toast.fail's detail",
    re: /\bt\(\s*["'][^"']+["']\s*,\s*\{[^}]*\b(?:err|error|e)\s*:\s*(?:String\(|[A-Za-z_$][\w$]*\.message)/g,
  },
  {
    id: "toast-failure-helper",
    message: "toastFailure() is gone (Phase C Task 23): call toast.fail",
    re: /\btoastFailure\(/g,
  },
];

/** Violations in one source text, line comments skipped: [{ rule, line, message }]. */
export function errorViolations(text) {
  const src = text.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  const out = [];
  for (const r of ERROR_RULES) {
    for (const m of src.matchAll(r.re)) out.push({ rule: r.id, line: src.slice(0, m.index).split("\n").length, message: r.message });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every violation under src/, except the mock backend (src/dev): [{ file, rule, line, message }]. */
export function scanErrors(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (p !== join(root, "src/dev")) walk(p);
      } else if (/\.tsx?$/.test(name)) {
        for (const v of errorViolations(readFileSync(p, "utf8"))) out.push({ file: relative(root, p), ...v });
      }
    }
  };
  walk(join(root, "src"));
  return out;
}
