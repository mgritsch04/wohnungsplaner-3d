import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { budgetShares, runDesign } from './designRun';
import { EMPTY_WISHES, PLACEHOLDERS } from './design';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function project() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 5, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 5, y: 0, width: 3, depth: 4, name: 'Schlafzimmer', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 0, y: 4, width: 3, depth: 3, name: 'Büro', thickness: 0.12, height: 2.6 });
  return p;
}

/** Fake Claude: answers for the room named in the prompt after a delay; records the prompts. */
function fake(delay: number, opts: { failFor?: string } = {}) {
  const prompts: string[] = [];
  const sofa = PLACEHOLDERS.find((c) => c.category === 'sofa')!;
  return {
    prompts,
    json: async <T,>(prompt: string): Promise<T> => {
      prompts.push(prompt);
      await sleep(delay);
      const key = /^- (R\d) /m.exec(prompt)?.[1] ?? 'R1';
      if (opts.failFor && prompt.includes(`„${opts.failFor}“`)) throw { code: 'invalid_json' };
      return { summary: 'x', rooms: [{ room: key, type: 'living', concept: `Konzept ${key}`, items: [{ catalogId: sofa.id, quantity: 1, reason: 'weil', label: 'Sofa', search: 'sofa' }] }] } as T;
    },
  };
}

describe('budgetShares', () => {
  it('splits by area and keeps "no budget"', () => {
    expect(budgetShares([20, 10, 10], 4000)).toEqual([2000, 1000, 1000]);
    expect(budgetShares([20, 10], 0)).toEqual([0, 0]);
  });
});

describe('runDesign', () => {
  const ids = (p: ReturnType<typeof project>) => p.rooms.map((r) => r.id);

  it('asks room by room, keeps order, style and a budget share per request', async () => {
    const p = project();
    const f = fake(10);
    const progress: number[] = [];
    const { proposal, failedRooms } = await runDesign({ sample: f, project: p, roomIds: ids(p), roomTypes: {}, wishes: { ...EMPTY_WISHES, budget: 3000, style: 'Landhaus' }, products: [], onProgress: (d) => progress.push(d) });
    expect(f.prompts).toHaveLength(3);
    expect(f.prompts.every((q) => q.includes('Landhaus') && q.includes('Gesamtbudget von 3000 €'))).toBe(true);
    expect(proposal.rooms.map((r) => r.roomId)).toEqual(ids(p));
    expect(proposal.summary).toContain('Landhaus');
    expect(failedRooms).toEqual([]);
    expect(progress.at(-1)).toBe(3);
  });

  it('is faster than three requests one after the other (simulated 60 ms per request)', async () => {
    const p = project();
    const t = Date.now();
    await runDesign({ sample: fake(60), project: p, roomIds: ids(p), roomTypes: {}, wishes: EMPTY_WISHES, products: [] });
    expect(Date.now() - t).toBeLessThan(150);
  });

  it('keeps the other rooms when one room gives no usable answer', async () => {
    const p = project();
    const { proposal, failedRooms } = await runDesign({ sample: fake(1, { failFor: 'Büro' }), project: p, roomIds: ids(p), roomTypes: {}, wishes: EMPTY_WISHES, products: [] });
    expect(proposal.rooms).toHaveLength(2);
    expect(failedRooms).toEqual([ids(p)[2]]);
  });

  it('passes on fatal errors such as a used-up quota', async () => {
    const p = project();
    const sample = { json: async <T,>(): Promise<T> => Promise.reject({ code: 'rate_limited' }) };
    await expect(runDesign({ sample, project: p, roomIds: ids(p), roomTypes: {}, wishes: EMPTY_WISHES, products: [] })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('uses one request for a single room', async () => {
    const p = project();
    const f = fake(1);
    await runDesign({ sample: f, project: p, roomIds: [ids(p)[0]], roomTypes: {}, wishes: EMPTY_WISHES, products: [] });
    expect(f.prompts).toHaveLength(1);
  });
});
