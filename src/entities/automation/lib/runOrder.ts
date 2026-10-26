import type { Block, Project } from "../model/types";
import { flowOrder } from "./layout";

/** The steps in the order a run takes them: from the start step, following
 *  "next" (and a jump's target) until a branch ends the pass. A step no
 *  branch reaches is left out, and a loop is cut where it comes back. A
 *  project the walk finds nothing in lists its steps in flow order.
 *
 *  "next" is the card below on the canvas, as the runner reads it: by column
 *  and then height (runner.rs `run_worker`), never the order the steps happen
 *  to sit in the list. A step that is off stays in the chain (the card dims
 *  it), but the runner skips it, so its own branches are never taken. */
export function runOrder(p: Pick<Project, "blocks" | "run">): Block[] {
  const blocks = flowOrder(p.blocks);
  if (blocks.length === 0) return [];
  const byId = new Map(blocks.map((b, i) => [b.id, i]));
  let at = byId.get(p.run.start) ?? 0;
  const seen = new Set<number>();
  const out: Block[] = [];
  while (at >= 0 && at < blocks.length && !seen.has(at)) {
    seen.add(at);
    const b = blocks[at];
    out.push(b);
    if (!b.enabled) {
      at += 1;
      continue;
    }
    const done = b.on_done;
    if (done === "stop" || done === "endpass") break;
    if (typeof done === "object" && "goto" in done) at = byId.get(done.goto) ?? -1;
    else at += 1;
  }
  return out.length > 0 ? out : blocks;
}
