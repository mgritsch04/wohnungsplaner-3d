/**
 * No „why?“ moments (#440, #442): what a person notices first when a layout makes no sense. The
 * sofa looks at the TV, a plant stands in a corner or at a wall and not on the way, an armchair
 * looks at the seating group, the kitchen gets its cooktop and hood, a runner lies right in front
 * of the counter, the pendant of a table that was left out goes with it.
 */
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../model/vec';
import { analyzeFlat } from '../analysis';
import { TEST_FLATS } from '../fixtures/flats';
import { RECORDED } from '../fixtures/recorded';
import { rectRoom } from '../review/testkit';
import type { Layout, PlacedItem, ProgramItem, Relation, RoomAnalysis, RoomProgram } from '../types';
import { programFromRecorded } from './recordedProgram';
import { existingPieces, solveRoom } from './solve';

const front = (i: PlacedItem): Vec2 => ({ x: -Math.sin(i.rotation), y: Math.cos(i.rotation) });
/** Angle (degrees) between the front of `from` and the direction to `to`. */
function angleTo(from: PlacedItem, to: Vec2): number {
  const f = front(from);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.acos(Math.max(-1, Math.min(1, (f.x * dx + f.y * dy) / Math.hypot(dx, dy)))) * 180) / Math.PI;
}
const byId = (l: Layout, id: string) => {
  const it = l.items.find((i) => i.id === id);
  if (!it) throw new Error(`${id} fehlt`);
  return it;
};

function recorded(key: 'A' | 'B', name: string) {
  const project = TEST_FLATS[key].build();
  const room = analyzeFlat(project).rooms.find((r) => r.name === name)!;
  const existing = existingPieces(project, room);
  const program = programFromRecorded(RECORDED[key]!.programs[name], room, existing);
  return { room, layout: solveRoom(room, program, { existing, seed: 7 }) };
}

const S = 0;
const N = Math.PI;
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

describe('the sofa looks at the TV', () => {
  it('Claude names only „tv facing sofa“ (flat A): the sofa faces the TV, not away from it', () => {
    const { layout } = recorded('A', 'Wohnzimmer');
    expect(angleTo(byId(layout, 'sofa'), byId(layout, 'tv'))).toBeLessThan(30);
  });

  it('without any relation the only sofa of the room faces the TV, even with a start place facing away', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'O', at: 3.4 }], windows: [{ wall: 'N', at: 2.5 }] });
    const p = program(room, [item('sofa', 'generic-sofa-3', [2.5, 1.0, N]), item('board', 'generic-tv-sideboard', [2.5, 3.8, N]), item('tv', 'generic-tv')], [{ kind: 'above', item: 'tv', target: 'board' }]);
    const layout = solveRoom(room, p, { seed: 3 });
    expect(layout.unsolved).toEqual([]);
    expect(angleTo(byId(layout, 'sofa'), byId(layout, 'tv'))).toBeLessThan(30);
  });
});

describe('no dead strip behind a back (W9)', () => {
  it('a sofa Claude puts 65 cm in front of the wall goes to the wall or leaves a passage', () => {
    const room = rectRoom(5, 4.2, { doors: [{ wall: 'O', at: 3.4 }], windows: [{ wall: 'W', at: 2.0 }] });
    for (const seed of [1, 2, 3]) {
      const p = program(
        room,
        [item('sofa', 'generic-sofa-3', [2.2, 1.1, S]), item('coffee', 'generic-coffee-table'), item('board', 'generic-tv-sideboard', [2.2, 4.0, N]), item('tv', 'generic-tv')],
        [
          { kind: 'front-of', item: 'coffee', target: 'sofa', gap: 0.45 },
          { kind: 'above', item: 'tv', target: 'board' },
        ],
      );
      const layout = solveRoom(room, p, { seed });
      const sofa = byId(layout, 'sofa');
      const gap = sofa.y - sofa.depth / 2;
      expect(gap <= 0.1 || gap >= 0.75, `seed ${seed}: ${Math.round(gap * 100)} cm hinter dem Sofa`).toBe(true);
    }
  });

  it('a desk does not stand a hand\'s width off the wall', () => {
    const room = rectRoom(3.5, 3.2, { doors: [{ wall: 'S', at: 0.6 }], windows: [{ wall: 'W', at: 1.6 }] });
    const p = program(room, [item('desk', 'generic-desk', [1.9, 0.6, S])]);
    const layout = solveRoom(room, p, { seed: 4 });
    const desk = byId(layout, 'desk');
    const gap = Math.min(desk.x, desk.y, room.size.x - desk.x, room.size.y - desk.y) - desk.depth / 2;
    expect(gap <= 0.1 || gap >= 0.75, `${Math.round(gap * 100)} cm hinter dem Schreibtisch`).toBe(true);
  });
});

