/**
 * Runs `fn` for every item with at most `limit` running at the same time (items are taken in
 * order). Stops taking new items once `stop()` is true or an `fn` call has thrown; the first
 * error is passed on.
 */
export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>, stop: () => boolean = () => false): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && !stop() && next < items.length) {
      const i = next++;
      try {
        await fn(items[i], i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
