/**
 * The proposal of the old flow („heute“, 23.10.2026, Opus) for the invented test flats A and B:
 * the walk-through must find the known defects (docs/EINRICHTUNG_NEU.md › Mängelliste). The
 * pieces are the furniture the old flow placed, recorded once in fixtures/heute.json.
 */
import { describe, expect, it } from 'vitest';
import { derivePlan } from '../../model/derived';
import { pointInPolygon } from '../../model/vec';
import type { RoomType } from '../../suggest/furnishing';
import { analyzeFlat } from '../analysis';
import { TEST_FLATS } from '../fixtures/flats';
import type { PlacedItem, Review } from '../types';
import heute from './fixtures/heute.json';
import { reviewFlat, type ReviewInput } from './index';

type Recorded = { type: string; items: Omit<PlacedItem, 'id' | 'zone'>[] };

function inputs(key: 'A' | 'B'): ReviewInput[] {
  const project = TEST_FLATS[key].build();
  const analysis = analyzeFlat(project, derivePlan(project));
  const recorded = (heute as unknown as Record<string, Record<string, Recorded>>)[key];
  return analysis.rooms.map((room) => {
    const rec = recorded[room.name];
    const items: PlacedItem[] = rec.items.map((i, n) => ({ ...i, id: `${room.roomId}-${n}`, zone: 'heute' }));
    const existing: PlacedItem[] = project.furniture
      .filter((f) => f.existing && pointInPolygon(f, room.polygon))
      .map((f) => ({ id: f.id, catalogId: f.catalogId ?? '', zone: 'bestand', x: f.x, y: f.y, rotation: f.rotation, elevation: f.elevation, width: f.width, depth: f.depth, height: f.height }));
    return { analysis: room, type: rec.type as RoomType, layout: { roomId: room.roomId, items, dropped: [], cost: 0, unsolved: [], seed: 0 }, existing };
  });
}

const rules = (review: Review, room: string, flat: ReviewInput[]) => {
  const id = flat.find((i) => i.analysis.name === room)!.analysis.roomId;
  return review.rooms.find((r) => r.roomId === id)!.findings;
};

describe('Heutiger Vorschlag, Testwohnung A', () => {
  const flat = inputs('A');
  const review = reviewFlat(flat);
  const f = (room: string, rule: string) => rules(review, room, flat).filter((x) => x.rule === rule);
  it('finds the dishwasher and the sink cabinet in the door swing of the kitchen', () => {
    expect(f('Küche', 'B4').filter((x) => x.severity === 'S').length).toBe(2);
  });
  it('finds the dining table in the working aisle and the narrow kitchen run', () => {
    expect(f('Küche', 'C4').length).toBeGreaterThan(0);
    expect(f('Küche', 'B6').length).toBeGreaterThan(0);
  });
  it('finds the new WC the old flow planned in the bath and the missing hand basin in the WC', () => {
    expect(f('Bad', 'A3').some((x) => x.severity === 'S')).toBe(true);
    expect(f('WC', 'A1').some((x) => /Handwaschbecken/.test(x.text))).toBe(true);
  });
  it('finds armchair and chair squeezed together in the living room, and the dining table twice in the flat', () => {
    expect(f('Wohnzimmer', 'C9').length).toBeGreaterThan(0);
    expect(review.flat.some((x) => x.rule === 'A2' && /Esstisch/.test(x.text))).toBe(true);
  });
  it('finds small plants on the floor and a lamp on the dining table', () => {
    expect(f('Gang', 'D2').length + f('WC', 'D2').length).toBeGreaterThan(0);
    expect(f('Wohnzimmer', 'D3').length).toBeGreaterThan(0);
  });
  it('does not pass the kitchen, the bath and the WC; the flat does not pass', () => {
    for (const room of ['Küche', 'Bad', 'WC']) expect(review.rooms.find((r) => r.roomId === flat.find((i) => i.analysis.name === room)!.analysis.roomId)!.passed, room).toBe(false);
    expect(review.passed).toBe(false);
    expect(review.minScore).toBeLessThan(75);
  });
});

describe('Heutiger Vorschlag, Testwohnung B', () => {
  const flat = inputs('B');
  const review = reviewFlat(flat);
  const f = (room: string, rule: string) => rules(review, room, flat).filter((x) => x.rule === rule);
  it('finds that one cannot get between the doors of the living kitchen', () => {
    expect(f('Wohnküche', 'B1').filter((x) => x.severity === 'S').length).toBe(3);
  });
  it('finds the tall cabinet and the fridge in the door swing and the plant in the way', () => {
    expect(f('Wohnküche', 'B4').length).toBe(2);
    expect(f('Wohnküche', 'D1').some((x) => /im Weg/.test(x.text))).toBe(true);
  });
  it('finds the WC squeezed against the washing machine and the nightstand nobody can reach', () => {
    expect(f('Bad', 'C9').length).toBeGreaterThan(0);
    expect(f('Schlafzimmer', 'B7').length).toBeGreaterThan(0);
  });
  it('does not pass the living kitchen', () => {
    const room = flat.find((i) => i.analysis.name === 'Wohnküche')!.analysis.roomId;
    expect(review.rooms.find((r) => r.roomId === room)!.passed).toBe(false);
    expect(review.passed).toBe(false);
  });
});

describe('Laufzeit', () => {
  it('takes less than 100 ms per room on the test flats', () => {
    for (const key of ['A', 'B'] as const) {
      const flat = inputs(key);
      reviewFlat(flat);
      for (const input of flat) {
        const t0 = performance.now();
        reviewFlat([input]);
        expect(performance.now() - t0, `${key} ${input.analysis.name}`).toBeLessThan(100);
      }
    }
  });
});
