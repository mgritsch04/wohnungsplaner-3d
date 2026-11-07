/**
 * Q5, metamorphic test of the walk-through: mirror and turn the furnished rooms of the benchmark
 * flats (room, openings and pieces together) – the points must stay the same (±1). A difference
 * means a rule with a hidden left/right or axis assumption, or a threshold that depends on where the
 * 5 cm grid happens to lie. The furnished rooms come from the recorded answers of the benchmark
 * (`fixtures/benchmark/`), as in `benchmark.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Sample, SampleOptions } from '../../assistant/claude';
import { FLAT_KEYS, TEST_FLATS, type FlatKey } from '../fixtures/flats';
import { asPlaced, reviewInputOf, runFurnishing } from '../run';
import { existingPieces } from '../solver/solve';
import { roomConceptOf } from '../concept/flatConcept';
import type { RoomType } from '../../suggest/furnishing';
import { reviewRoom, type ReviewInput } from './index';
import { transformInput, type Symmetry } from './symmetry';

interface BenchFixture {
  answers: { kind: 'konzept' | 'programm' | 'kritik'; room: string; value: unknown }[];
}
const FIXTURES = import.meta.glob<BenchFixture>('../fixtures/benchmark/*.json', { eager: true, import: 'default' });
const byKey = new Map(Object.entries(FIXTURES).map(([path, fx]) => [/(\w)\.json$/.exec(path)![1] as FlatKey, fx]));

const kindOf = (prompt: string) => (prompt.includes('Wohnkonzept für die ganze Wohnung') ? 'konzept' : prompt.includes('Dein bisheriges Programm') ? 'kritik' : 'programm');

function replay(fx: BenchFixture): Pick<Sample, 'json' | 'images'> {
  const queues = new Map<string, unknown[]>();
  for (const a of fx.answers) {
    const k = `${a.kind}:${a.kind === 'konzept' ? '' : a.room}`;
    queues.set(k, [...(queues.get(k) ?? []), a.value]);
  }
  return {
    images: true,
    json: async <T,>(prompt: string, _opts: SampleOptions = {}) => {
      const kind = kindOf(prompt);
      const room = kind === 'konzept' ? '' : (/Raum „([^“]+)“/.exec(prompt)?.[1] ?? '');
      const next = queues.get(`${kind}:${room}`)?.shift();
      if (next === undefined) throw { code: 'upstream_error', message: `keine Antwort für ${kind} ${room}` };
      if (next === null) throw { code: 'invalid_json', message: 'Antwort ist kein JSON.' };
      return structuredClone(next) as T;
    },
  };
}

const SYMMETRIES: [string, Symmetry][] = [
  ['gespiegelt', { mirror: true, turns: 0 }],
  ['um 90° gedreht', { mirror: false, turns: 1 }],
  ['um 180° gedreht', { mirror: false, turns: 2 }],
  ['gespiegelt und um 90° gedreht', { mirror: true, turns: 1 }],
];

// a whole flat is replayed (up to two critique rounds per room): longer than the 5 s default
describe('Q5 metamorphic: symmetric rooms get the same points', { timeout: 120_000 }, () => {
  it.each(FLAT_KEYS)('benchmark flat %s', async (key) => {
    const flat = TEST_FLATS[key];
    const project = flat.build();
    const r = await runFurnishing({
      sample: replay(byKey.get(key)!),
      project,
      roomIds: project.rooms.map((x) => x.id),
      wishes: flat.wishes,
      toImage: async () => ({ mediaType: 'image/png', data: 'AAAA' }),
      timeouts: { opus: 5000, sonnet: 5000 },
    });
    const palette = r.concept!.style.palette.map((c) => c.hex);
    const differences: string[] = [];
    for (const res of r.rooms) {
      const room = r.analysis.rooms.find((x) => x.roomId === res.roomId)!;
      const input: ReviewInput = reviewInputOf({ analysis: room, type: roomConceptOf(r.concept!, room).type as RoomType, layout: res.layout, program: res.program, palette, existing: asPlaced(existingPieces(project, room)) });
      const base = reviewRoom(input);
      for (const [name, s] of SYMMETRIES) {
        const moved = reviewRoom(transformInput(input, s));
        if (Math.abs(moved.score - base.score) > 1) {
          const rules = (f: typeof base.findings) => f.map((x) => `${x.rule}${x.severity}`).sort().join(' ');
          differences.push(`${room.name} ${name}: ${base.score} → ${moved.score} (${rules(base.findings)} | ${rules(moved.findings)})`);
        }
      }
    }
    expect(differences).toEqual([]);
  });
});
