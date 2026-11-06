/**
 * Soft furnishings and table decoration in the solver (Deko-Runde): cushions and throws lie IN the
 * seat of a sofa or armchair, on a bed they go in front of the pillows and across the foot, herbs
 * stand on the window sill, and a cushion without a relation finds its sofa or bed by itself.
 */
import { describe, expect, it } from 'vitest';
import { rectRoom } from '../review/testkit';
import type { Layout, PlacedItem, ProgramItem, Relation, RoomAnalysis, RoomProgram } from '../types';
import { solveRoom } from './solve';

const item = (id: string, catalogId: string, hint?: [number, number, number]): ProgramItem => ({
  id,
  catalogId,
  zone: 'z',
  why: '',
  ...(hint ? { hint: { x: hint[0], y: hint[1], rotation: hint[2] } } : {}),
});
const program = (room: RoomAnalysis, items: ProgramItem[], relations: Relation[] = []): RoomProgram => ({
  roomId: room.roomId,
  reading: '',
  zones: [{ id: 'z', function: 'Wohnen', rect: { x0: 0, y0: 0, x1: room.size.x, y1: room.size.y }, why: '' }],
  items,
  relations,
  walk: '',
  check: [],
});
const byId = (l: Layout, id: string): PlacedItem => {
  const it = l.items.find((i) => i.id === id);
  if (!it) throw new Error(`${id} fehlt`);
  return it;
};
const N = Math.PI;

describe('soft furnishings', () => {
  it('cushions and a throw lie in the seat of the sofa, at its two ends', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'O', at: 3.4 }], windows: [{ wall: 'N', at: 2.5 }] });
    const p = program(
      room,
      [item('sofa', 'generic-sofa-3', [2.5, 3.5, N]), item('cushions', 'generic-cushions'), item('throw', 'generic-throw')],
      [
        { kind: 'wall', item: 'sofa', wall: 'W3' },
        { kind: 'on', item: 'cushions', target: 'sofa' },
        { kind: 'on', item: 'throw', target: 'sofa' },
      ],
    );
    const layout = solveRoom(room, p, { seed: 1 });
    const sofa = byId(layout, 'sofa');
    const cushions = byId(layout, 'cushions');
    const th = byId(layout, 'throw');
    for (const s of [cushions, th]) {
      expect(s.elevation, s.id).toBeGreaterThan(0.3);
      expect(s.elevation, s.id).toBeLessThanOrEqual(0.5);
      expect(Math.hypot(s.x - sofa.x, s.y - sofa.y), s.id).toBeLessThan(sofa.width / 2);
    }
    // not on top of each other: they lie at opposite ends of the sofa
    expect(Math.hypot(cushions.x - th.x, cushions.y - th.y)).toBeGreaterThan(0.5);
  });

  it('cushions in the armchair sit in the middle of the seat', () => {
    const room = rectRoom(4, 4, { doors: [{ wall: 'S', at: 1 }] });
    const p = program(room, [item('chair', 'generic-armchair', [3.2, 3.2, N]), item('cushion', 'generic-cushion')], [{ kind: 'on', item: 'cushion', target: 'chair' }]);
    const layout = solveRoom(room, p, { seed: 1 });
    const chair = byId(layout, 'chair');
    const c = byId(layout, 'cushion');
    expect(c.elevation).toBeGreaterThan(0.3);
    expect(Math.hypot(c.x - chair.x, c.y - chair.y)).toBeLessThan(chair.width / 2 - 0.1);
  });

  it('on the bed the cushions lie by the pillows and the plaid across the foot', () => {
    const room = rectRoom(4.5, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'O', at: 2 }] });
    const p = program(
      room,
      [item('bed', 'generic-bed-160', [2.25, 1.2, 0]), item('cushions', 'generic-cushions'), item('plaid', 'generic-bed-throw')],
      [
        { kind: 'wall', item: 'bed', wall: 'W1' },
        { kind: 'on', item: 'cushions', target: 'bed' },
        { kind: 'on', item: 'plaid', target: 'bed' },
      ],
    );
    const layout = solveRoom(room, p, { seed: 1 });
    const bed = byId(layout, 'bed');
    const cushions = byId(layout, 'cushions');
    const plaid = byId(layout, 'plaid');
    // the head is at the wall (small y), the foot points into the room
    expect(cushions.elevation).toBeGreaterThan(0.5);
    expect(plaid.elevation).toBeGreaterThan(0.5);
    expect(Math.abs(cushions.x - bed.x)).toBeLessThan(bed.width / 2);
    expect(plaid.y).toBeGreaterThan(cushions.y + 0.5);
    expect(plaid.y).toBeLessThan(bed.y + bed.depth / 2);
  });

  it('a cushion without any relation goes to the sofa instead of standing on the floor', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'O', at: 3.4 }], windows: [{ wall: 'N', at: 2.5 }] });
    const p = program(room, [item('sofa', 'generic-sofa-3', [2.5, 3.5, N]), item('cushions', 'generic-cushions', [1, 1, 0])], [{ kind: 'wall', item: 'sofa', wall: 'W3' }]);
    const layout = solveRoom(room, p, { seed: 1 });
    const sofa = byId(layout, 'sofa');
    const c = byId(layout, 'cushions');
    expect(c.parent).toBe('sofa');
    expect(c.elevation).toBeGreaterThan(0.3);
    expect(Math.hypot(c.x - sofa.x, c.y - sofa.y)).toBeLessThan(sofa.width / 2);
  });

  it('a throw without any relation never goes on the bed, a plaid never on the sofa', () => {
    const room = rectRoom(6, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 2.5 }] });
    const p = program(
      room,
      [item('bed', 'generic-bed-160', [1.6, 1.2, 0]), item('sofa', 'generic-sofa-3', [4.2, 3.5, N]), item('throw', 'generic-throw', [2, 2, 0]), item('plaid', 'generic-bed-throw', [2, 2, 0])],
      [
        { kind: 'wall', item: 'bed', wall: 'W1' },
        { kind: 'wall', item: 'sofa', wall: 'W3' },
      ],
    );
    const layout = solveRoom(room, p, { seed: 1 });
    const th = layout.items.find((i) => i.id === 'throw');
    const pl = layout.items.find((i) => i.id === 'plaid');
    if (th) expect(th.parent).not.toBe('bed');
    if (pl) expect(pl.parent).not.toBe('sofa');
  });
});

