import { describe, expect, it } from 'vitest';
import { parseFlatConcept } from '../concept/flatConcept';
import { parseRoomProgram } from '../concept/roomProgram';
import { testFlatInput } from '../concept/testFlats';
import type { FlatKey } from '../fixtures/flats';
import { RECORDED } from '../fixtures/recorded';
import type { Layout, RoomAnalysis } from '../types';
import type { FixedPiece } from './room';
import { existingPieces, solveRoom } from './solve';
import { independentCheck } from './verify';

interface Case {
  key: FlatKey;
  name: string;
  run: () => { room: RoomAnalysis; layout: Layout; existing: FixedPiece[]; ms: number; programItems: number; required: string[] };
}

/** Every room of the recorded runs A–F, read by the parser of stage 2 as in the app. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const key of Object.keys(RECORDED) as FlatKey[]) {
    const f = testFlatInput(key);
    const concept = parseFlatConcept(RECORDED[key]!.concept, f).value;
    for (const [name, raw] of Object.entries(RECORDED[key]!.programs)) {
      out.push({
        key,
        name,
        run: () => {
          const room = f.analysis.rooms.find((r) => r.name === name)!;
          const existing = existingPieces(f.project, room);
          const program = parseRoomProgram(raw, { project: f.project, concept, room, sketch: '', wishes: f.wishes }).value;
          const t = performance.now();
          const layout = solveRoom(room, program, { existing, seed: 7 });
          return { room, layout, existing, ms: performance.now() - t, programItems: program.items.length, required: program.items.filter((i) => i.required).map((i) => i.id) };
        },
      });
    }
  }
  return out;
}

describe('solver on the recorded programmes of test flats A–F', () => {
  const all = cases();
  const results = new Map<string, ReturnType<Case['run']>>();
  const get = (c: Case) => {
    const k = `${c.key}/${c.name}`;
    if (!results.has(k)) results.set(k, c.run());
    return results.get(k)!;
  };

  it.each(all.map((c) => [`${c.key} ${c.name}`, c] as const))('%s: no hard rule broken, checked independently', (_, c) => {
    const { room, layout, existing } = get(c);
    expect(layout.unsolved).toEqual([]);
    expect(independentCheck(room, layout, existing)).toEqual([]);
  });

  it.each(all.map((c) => [`${c.key} ${c.name}`, c] as const))('%s: keeps the programme (required pieces placed, few left out, each with a reason)', (_, c) => {
    const { layout, programItems, required } = get(c);
    const placed = new Set(layout.items.map((i) => i.id));
    for (const id of required) expect(placed.has(id) || layout.dropped.some((d) => d.id === id && d.reason.startsWith('Pflichtmöbel'))).toBe(true);
    for (const id of required) expect(placed.has(id), `${id} fehlt`).toBe(true);
    expect(layout.dropped.length).toBeLessThanOrEqual(Math.max(2, Math.ceil(programItems * 0.15)));
    for (const d of layout.dropped) expect(d.reason.length).toBeGreaterThan(5);
  });

  it('same programme and seed give the same layout', () => {
    const c = all.find((x) => x.name === 'Wohnküche')!;
    const a = c.run().layout;
    const b = c.run().layout;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('needs well under 300 ms per room on average', () => {
    for (const c of all) get(c);
    // a second round, warmed up, as in the browser after the first room
    const times = all.map((c) => c.run().ms);
    const mean = times.reduce((s, t) => s + t, 0) / times.length;
    expect(mean).toBeLessThan(300);
    // 44 rooms take a few seconds in all
  }, 30_000);
});
