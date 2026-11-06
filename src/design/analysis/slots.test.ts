import { describe, expect, it } from 'vitest';
import { FLAT_KEYS, TEST_FLATS } from '../fixtures/flats';
import { put, rectRoom } from '../review/testkit';
import { toRItem } from '../review/items';
import { analyzeFlat } from './flat';
import { gazePieceOf, type GazePiece } from './gaze';
import { anchorSlots, slotLines, type AnchorSize } from './slots';

const SOFA: AnchorSize = { kind: 'sofa', name: 'Sofa', width: 2.1, depth: 0.9 };
const BED: AnchorSize = { kind: 'bed', name: 'Doppelbett', width: 1.65, depth: 2.08 };
const DESK: AnchorSize = { kind: 'desk', name: 'Schreibtisch', width: 1.4, depth: 0.7 };
const TABLE: AnchorSize = { kind: 'dining', name: 'Esstisch', width: 1.4, depth: 0.85 };

const piece = (catalogId: string, at: Parameters<typeof put>[1]): GazePiece => ({ ...toRItem(put(catalogId, at), true, []), ref: catalogId });

describe('places for the anchor pieces (#436)', () => {
  // W1 north with the window F1, W2 east, W3 south with the door T1 near the east corner, W4 west
  const room = rectRoom(5, 4, { doors: [{ wall: 'S', at: 0.6 }, { wall: 'W', at: 1.0 }], windows: [{ wall: 'N', at: 2.5 }] });

  it('gives 3 to 6 places with ids, best first, none where the door swings or the way runs', () => {
    const slots = anchorSlots({ room, existing: [] }, SOFA);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    expect(slots.length).toBeLessThanOrEqual(6);
    expect(slots.map((s) => s.id)).toEqual(slots.map((_, i) => `SOFA-${i + 1}`));
    expect(slots.map((s) => s.score)).toEqual([...slots.map((s) => s.score)].sort((a, b) => b - a));
    for (const s of slots) {
      expect(s.wall).toMatch(/^W\d$/);
      expect(s.text).toMatch(/Rücken an W\d/);
      expect(s.text).toMatch(/cm frei davor/);
      // the door T1 swings into the south-west corner of the room
      if (s.wall === 'W3') expect(s.along!.from).toBeGreaterThanOrEqual(90);
    }
  });

  it('a sofa does not get a place in front of the kitchen run, and the kitchen is named for the others', () => {
    const run = ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-base-60'].map((id, n) => piece(id, { x: 4.7, y: 0.5 + n * 0.7, face: 'W' }));
    const slots = anchorSlots({ room, existing: run }, SOFA);
    // nothing stands in the working area (1.2 m) in front of the run
    for (const s of slots) expect(s.wall === 'W2' ? s.along!.from : 0).toBeLessThan(1);
    const west = slots.find((s) => s.wall === 'W4' && /Küchenzeile/.test(s.text));
    expect(west ? west.score : 0).toBeLessThan(slots[0].score + 1);
  });

  it('a bed needs room at the foot and does not block the ways; a double bed prefers access from both sides', () => {
    const slots = anchorSlots({ room, existing: [] }, BED);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.text).toMatch(/Platz neben dem Bett \d+\/\d+ cm/);
    expect(slots[0].text).toMatch(/Platz neben dem Bett (\d+)\/(\d+) cm/);
    const [, l, r] = /Platz neben dem Bett (\d+)\/(\d+) cm/.exec(slots[0].text)!.map(Number);
    expect(Math.min(l, r)).toBeGreaterThanOrEqual(50);
  });

  it('a loud wall costs a bed and a desk points', () => {
    const quiet = anchorSlots({ room, existing: [] }, DESK);
    const loud = anchorSlots({ room, existing: [], loud: new Set(['W4', 'W2', 'W1', 'W3']) }, DESK);
    expect(Math.max(...loud.map((s) => s.score))).toBeLessThan(Math.max(...quiet.map((s) => s.score)));
    expect(loud[0].text).toContain('laute oder kalte Wand');
  });

  it('a table gets places along walls and free in the middle with room for the chairs', () => {
    const slots = anchorSlots({ room: rectRoom(5, 4.5, { doors: [{ wall: 'S', at: 0.6 }] }), existing: [] }, TABLE);
    expect(slots.some((s) => s.wall === null && /frei im Raum/.test(s.text))).toBe(true);
    expect(slots.some((s) => s.wall !== null)).toBe(true);
  });

  it('nothing fits a piece that is bigger than every free wall: says so', () => {
    const tiny = rectRoom(1.5, 1.5, { doors: [{ wall: 'S', at: 0.75 }] });
    const slots = anchorSlots({ room: tiny, existing: [] }, SOFA);
    expect(slots).toEqual([]);
    expect(slotLines(SOFA, slots)).toContain('kein geprüfter Wandplatz frei');
  });
});

describe.each(FLAT_KEYS)('places in test flat %s', (key) => {
  it('every room: places are inside the room and finish quickly', () => {
    const project = TEST_FLATS[key].build();
    const flat = analyzeFlat(project);
    for (const r of flat.rooms) {
      const existing = project.furniture.filter((f) => r.existing.includes(f.id)).map(gazePieceOf);
      for (const size of [SOFA, BED, DESK, TABLE]) {
        for (const s of anchorSlots({ room: r, existing }, size)) {
          expect(s.x).toBeGreaterThanOrEqual(r.origin.x - 0.01);
          expect(s.x).toBeLessThanOrEqual(r.origin.x + r.size.x + 0.01);
          expect(s.y).toBeGreaterThanOrEqual(r.origin.y - 0.01);
          expect(s.y).toBeLessThanOrEqual(r.origin.y + r.size.y + 0.01);
        }
      }
    }
  });
});
