import { spaceEpoch, withEpoch } from "../api/edition.ts";

/// A store's backend writes, sent in order once `ready` (the first read) settled.
/// A failed one is reported, and the store reads the backend again once the queue is
/// empty; so it does after a read that came back while a change still waited here.
/// Each carries the space it was made in, so one sent after a switch is refused there.
export function writeQueue(ready: Promise<unknown>, report: (e: unknown) => void, reread: () => Promise<void>) {
  let tail: Promise<void> = ready.then(() => {}, () => {});
  let waiting = 0;
  let again = false;
  /** Queues `call`; resolves once it has settled. */
  const write = (call: () => Promise<unknown>): Promise<void> => {
    waiting++;
    const asked = spaceEpoch();
    tail = tail
      .then(() => withEpoch(asked, call))
      .then(() => {}, (e) => { again = true; report(e); })
      .then(async () => {
        waiting--;
        if (waiting > 0 || !again) return;
        again = false;
        await reread().catch(() => {});
      });
    return tail;
  };
  /** The store just showed a read: the changes still waiting are not in it. */
  const shown = () => { if (waiting > 0) again = true; };
  return Object.assign(write, { shown });
}