describe('a tight room keeps its double bed', () => {
  it('three doors round the bed: a nightstand or the shelf stays out, the 180 bed keeps its size', () => {
    const room = rectRoom(4.59, 4.08, {
      doors: [{ wall: 'N', at: 3.55, width: 0.8 }, { wall: 'S', at: 2.44, width: 0.8 }, { wall: 'W', at: 3.43, width: 0.8 }],
      windows: [{ wall: 'O', at: 2.05 }],
      passThrough: true,
    });
    const E = -Math.PI / 2;
    const p = program(
      room,
      [
        { ...item('bed', 'generic-bed-180', [1.05, 2.2, E]), required: true },
        item('ns1', 'generic-nightstand', [0.2, 1.05, E]),
        item('ns2', 'generic-nightstand', [0.2, 3.35, E]),
        item('shelf', 'generic-shelf-80', [2.9, 3.85, N]),
        item('chair', 'generic-armchair', [3.9, 2.0, Math.PI / 2]),
      ],
      [{ kind: 'wall', item: 'bed', wall: 'W4' }, { kind: 'pair', item: 'ns1', item2: 'ns2', target: 'bed' }],
    );
    const layout = solveRoom(room, p, { seed: 1 });
    expect(byId(layout, 'bed').catalogId).toBe('generic-bed-180');
    expect(layout.dropped.map((d) => d.id).filter((id) => id !== 'bed')).not.toEqual([]);
  });
});

describe('no large empty patch (E6)', () => {
  it('a living room spreads its zones: the dining table leaves the sofa and takes the empty half', () => {
    const room = rectRoom(7, 4.5, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 3.5 }] });
    const E = -Math.PI / 2;
    const p = program(
      room,
      [
        item('sofa', 'generic-sofa-3', [0.5, 2.25, E]),
        item('coffee', 'generic-coffee-table', [1.4, 2.25, 0]),
        item('table', 'generic-dining-table-4', [3.0, 2.25, 0]),
        item('c1', 'generic-chair', [3.0, 1.6, 0]),
        item('c2', 'generic-chair', [3.0, 2.9, N]),
      ],
      [{ kind: 'wall', item: 'sofa', wall: 'W4' }, { kind: 'front-of', item: 'coffee', target: 'sofa', gap: 0.45 }, { kind: 'around', items: ['c1', 'c2'], target: 'table' }],
    );
    const plain = solveRoom(room, p, { seed: 1 });
    const spread = solveRoom(room, p, { seed: 1, spread: true });
    expect(byId(spread, 'table').x).toBeGreaterThan(byId(plain, 'table').x + 0.5);
  });
});

describe('marked areas are rough sketches', () => {
  it('a desk that reaches a little past the area the user drew is still placed, not left out as missing', () => {
    const base = rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }], windows: [{ wall: 'N', at: 2.5 }] });
    const room: RoomAnalysis = { ...base, userZones: [{ id: 'Z1', zoneId: 'z1', purpose: 'Arbeitsplatz', keepFree: false, points: [{ x: 0, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 0.8, y: 1.3 }, { x: 0, y: 1.3 }] }] };
    const E = -Math.PI / 2;
    const p: RoomProgram = {
      ...program(room, [{ ...item('desk', 'generic-desk-small', [0.3, 0.9, E]), required: true }, item('chair', 'generic-office-chair', [0.95, 0.9, Math.PI / 2])], [{ kind: 'wall', item: 'desk', wall: 'W4' }]),
      zones: [{ id: 'z', function: 'Arbeiten', rect: { x0: 0, y0: 0.5, x1: 0.8, y1: 1.3 }, why: '', userZone: 'Z1' }],
    };
    const layout = solveRoom(room, p, { seed: 1 });
    expect(layout.dropped.map((d) => d.id)).not.toContain('desk');
    expect(byId(layout, 'desk').x).toBeLessThan(1.0);
  });
});

