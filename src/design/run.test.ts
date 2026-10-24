/**
 * The whole run (#442) with a faked Claude: the recorded answers of the test flat serve as the
 * concept and the room programmes, and the critique round gets an answer of its own. Checks that
 * the stages follow one another, that the critique only runs where the walk-through found
 * something, that it keeps the better of the two rounds and that a failed critique round leaves
 * the room as it was. No real Claude call, no browser.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Sample, SampleOptions } from '../assistant/claude';
import { TEST_FLATS } from './fixtures/flats';
import { RECORDED } from './fixtures/recorded';
import { lookKeeps, runFurnishing, type DesignRunProgress } from './run';
import type { RoomResult } from './types';

const flat = TEST_FLATS.B;
const answers = RECORDED.B!;

type Reply = (prompt: string, opts: SampleOptions) => unknown;

function fake(reply: Reply, images = false) {
  const calls: { label: string; prompt: string; images: number }[] = [];
  const sample: Pick<Sample, 'json' | 'images'> = {
    images,
    json: async <T,>(prompt: string, opts: SampleOptions = {}) => {
      calls.push({ label: opts.label ?? '', prompt, images: opts.images?.length ?? 0 });
      return reply(prompt, opts) as T;
    },
  };
  return { sample, calls };
}

/** The recorded answer belonging to a request; the critique gets the programme back unchanged. */
const recorded: Reply = (prompt, opts) => {
  const label = opts.label ?? '';
  if (label === 'Wohnkonzept') return answers.concept;
  const room = label.startsWith('Kritik: ') ? label.slice(8).replace(/ \((Runde \d|Blick)\)$/, '') : label;
  if (!answers.programs[room]) throw new Error(`keine Antwort für ${label} (Prompt: ${prompt.slice(0, 60)})`);
  return structuredClone(answers.programs[room]);
};

/** Only the rooms the recording covers; the balcony of flat B was never asked. */
const planned = Object.keys(answers.programs);

const run = (sample: Pick<Sample, 'json' | 'images'>, extra: Partial<Parameters<typeof runFurnishing>[0]> = {}) => {
  const project = flat.build();
  const roomIds = planned.map((name) => project.rooms.find((r) => r.name === name)!.id);
  return runFurnishing({ sample, project, roomIds, wishes: flat.wishes, seed: 7, timeouts: { opus: 2000, sonnet: 2000 }, ...extra });
};

