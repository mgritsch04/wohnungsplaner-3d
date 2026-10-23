import { describe, expect, it } from 'vitest';
import { runPool } from './pool';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runPool', () => {
  it('runs at most `limit` at once and finishes everything', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(5);
      seen.push(n);
      running--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is faster in parallel than one after the other (simulated 40 ms requests)', async () => {
    const items = Array.from({ length: 9 }, (_, i) => i);
    const time = async (limit: number) => {
      const t = Date.now();
      await runPool(items, limit, async () => void (await sleep(40)));
      return Date.now() - t;
    };
    const serial = await time(1);
    const parallel = await time(3);
    expect(serial).toBeGreaterThanOrEqual(340);
    expect(parallel).toBeLessThan(serial / 2);
  });

  it('stops taking items when asked to', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 1, async (n) => void seen.push(n), () => seen.length >= 2);
    expect(seen).toEqual([1, 2]);
  });

  it('passes on the first error and takes no further items', async () => {
    const seen: number[] = [];
    await expect(
      runPool([1, 2, 3, 4], 1, async (n) => {
        seen.push(n);
        if (n === 2) throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(seen).toEqual([1, 2]);
  });
});