describe('chairs at the table', () => {
  it('chairs Claude placed round the table without any relation stay at the table, not in a heap beside it', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'O', at: 3.4 }], windows: [{ wall: 'N', at: 2.5 }] });
    const chairs = [
      item('c1', 'generic-chair', [2.5, 1.35, S]),
      item('c2', 'generic-chair', [3.1, 1.75, -Math.PI / 2]),
      item('c3', 'generic-chair', [3.1, 2.35, -Math.PI / 2]),
      item('c4', 'generic-chair', [1.9, 1.75, Math.PI / 2]),
      item('c5', 'generic-chair', [1.9, 2.35, Math.PI / 2]),
      item('c6', 'generic-chair', [2.5, 2.75, N]),
    ];
    const p = program(room, [item('table', 'generic-dining-table-6', [2.5, 2.05, Math.PI / 2]), ...chairs]);
    for (const seed of [1, 2, 3]) {
      const layout = solveRoom(room, p, { seed });
      const table = byId(layout, 'table');
      for (const c of chairs) {
        const chair = byId(layout, c.id);
        const reach = Math.max(table.width, table.depth) / 2 + 0.45;
        expect(Math.hypot(chair.x - table.x, chair.y - table.y), `${c.id} seed ${seed}`).toBeLessThan(reach);
        expect(angleTo(chair, table), `${c.id} seed ${seed}`).toBeLessThan(60);
      }
    }
  });
});

describe('what stands on the TV lowboard', () => {
  it('a lamp and a plant stand at the ends of the lowboard, beside the TV hung over it, not in front of the screen', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'O', at: 3.4 }], windows: [{ wall: 'N', at: 2.5 }] });
    const p = program(
      room,
      [item('sofa', 'generic-sofa-3', [2.5, 1.0, N]), item('board', 'generic-tv-sideboard', [2.5, 3.8, N]), item('tv', 'generic-tv'), item('lamp', 'generic-table-lamp'), item('plant', 'generic-plant-small')],
      [{ kind: 'above', item: 'tv', target: 'board' }, { kind: 'on', item: 'lamp', target: 'board' }, { kind: 'on', item: 'plant', target: 'board' }],
    );
    const layout = solveRoom(room, p, { seed: 3 });
    const board = byId(layout, 'board');
    const tv = byId(layout, 'tv');
    const along = (i: PlacedItem) => (i.x - board.x) * Math.cos(board.rotation) + (i.y - board.y) * Math.sin(board.rotation);
    for (const id of ['lamp', 'plant']) {
      const piece = byId(layout, id);
      // beside the screen along the board (its middle outside the screen), at the board's end
      expect(Math.abs(along(piece) - along(tv))).toBeGreaterThan(tv.width / 2);
      expect(Math.abs(Math.abs(along(piece)) - (board.width - piece.width) / 2)).toBeLessThan(0.01);
    }
  });
});

