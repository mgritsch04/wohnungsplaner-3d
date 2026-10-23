import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { budgetShares, runDesign } from './designRun';
import { EMPTY_WISHES, PLACEHOLDERS } from './design';

const FAST = { ...EMPTY_WISHES, quality: 'fast' as const };

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
  const options: ({ model?: string } | undefined)[] = [];
  const sofa = PLACEHOLDERS.find((c) => c.category === 'sofa')!;
  return {
    prompts,
    options,
    json: async <T,>(prompt: string, o?: { model?: string }): Promise<T> => {
      prompts.push(prompt);
      options.push(o);
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
    const { proposal, failedRooms } = await runDesign({ sample: f, project: p, roomIds: ids(p), roomTypes: {}, wishes: { ...EMPTY_WISHES, budget: 3000, style: 'Landhaus', quality: 'fast' }, products: [], onProgress: (d) => progress.push(d) });
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
    await runDesign({ sample: fake(60), project: p, roomIds: ids(p), roomTypes: {}, wishes: FAST, products: [] });
    expect(Date.now() - t).toBeLessThan(150);
  });

  it('keeps the other rooms when one room gives no usable answer', async () => {
    const p = project();
    const { proposal, failedRooms } = await runDesign({ sample: fake(1, { failFor: 'Büro' }), project: p, roomIds: ids(p), roomTypes: {}, wishes: FAST, products: [] });
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
    await runDesign({ sample: f, project: p, roomIds: [ids(p)[0]], roomTypes: {}, wishes: FAST, products: [] });
    expect(f.prompts).toHaveLength(1);
  });

  it('„gründlich“ (#350): second round per room with the placement report, Opus for the local helper', async () => {
    const p = project();
    const f = fake(1);
    const progress: [number, number][] = [];
    const { proposal } = await runDesign({ sample: f, project: p, roomIds: ids(p), roomTypes: {}, wishes: EMPTY_WISHES, products: [], onProgress: (d, t) => progress.push([d, t]) });
    expect(f.prompts).toHaveLength(6);
    const second = f.prompts.filter((q) => q.includes('Zweite Runde'));
    expect(second).toHaveLength(3);
    expect(second[0]).toContain('Aufgestellt:');
    expect(second[0]).toContain('Dein erster Vorschlag');
    expect(f.options.every((o) => o?.model === 'opus')).toBe(true);
    expect(proposal.rooms.every((r) => r.reviewed)).toBe(true);
    expect(progress.at(-1)).toEqual([6, 6]);
  });

  it('planner check: essentials of the room type are added, misfits left out (#350)', async () => {
    const p = project();
    const f = fake(1);
    const { proposal } = await runDesign({ sample: f, project: p, roomIds: [ids(p)[1]], roomTypes: { [ids(p)[1]]: 'bedroom' }, wishes: FAST, products: [] });
    const room = proposal.rooms[0];
    // the fake answers with a sofa only: bed, nightstands, wardrobe and a picture are added
    expect(room.picks.map((x) => x.catalogId)).toEqual(expect.arrayContaining(['generic-bed-160', 'generic-nightstand', 'generic-wardrobe-150', 'generic-picture']));
    expect(room.fixes?.filter((x) => x.kind === 'added').length).toBeGreaterThanOrEqual(4);
  });

  it('a rerun ignores furniture of the earlier proposal and passes on the feedback', async () => {
    const p = project();
    p.furniture.push({ ...structuredClone(PLACEHOLDERS[0]), id: 'old', x: 1, y: 1, rotation: 0, elevation: 0, quantity: 1, locked: false, existing: false, solid: true, approximate: true, color: '#777777', suggested: true } as never);
    const f = fake(1);
    await runDesign({ sample: f, project: p, roomIds: [ids(p)[0]], roomTypes: {}, wishes: FAST, products: [], feedback: 'zu voll, lieber luftig' });
    expect(f.prompts[0]).not.toContain(PLACEHOLDERS[0].name + ' (');
    expect(f.prompts[0]).toContain('zu voll, lieber luftig');
  });
});
