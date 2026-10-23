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
  it('finds the dishwasher and sink cabinet in the door swing of the kitchen', () => {
    expect(f('Küche', 'B4').some((x) => x.severity === 'S')).toBe(true);
  });
  it('finds pieces right behind the doors (kitchen, hall, store room, bath, WC)', () => {
    for (const room of ['Küche', 'Gang', 'Abstellraum', 'Bad', 'WC']) expect(f(room, 'B5').length + f(room, 'B4').length, room).toBeGreaterThan(0);
  });
  it('finds the missing hand basin in the WC', () => {
    expect(f('WC', 'A1').some((x) => /Handwaschbecken/.test(x.text))).toBe(true);
  });
  it('finds the bed and wardrobe 21 cm apart in room 1 and armchair and chair in the living room', () => {
    expect(f('Zimmer 1', 'C9').length).toBeGreaterThan(0);
    expect(f('Wohnzimmer', 'C9').length).toBeGreaterThan(0);
  });
  it('does not pass the rooms with severe findings', () => {
    expect(review.passed).toBe(false);
    expect(review.rooms.filter((r) => !r.passed).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Heutiger Vorschlag, Testwohnung B', () => {
  const flat = inputs('B');
  const review = reviewFlat(flat);
  const f = (room: string, rule: string) => rules(review, room, flat).filter((x) => x.rule === rule);
  it('finds that one cannot get between the doors of the living kitchen', () => {
    expect(f('Wohnküche', 'B1').some((x) => x.severity === 'S')).toBe(true);
  });
  it('finds the tall cabinet and the fridge in the door swing', () => {
    expect(f('Wohnküche', 'B4').length).toBeGreaterThanOrEqual(1);
  });
  it('finds pieces behind the doors of hall and bedroom, the dining table squeezed against the shelf', () => {
    expect(f('Vorraum', 'B5').length).toBeGreaterThan(0);
    expect(f('Schlafzimmer', 'B5').length).toBeGreaterThan(0);
    expect(f('Wohnküche', 'C9').length).toBeGreaterThan(0);
  });
  it('does not pass the living kitchen', () => {
    const room = flat.find((i) => i.analysis.name === 'Wohnküche')!.analysis.roomId;
    expect(review.rooms.find((r) => r.roomId === room)!.passed).toBe(false);
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
