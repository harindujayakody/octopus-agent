// One process running install() on a shared cache, the engine served slowly
// from a local zip so two of them overlap (runtime-swap.test.mjs).
import { readFileSync } from "node:fs";
import { MANIFEST_URL, PUB_BASE, Runtime, hostSpec } from "../dist/runtime.js";

const [root, zip] = process.argv.slice(2);
const key = hostSpec().browser.key;
const body = readFileSync(zip);
let downloaded = false;

globalThis.fetch = async (url) => {
  url = String(url);
  if (url === MANIFEST_URL) {
    return new Response(JSON.stringify({
      chromium_version: "157.0.0.1",
      archives: { [key]: "e157.0.0.1", "ShardX-Fingerprints.zip": "f1" },
    }));
  }
  if (url !== `${PUB_BASE}/${key}`) return new Response("no", { status: 404 });
  downloaded = true;
  const step = Math.ceil(body.length / 20);
  let at = 0;
  const stream = new ReadableStream({
    async pull(c) {
      await new Promise((r) => setTimeout(r, 15));
      if (at >= body.length) { c.close(); return; }
      c.enqueue(body.subarray(at, at + step));
      at += step;
    },
  });
  return new Response(stream, { headers: { etag: '"e157.0.0.1"', "content-length": String(body.length) } });
};
console.warn = () => {};

const rt = new Runtime({ cacheDir: root });
try {
  await rt.install();
  console.log(JSON.stringify({ ok: true, version: rt.chromiumVersion, downloaded }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message), downloaded }));
}
