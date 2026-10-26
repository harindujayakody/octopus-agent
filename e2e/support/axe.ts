import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/// Runs axe-core in the page (optionally on one element, optionally only some
/// rules) and returns each violated rule with how many nodes break it.
export async function axeViolations(page: Page, { include, rules }: { include?: string; rules?: string[] } = {}) {
  await page.addScriptTag({ content: source });
  return page.evaluate(async ({ include, rules }) => {
    type Axe = { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> };
    const axe = (window as unknown as { axe: Axe }).axe;
    const result = await axe.run(include ? { include: [[include]] } : document, rules ? { runOnly: { type: "rule", values: rules } } : {});
    return result.violations.map((v) => ({ id: v.id, count: v.nodes.length }));
  }, { include, rules });
}