describe('table decoration', () => {
  it('herbs without a relation stand on the window sill', () => {
    const room = rectRoom(4, 3, { doors: [{ wall: 'S', at: 2 }], windows: [{ wall: 'N', at: 2, width: 1.2 }] });
    const p = program(room, [item('herbs', 'generic-herbs', [2, 1, 0])]);
    const layout = solveRoom(room, p, { seed: 1 });
    const h = layout.items.find((i) => i.id === 'herbs');
    expect(h, 'herbs placed').toBeDefined();
    expect(h!.elevation).toBeGreaterThan(0.5);
    expect(h!.y).toBeLessThan(0.6);
  });

  it('a vase stands on the dining table, a candle tray on the coffee table', () => {
    const room = rectRoom(6, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 3 }] });
    const p = program(
      room,
      [item('table', 'generic-dining-table-4', [4.5, 2, 0]), item('vase', 'generic-vase'), item('coffee', 'generic-coffee-table', [1.5, 2, 0]), item('tray', 'generic-candle-tray')],
      [
        { kind: 'on', item: 'vase', target: 'table' },
        { kind: 'on', item: 'tray', target: 'coffee' },
      ],
    );
    const layout = solveRoom(room, p, { seed: 1 });
    const table = byId(layout, 'table');
    const vase = byId(layout, 'vase');
    const coffee = byId(layout, 'coffee');
    const tray = byId(layout, 'tray');
    expect(vase.elevation).toBeGreaterThan(0.6);
    expect(Math.hypot(vase.x - table.x, vase.y - table.y)).toBeLessThan(0.4);
    expect(tray.elevation).toBeGreaterThan(0.3);
    expect(Math.hypot(tray.x - coffee.x, tray.y - coffee.y)).toBeLessThan(0.4);
  });
});
