/**
 * Regression of the benchmark (#443): the whole run on the six test flats with Claude's recorded
 * answers from a real benchmark run (`fixtures/benchmark/`, written by
 * `scripts/design-bench-fixture.mjs`). The answers come back in the order Claude gave them, per
 * stage and room: room programmes, critique rounds and the look before handing over (with a
 * stand-in picture, so the run asks for them as the real one did). A change to solver, rules or
 * prompts that makes these flats worse than the acceptance of #443 fails here, without a real
 * Claude call: no severe finding, at least 85 points for the flat, no room below 75.
 */
import { describe, expect, it } from 'vitest';
import type { Sample, SampleOptions } from '../assistant/claude';
import { TEST_FLATS, type FlatKey } from './fixtures/flats';
import { runFurnishing } from './run';

interface BenchFixture {
  source: string;
  score: number;
  answers: { kind: 'konzept' | 'programm' | 'kritik'; room: string; label: string; value: unknown }[];
}

const FIXTURES = import.meta.glob<BenchFixture>('./fixtures/benchmark/*.json', { eager: true, import: 'default' });
const byKey = new Map(Object.entries(FIXTURES).map(([path, fx]) => [/(\w)\.json$/.exec(path)![1] as FlatKey, fx]));
const KEYS = [...byKey.keys()].sort();

/** Stage and room of a request, as the benchmark recorded them (the runtime gets no label). */
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

// a whole flat with up to two critique rounds per room: longer than the 5 s default on the CI machines
describe.skipIf(!KEYS.length)('benchmark with recorded answers (#443)', { timeout: 120_000 }, () => {
  it.each(KEYS)('flat %s still meets the acceptance: no severe finding, at least 85 points, no room below 75', async (key) => {
    const fx = byKey.get(key)!;
    const flat = TEST_FLATS[key];
    const project = flat.build();
    const r = await runFurnishing({
      sample: replay(fx),
      project,
      roomIds: project.rooms.map((x) => x.id),
      wishes: flat.wishes,
      toImage: async () => ({ mediaType: 'image/png', data: 'AAAA' }),
      timeouts: { opus: 5000, sonnet: 5000 },
    });
    const name = (id: string) => r.analysis.rooms.find((a) => a.roomId === id)?.name ?? id;
    const severe = r.rooms.flatMap((x) => x.review.findings.filter((f) => f.severity === 'S').map((f) => `${name(x.roomId)}: ${f.text}`));
    expect(r.failed).toEqual([]);
    expect(severe).toEqual([]);
    expect(r.review.score).toBeGreaterThanOrEqual(85);
    expect(r.rooms.filter((x) => x.review.score < 75).map((x) => `${name(x.roomId)} ${x.review.score}`)).toEqual([]);
  });
});
