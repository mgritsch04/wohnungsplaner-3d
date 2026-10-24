import { describe, expect, it } from 'vitest';
import type { Sample, SampleOptions } from '../../assistant/claude';
import { RECORDED } from '../fixtures/recorded';
import { runConcept, type ConceptRunInput } from './run';
import { testFlatInput } from './testFlats';

const B = testFlatInput('B');
const answers = RECORDED.B!;

type Reply = (prompt: string, opts: SampleOptions, n: number) => Promise<unknown> | unknown;

/** Fake Claude: answers by request label (Wohnkonzept or the room name), counts the calls. */
function fake(reply: Reply) {
  const calls: { label: string; model?: string; prompt: string }[] = [];
  const sample: Pick<Sample, 'json'> = {
    json: async <T,>(prompt: string, opts: SampleOptions = {}) => {
      calls.push({ label: opts.label ?? '', model: opts.model, prompt });
      return (await reply(prompt, opts, calls.filter((c) => c.label === opts.label).length)) as T;
    },
  };
  return { sample, calls };
}

const recorded: Reply = (_, opts) => (opts.label === 'Wohnkonzept' ? answers.concept : structuredClone(answers.programs[opts.label!]));

const run = (sample: Pick<Sample, 'json'>, extra: Partial<ConceptRunInput> = {}) =>
  runConcept({ sample, project: B.project, analysis: B.analysis, flatSketch: B.sketch, roomSketch: B.roomSketch, wishes: B.wishes, timeouts: { opus: 200, sonnet: 200 }, ...extra });

describe('runConcept', () => {
  it('asks for the concept, then every room, with the model by room', async () => {
    const { sample, calls } = fake(recorded);
    const progress: number[] = [];
    const r = await run(sample, { onProgress: (d) => progress.push(d) });
    expect(r.failed).toEqual([]);
    expect(r.concept?.rooms).toHaveLength(5);
    expect(r.programs.map((p) => p.roomId)).toEqual(B.analysis.rooms.map((x) => x.roomId));
    expect(calls[0].label).toBe('Wohnkonzept');
    expect(calls[0].model).toBe('opus');
    const model = (name: string) => r.rooms.find((x) => x.roomId === B.roomId(name))!.model;
    expect(model('Wohnküche')).toBe('opus');
    expect(model('Schlafzimmer')).toBe('opus');
    expect(model('Bad')).toBe('sonnet');
    expect(progress.at(-1)).toBe(6);
    // the bath's kitchen wall cabinet is asked to be repaired once; the same answer again stays with its problem
    const bath = r.rooms.find((x) => x.roomId === B.roomId('Bad'))!;
    expect(bath.problems).toHaveLength(1);
    expect(calls.filter((c) => c.label === 'Bad')).toHaveLength(2);
    expect(calls.find((c) => c.label === 'Bad' && c.prompt.includes('Die Prüfung der App'))?.prompt).toContain('generic-k-wall-60');
  });

  it('takes the repaired answer when it is better', async () => {
    const { sample, calls } = fake((p, opts, n) => {
      if (opts.label === 'Bad' && n === 2) {
        const fixed = structuredClone(answers.programs.Bad);
        fixed.items = fixed.items.filter((it) => it.id !== 'wallcab');
        fixed.relations = fixed.relations.filter((rel) => rel[0] !== 'wallcab');
        return fixed;
      }
      return recorded(p, opts, n);
    });
    const r = await run(sample);
    const bath = r.rooms.find((x) => x.roomId === B.roomId('Bad'))!;
    expect(bath.repaired).toBe(true);
    expect(bath.problems).toEqual([]);
    expect(r.calls.filter((c) => c.label === 'Bad').map((c) => c.round)).toEqual([1, 2]);
    // concept, five rooms, the bath repaired, and the balcony twice: the trial has no answer for it
    expect(calls).toHaveLength(8);
  });

  it('asks again after a timeout and reports a room that never answers', async () => {
    const { sample, calls } = fake((p, opts, n) => {
      if (opts.label === 'Schlafzimmer') return new Promise(() => {});
      if (opts.label === 'Vorraum' && n === 1) return new Promise(() => {});
      return recorded(p, opts, n);
    });
    const r = await run(sample);
    expect(calls.filter((c) => c.label === 'Schlafzimmer')).toHaveLength(2);
    expect(r.failed).toEqual([{ roomId: B.roomId('Schlafzimmer'), reason: expect.stringContaining('timeout') }]);
    // the hall answered on the second try
    expect(r.programs.some((p) => p.roomId === B.roomId('Vorraum'))).toBe(true);
    expect(r.programs).toHaveLength(4);
  });

  it('does not ask again after a usage limit, and keeps the other rooms', async () => {
    const { sample, calls } = fake((p, opts, n) => {
      if (opts.label === 'Wohnküche') throw { code: 'rate_limited', message: 'Limit' };
      return recorded(p, opts, n);
    });
    const r = await run(sample);
    expect(calls.filter((c) => c.label === 'Wohnküche')).toHaveLength(1);
    expect(r.failed).toEqual([{ roomId: B.roomId('Wohnküche'), reason: 'rate_limited: Limit' }]);
    expect(r.programs).toHaveLength(4);
  });

  it('stops without rooms when the concept fails, and on cancel throws', async () => {
    const broken = await run(fake(() => Promise.reject({ code: 'invalid_json' })).sample);
    expect(broken.concept).toBeNull();
    expect(broken.failed).toEqual([{ roomId: null, reason: 'invalid_json' }]);
    expect(broken.programs).toEqual([]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run(fake(recorded).sample, { signal: ctrl.signal })).rejects.toEqual({ code: 'cancelled' });
  });

  it('asks Sonnet everywhere when fast', async () => {
    const { sample, calls } = fake(recorded);
    await run(sample, { wishes: { ...B.wishes, quality: 'fast' } });
    expect(new Set(calls.map((c) => c.model))).toEqual(new Set(['sonnet']));
  });
});
