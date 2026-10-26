import { test } from "node:test";
import assert from "node:assert/strict";
import { errorViolations } from "./lib/error-rules.mjs";

const ids = (s) => errorViolations(s).map((v) => v.rule);

test("raw error toasts are caught; translated ones pass", () => {
  assert.deepEqual(ids("catch (e) { toast.err(String(e)); }"), ["raw-error-toast"]);
  assert.deepEqual(ids(".catch((err) => toast.err(String(err)))"), ["raw-error-toast"]);
  assert.deepEqual(ids("toast.err(`Failed: ${e}`)"), ["raw-error-toast"]);
  assert.deepEqual(ids("listen(\"x\", (e) => toast.err(e.payload))"), ["raw-error-toast"]);
  assert.deepEqual(ids("toast.err(e)"), ["raw-error-toast"]);
  assert.deepEqual(ids("toast.err(t(\"psImportModal.signatureError\", { err: String(e) }))"), ["raw-error-in-copy"]);
  assert.deepEqual(ids("toastFailure(t(\"x\"), e)"), ["toast-failure-helper"]);
  assert.deepEqual(ids("toast.err(t(\"proxyBulkImporter.nothingToParse\"))"), []);
  assert.deepEqual(ids("toast.err(expired ? a : b)"), []);
  assert.deepEqual(ids("toast.fail({ title: t(\"useTrash.restoreFailed\", { name }), detail: e, subject: name })"), []);
  assert.deepEqual(ids("// toast.err(String(e)) was here"), []);
});
