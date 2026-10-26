/// One queue that lets at most `most` tasks run at once, however many
/// callers share it: a task waits for a free slot, runs, and hands its slot
/// straight to the next one waiting, in the order they came.
export function limiter(most: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running < most) running++;
    else await new Promise<void>((go) => waiting.push(go));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
