export type EachResult = { done: string[]; failed: string[]; firstError: string };

/// Runs `step` for every id in turn, carrying on past failures (LQ-02). The
/// caller words the outcome: a title naming the action and how many failed,
/// with `firstError` as the detail (G3; the old generic "n of total failed"
/// toast is gone).
export async function eachReporting(
  ids: string[],
  step: (id: string, index: number) => Promise<unknown>,
): Promise<EachResult> {
  const done: string[] = [];
  const failed: string[] = [];
  let firstError = "";
  for (const [k, id] of ids.entries()) {
    try {
      await step(id, k);
      done.push(id);
    } catch (e) {
      failed.push(id);
      firstError ||= String(e);
    }
  }
  return { done, failed, firstError };
}