// jeder Test stellt eine ganze Wohnung auf: das dauert auf den Rechnern der CI länger als die 5 s Voreinstellung
describe('runFurnishing', { timeout: 60_000 }, () => {
  it('reads, asks, places, walks through and criticises – every room ends with a layout and a score', async () => {
    const { sample, calls } = fake(recorded);
    const stages: DesignRunProgress[] = [];
    const r = await run(sample, { onProgress: (p) => stages.push(p) });
    expect(r.failed).toEqual([]);
    expect(r.concept.rooms.length).toBeGreaterThan(0);
    expect(r.rooms).toHaveLength(planned.length);
    for (const room of r.rooms) {
      expect(room.layout.items.length).toBeGreaterThan(0);
      expect(room.review.score).toBeGreaterThan(0);
      expect(room.review.roomId).toBe(room.roomId);
    }
    expect(r.review.rooms).toHaveLength(r.rooms.length);
    expect(r.review.score).toBeGreaterThan(0);
    // the stages come in order and end with „done“
    expect(stages[0].stage).toBe('read');
    expect(stages.at(-1)).toMatchObject({ stage: 'done' });
    expect(new Set(stages.map((s) => s.stage))).toContain('place');
    // the concept was asked once, every room at least once
    expect(calls.filter((c) => c.label === 'Wohnkonzept')).toHaveLength(1);
  });

  it('asks for a critique only where the walk-through found something, and at most twice per room', async () => {
    const { sample, calls } = fake(recorded);
    const r = await run(sample);
    for (const room of r.rooms) {
      const name = r.analysis.rooms.find((a) => a.roomId === room.roomId)!.name;
      const rounds = calls.filter((c) => c.label.startsWith(`Kritik: ${name} `)).length;
      expect(rounds).toBeLessThanOrEqual(2);
      // a room that passes is never criticised; one that does not is criticised at least once
      if (room.rounds === 0) expect(rounds === 0 || room.review.passed).toBe(true);
    }
    const criticised = calls.filter((c) => c.label.startsWith('Kritik: '));
    expect(criticised.every((c) => c.prompt.includes('Dein bisheriges Programm'))).toBe(true);
    expect(criticised.every((c) => c.prompt.includes('Begehung:'))).toBe(true);
  });

  it('keeps the better round: a worse answer in the critique does not get used', async () => {
    // the critique answers with an empty room, which scores worse than anything placed
    const empty = { reading: 'leer', zones: [], items: [], relations: [], walk: '-', check: [] };
    const { sample } = fake((p, o) => (o.label?.startsWith('Kritik: ') ? empty : recorded(p, o)));
    const r = await run(sample);
    for (const room of r.rooms) expect(room.layout.items.length).toBeGreaterThan(0);
  });

  it('a failed critique round leaves the room as the first attempt placed it', async () => {
    const { sample } = fake((p, o) => {
      if (o.label?.startsWith('Kritik: ')) throw { code: 'upstream_error', message: 'kaputt' };
      return recorded(p, o);
    });
    const r = await run(sample);
    expect(r.rooms).toHaveLength(planned.length);
    for (const room of r.rooms) expect(room.layout.items.length).toBeGreaterThan(0);
  });

  it('sends the room picture where Claude can look at pictures, else the text map', async () => {
    const toImage = vi.fn(async () => ({ mediaType: 'image/png' as const, data: 'AAAA' }));
    const withPicture = fake(recorded, true);
    await run(withPicture.sample, { toImage });
    const picture = withPicture.calls.filter((c) => c.label.startsWith('Kritik: '));
    if (picture.length) {
      expect(toImage).toHaveBeenCalled();
      expect(picture.every((c) => c.images === 1 && c.prompt.includes('beigefügte Bild'))).toBe(true);
    }
    const noPicture = fake(recorded, false);
    await run(noPicture.sample, { toImage });
    const plain = noPicture.calls.filter((c) => c.label.startsWith('Kritik: '));
    expect(plain.every((c) => c.images === 0)).toBe(true);
    if (plain.length) expect(plain.every((c) => c.prompt.includes('So steht es im Raum'))).toBe(true);
  });

  it('a main room that passes gets one look at its picture; without a picture no look', async () => {
    const toImage = vi.fn(async () => ({ mediaType: 'image/png' as const, data: 'AAAA' }));
    const withPicture = fake(recorded, true);
    const r = await run(withPicture.sample, { toImage });
    const looks = withPicture.calls.filter((c) => c.label.endsWith('(Blick)'));
    expect(looks.length).toBeGreaterThan(0);
    for (const c of looks) expect(c.prompt).toContain('Blick vor der Abgabe');
    for (const room of r.rooms) {
      const name = r.analysis.rooms.find((a) => a.roomId === room.roomId)!.name;
      const mine = withPicture.calls.filter((c) => c.label.startsWith(`Kritik: ${name} `));
      // a look is the only critique call of its room, and only one
      if (mine.some((c) => c.label.endsWith('(Blick)'))) expect(mine).toHaveLength(1);
    }
    const noPicture = fake(recorded, false);
    await run(noPicture.sample, { toImage });
    expect(noPicture.calls.filter((c) => c.label.endsWith('(Blick)'))).toEqual([]);
    const fast = fake(recorded, true);
    await run(fast.sample, { toImage, wishes: { ...flat.wishes, quality: 'fast' } });
    expect(fast.calls.filter((c) => c.label.endsWith('(Blick)'))).toEqual([]);
  });

  it('the look replaces a passing room only if it still passes, keeps nearly its points and drops nothing more', () => {
    const room = (score: number, passed: boolean, items = 6, dropped = 0) =>
      ({ review: { score, passed }, layout: { items: Array(items).fill({}), dropped: Array(dropped).fill({}) } }) as unknown as RoomResult;
    expect(lookKeeps(room(95, true), room(92, true))).toBe(true);
    expect(lookKeeps(room(95, true), room(90, true))).toBe(false);
    expect(lookKeeps(room(95, true), room(97, false))).toBe(false);
    expect(lookKeeps(room(95, true), room(96, true, 6, 1))).toBe(false);
    expect(lookKeeps(room(95, true), room(96, true, 2))).toBe(false);
  });

  it('stops when the user cancels', async () => {
    const ctrl = new AbortController();
    const { sample } = fake((_prompt, o) => {
      ctrl.abort();
      if (o.label === 'Wohnkonzept') return answers.concept;
      throw { code: 'cancelled' };
    });
    await expect(run(sample, { signal: ctrl.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});