describe('plants and armchairs', () => {
  const room = rectRoom(5, 4, { doors: [{ wall: 'S', at: 4.3 }, { wall: 'W', at: 2 }], windows: [{ wall: 'N', at: 2.5 }] });

  it('a plant without a relation stands in a corner, at a window or at a wall, not on the way between the doors', () => {
    for (const seed of [1, 2, 3]) {
      const p = program(room, [item('sofa', 'generic-sofa-3', [2.5, 0.6, S]), item('plant', 'generic-plant', [2.4, 2.2, S])]);
      const layout = solveRoom(room, p, { seed });
      const plant = byId(layout, 'plant');
      const toWall = Math.min(plant.x, plant.y, room.size.x - plant.x, room.size.y - plant.y) - plant.width / 2;
      expect(toWall, `seed ${seed}`).toBeLessThan(0.35);
      for (const w of room.walkways) {
        const [a, b] = w.path;
        const t = Math.max(0, Math.min(1, ((plant.x - a.x) * (b.x - a.x) + (plant.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
        const d = Math.hypot(plant.x - (a.x + t * (b.x - a.x)), plant.y - (a.y + t * (b.y - a.y)));
        expect(d, `seed ${seed}: Pflanze im Weg ${w.from}–${w.to}`).toBeGreaterThan(plant.width / 2 + 0.25);
      }
    }
  });

  it('an armchair on its own looks at the sofa and the coffee table', () => {
    const p = program(
      room,
      [item('sofa', 'generic-sofa-3', [2.5, 0.6, S]), item('coffee', 'generic-coffee-table'), item('armchair', 'generic-armchair', [4.3, 1.4, S])],
      [{ kind: 'front-of', item: 'coffee', target: 'sofa', gap: 0.45 }],
    );
    const layout = solveRoom(room, p, { seed: 5 });
    const sofa = byId(layout, 'sofa');
    const coffee = byId(layout, 'coffee');
    expect(angleTo(byId(layout, 'armchair'), { x: (sofa.x + coffee.x) / 2, y: (sofa.y + coffee.y) / 2 })).toBeLessThan(70);
  });
});

describe('kitchen', () => {
  it('the cooktop goes on the oven and the hood above it (flats A and B)', () => {
    for (const [key, name] of [
      ['A', 'Küche'],
      ['B', 'Wohnküche'],
    ] as const) {
      const { layout } = recorded(key, name);
      const cook = byId(layout, 'kitchen1-cooktop');
      const oven = layout.items.find((i) => i.catalogId === 'generic-k-oven')!;
      expect(cook.parent, name).toBe(oven.id);
      expect(Math.hypot(cook.x - oven.x, cook.y - oven.y)).toBeLessThan(0.01);
      expect(cook.elevation).toBeCloseTo(0.9);
      const hood = byId(layout, 'kitchen1-hood');
      expect(hood.parent).toBe(cook.id);
      expect(hood.elevation).toBeGreaterThan(1.4);
    }
  });

  const runRoom = (windowAt: number) => rectRoom(4, 3, { doors: [{ wall: 'S', at: 2 }], windows: [{ wall: 'N', at: windowAt, width: 1.0 }] });
  const withRun = (room: RoomAnalysis, modules: string[]): RoomProgram => ({ ...program(room, []), kitchen: [{ wall: 'W1', from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, modules }] });
  const windowSpan = (room: RoomAnalysis) => room.walls[0].openings.find((o) => o.kind === 'window')!;

  it('without an oven the cooktop takes a base module with 60 cm worktop to the sink, not under the window', () => {
    const room = runRoom(1.6);
    const layout = solveRoom(room, withRun(room, ['generic-k-fridge', 'generic-k-base-60', 'generic-k-sink-80', 'generic-k-drawer-60', 'generic-k-base-60', 'generic-k-base-40']), { seed: 1 });
    const cook = byId(layout, 'kitchen1-cooktop');
    const host = byId(layout, cook.parent!);
    const sink = layout.items.find((i) => i.catalogId === 'generic-k-sink-80')!;
    expect(host.catalogId).toMatch(/base|drawer/);
    expect(Math.abs(host.x - sink.x) - (host.width + sink.width) / 2).toBeGreaterThanOrEqual(0.59);
    const win = windowSpan(room);
    expect(cook.x - cook.width / 2 >= win.t1 || cook.x + cook.width / 2 <= win.t0).toBe(true);
    expect(byId(layout, 'kitchen1-hood').parent).toBe(cook.id);
  });

  it('a cooktop under a window gets no hood', () => {
    const room = runRoom(2.5);
    const layout = solveRoom(room, withRun(room, ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-base-60', 'generic-k-oven']), { seed: 1 });
    const cook = byId(layout, 'kitchen1-cooktop');
    const win = windowSpan(room);
    expect(cook.x + cook.width / 2 > win.t0 && cook.x - cook.width / 2 < win.t1).toBe(true);
    expect(layout.items.some((i) => i.id === 'kitchen1-hood')).toBe(false);
  });

  it('wall cabinets hang over the other base modules, never in front of the window or over the cooktop', () => {
    const room = rectRoom(5, 3, { doors: [{ wall: 'S', at: 2.5 }], windows: [{ wall: 'N', at: 1.0, width: 1.0 }] });
    const layout = solveRoom(room, withRun(room, ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-dishwasher', 'generic-k-drawer-60', 'generic-k-oven', 'generic-k-base-60']), { seed: 1 });
    const cabinets = layout.items.filter((i) => /^generic-k-wall-/.test(i.catalogId));
    expect(cabinets.length).toBeGreaterThanOrEqual(2);
    const win = windowSpan(room);
    const cook = byId(layout, 'kitchen1-cooktop');
    for (const c of cabinets) {
      expect(c.elevation).toBeCloseTo(1.45);
      expect(c.x + c.width / 2 <= win.t0 + 1e-6 || c.x - c.width / 2 >= win.t1 - 1e-6, c.id).toBe(true);
      expect(c.parent, c.id).not.toBe(cook.parent);
      const host = byId(layout, c.parent!);
      expect(Math.abs(c.x - host.x)).toBeLessThan(0.01);
      expect(c.y).toBeLessThan(host.y);
    }
  });

  it('a 40 cm module gets its wall cabinet, every wall cabinet a light strip under its front edge (K5)', () => {
    const room = rectRoom(5, 3, { doors: [{ wall: 'S', at: 2.5 }] });
    const layout = solveRoom(room, withRun(room, ['generic-k-fridge', 'generic-k-base-40', 'generic-k-sink-80', 'generic-k-dishwasher', 'generic-k-oven', 'generic-k-base-60']), { seed: 1 });
    const cabinets = layout.items.filter((i) => /^generic-k-wall-/.test(i.catalogId));
    expect(cabinets.map((c) => c.catalogId)).toContain('generic-k-wall-40');
    for (const c of cabinets) {
      const light = layout.items.find((i) => i.catalogId === 'generic-k-light' && i.parent === c.id);
      expect(light, c.id).toBeDefined();
      expect(light!.elevation + light!.height).toBeCloseTo(c.elevation);
      expect(light!.width).toBeLessThan(c.width);
      // under the front edge: further from the wall than the cabinet's middle
      expect(light!.y).toBeGreaterThan(c.y);
    }
  });

  it('an L-shaped kitchen (two runs) gets one cooktop and one hood', () => {
    const room = rectRoom(4, 3, { doors: [{ wall: 'S', at: 2 }] });
    const p: RoomProgram = {
      ...program(room, []),
      kitchen: [
        { wall: 'W1', from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, modules: ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-dishwasher', 'generic-k-drawer-60'] },
        { wall: 'W2', from: { x: 4, y: 0 }, to: { x: 4, y: 3 }, modules: ['generic-k-base-60', 'generic-k-oven', 'generic-k-base-60'] },
      ],
    };
    const layout = solveRoom(room, p, { seed: 2 });
    expect(layout.items.filter((i) => i.catalogId === 'generic-k-cooktop')).toHaveLength(1);
    expect(layout.items.filter((i) => i.catalogId === 'generic-k-hood-60')).toHaveLength(1);
    const cook = layout.items.find((i) => i.catalogId === 'generic-k-cooktop')!;
    expect(layout.items.find((i) => i.id === cook.parent)?.catalogId).toBe('generic-k-oven');
  });

  it('the two runs of an L meet in the corner without a gap: the corner module becomes the blind corner (#443)', () => {
    const room = rectRoom(4, 3, { doors: [{ wall: 'S', at: 1 }] });
    // as Claude writes it: the second run starts 60 cm from the corner, past the depth of the first
    const p: RoomProgram = {
      ...program(room, []),
      kitchen: [
        { wall: 'W1', from: { x: 1.4, y: 0 }, to: { x: 4, y: 0 }, modules: ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-base-60', 'generic-k-drawer-60'] },
        { wall: 'W2', from: { x: 4, y: 0.6 }, to: { x: 4, y: 1.8 }, modules: ['generic-k-base-60', 'generic-k-base-60'] },
      ],
    };
    const layout = solveRoom(room, p, { seed: 1 });
    const first = layout.items.filter((i) => i.kitchenRun === 0 && i.elevation < 0.05);
    const second = layout.items.filter((i) => i.kitchenRun === 1 && i.elevation < 0.05);
    const end = first.reduce((a, b) => (b.x > a.x ? b : a));
    const corner = end.y + end.depth / 2;
    const start = Math.min(...second.map((i) => i.y - i.width / 2));
    expect(start - corner).toBeGreaterThanOrEqual(0);
    expect(start - corner).toBeLessThan(0.02);
  });

  it('a second run Claude starts a little off the corner still closes the L: no gap between hob and sink (image review)', () => {
    const room = rectRoom(4, 3, { doors: [{ wall: 'S', at: 1 }] });
    const p: RoomProgram = {
      ...program(room, []),
      kitchen: [
        { wall: 'W1', from: { x: 1.4, y: 0 }, to: { x: 4, y: 0 }, modules: ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-base-60', 'generic-k-drawer-60'] },
        { wall: 'W2', from: { x: 4, y: 0.8 }, to: { x: 4, y: 2.0 }, modules: ['generic-k-base-60', 'generic-k-oven'] },
      ],
    };
    const layout = solveRoom(room, p, { seed: 1 });
    const first = layout.items.filter((i) => i.kitchenRun === 0 && i.elevation < 0.05);
    const second = layout.items.filter((i) => i.kitchenRun === 1 && i.elevation < 0.05);
    const end = first.reduce((a, b) => (b.x > a.x ? b : a));
    const start = Math.min(...second.map((i) => i.y - i.width / 2));
    expect(start - (end.y + end.depth / 2)).toBeLessThan(0.02);
  });

  it('a runner lies right in front of the counter (flat A: Claude says 50 cm, meant is the walking strip)', () => {
    const { layout } = recorded('A', 'Küche');
    const runner = byId(layout, 'runner');
    const run = layout.items.filter((i) => i.kitchenRun === 0 && i.elevation < 0.05);
    // the run stands at the east wall: its front is the smallest x of the modules' fronts
    const runFront = Math.min(...run.map((i) => i.x - i.depth / 2));
    const runnerEast = runner.x + Math.min(runner.width, runner.depth) / 2;
    expect(runFront - runnerEast).toBeGreaterThanOrEqual(0);
    expect(runFront - runnerEast).toBeLessThan(0.2);
  });
});

describe('bedroom and ceiling light as a designer lays them (#443)', () => {
  it('a 160×230 rug lies across a double bed, from just below the nightstands, out on both sides', () => {
    const room = rectRoom(4, 4, { doors: [{ wall: 'S', at: 3.4 }] });
    const p = program(room, [item('bed', 'generic-bed-140', [2, 1.05, S]), item('rug', 'generic-rug-160')], [{ kind: 'under-all', item: 'rug', target: 'bed' }]);
    const layout = solveRoom(room, p, { seed: 1 });
    const bed = byId(layout, 'bed');
    const rug = byId(layout, 'rug');
    const across = Math.abs(Math.sin(rug.rotation - bed.rotation)) < 0.1 ? Math.max(rug.width, rug.depth) : Math.min(rug.width, rug.depth);
    expect(across).toBeGreaterThan(2.2);
    // head at the north wall: the rug starts 30–70 cm below it and ends past the foot
    const top = rug.y - Math.min(rug.width, rug.depth) / 2;
    expect(top - (bed.y - bed.depth / 2)).toBeGreaterThanOrEqual(0.29);
    expect(top - (bed.y - bed.depth / 2)).toBeLessThanOrEqual(0.71);
    expect(rug.y + Math.min(rug.width, rug.depth) / 2).toBeGreaterThan(bed.y + bed.depth / 2);
  });

  it('the only ceiling light hangs in the middle of the room, a pendant over the table stays there', () => {
    const room = rectRoom(4, 3, { doors: [{ wall: 'S', at: 3.4 }] });
    const alone = solveRoom(room, program(room, [item('light', 'generic-pendant', [0.8, 0.8, S])]), { seed: 1 });
    expect(byId(alone, 'light').x).toBeCloseTo(2, 1);
    expect(byId(alone, 'light').y).toBeCloseTo(1.5, 1);
    const dining = solveRoom(room, program(room, [item('table', 'generic-dining-table-4', [1, 1, S]), item('light', 'generic-pendant', [1, 1, S])]), { seed: 1 });
    expect(Math.hypot(byId(dining, 'light').x - 1, byId(dining, 'light').y - 1)).toBeLessThan(0.3);
  });
});

describe('what is left out', () => {
  it('the pendant of a table that does not fit is left out with it', () => {
    const room = rectRoom(2.2, 1.6, { doors: [{ wall: 'S', at: 1.1 }] });
    const p = program(room, [item('table', 'generic-dining-table-6', [1.1, 0.8, S]), item('pendant', 'generic-pendant')], [{ kind: 'above', item: 'pendant', target: 'table' }]);
    const layout = solveRoom(room, p, { seed: 1 });
    expect(layout.items.map((i) => i.id)).not.toContain('pendant');
    expect(layout.dropped.find((d) => d.id === 'pendant')?.reason).toMatch(/gehört zu/);
  });
});

describe('the seating group holds together (#436)', () => {
  it('an armchair at the end of the coffee table turns to it', () => {
    const room = rectRoom(5.5, 4.5, { doors: [{ wall: 'S', at: 4.8 }], windows: [{ wall: 'N', at: 1.5 }] });
    const layout = solveRoom(
      room,
      program(
        room,
        [item('sofa', 'generic-sofa-3', [1.6, 3.9, N]), item('ct', 'generic-coffee-table', [1.6, 2.9, N]), item('chair', 'generic-armchair', [3.2, 2.9, N]), item('board', 'generic-tv-sideboard', [3.5, 0.3, S]), item('tv', 'generic-tv', [3.5, 0.1, S])],
        [
          { kind: 'wall', item: 'sofa', wall: 'W3' },
          { kind: 'front-of', item: 'ct', target: 'sofa', gap: 0.45 },
          { kind: 'flank', item: 'chair', target: 'ct', gap: 0.4 },
          { kind: 'wall', item: 'board', wall: 'W1' },
          { kind: 'above', item: 'tv', target: 'board' },
          { kind: 'facing', item: 'board', target: 'sofa' },
        ],
      ),
      { seed: 3 },
    );
    expect(layout.unsolved).toEqual([]);
    expect(layout.dropped).toEqual([]);
    const sofa = byId(layout, 'sofa');
    const ct = byId(layout, 'ct');
    const chair = byId(layout, 'chair');
    // the chair looks at the table, from its end, 40 cm away
    expect(angleTo(chair, ct)).toBeLessThan(25);
    const along = Math.abs((chair.x - ct.x) * Math.cos(ct.rotation) + (chair.y - ct.y) * Math.sin(ct.rotation));
    expect(Math.abs(along - (0.55 + 0.4 + 0.41))).toBeLessThan(0.03);
    // the screen stays turned to the sofa; centring it is the walk-through's job (C3), a cost for it turned free sofas away (#436)
    expect(angleTo(byId(layout, 'board'), sofa)).toBeLessThan(45);
  });
});

describe('a tight living room keeps its seating group (#436)', () => {
  it('leaves out a shelf or the sideboard before the coffee table in front of the sofa', () => {
    // 3.4 × 2.5 m, door in the south wall: sofa, coffee table, TV board opposite and two shelves do not all fit
    const room = rectRoom(3.4, 2.5, { doors: [{ wall: 'S', at: 0.6 }] });
    const layout = solveRoom(
      room,
      program(
        room,
        [item('sofa', 'generic-sofa-3', [1.9, 2.05, N]), item('ct', 'generic-coffee-table', [1.9, 1.9, N]), item('board', 'generic-tv-sideboard', [1.9, 0.25, S]), item('shelf1', 'generic-shelf-80', [0.2, 1.2, S]), item('shelf2', 'generic-shelf-80', [3.2, 1.2, S])].map((i) => (i.id === 'sofa' ? { ...i, required: true } : i)),
        [
          { kind: 'wall', item: 'sofa', wall: 'W3' },
          { kind: 'front-of', item: 'ct', target: 'sofa', gap: 0.45 },
          { kind: 'wall', item: 'board', wall: 'W1' },
          { kind: 'facing', item: 'board', target: 'sofa' },
        ],
      ),
      { seed: 3 },
    );
    expect(layout.items.some((i) => i.id === 'ct')).toBe(true);
  });
});
