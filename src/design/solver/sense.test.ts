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
import { boxCorners, overlapDepth } from './geom';
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

describe('pictures hang at eye height over their piece (R7)', () => {
  it('a picture over the sideboard: middle near 1.5 m, 15–30 cm above the top', () => {
    const room = rectRoom(4.5, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 2.2 }] });
    const p = program(room, [item('board', 'generic-sideboard', [4.2, 2.0, Math.PI / 2]), item('art', 'generic-picture-large')], [{ kind: 'above', item: 'art', target: 'board' }]);
    const layout = solveRoom(room, p, { seed: 2 });
    const art = byId(layout, 'art');
    const board = byId(layout, 'board');
    const gap = art.elevation - board.height;
    expect(gap).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(gap).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(art.elevation + art.height / 2).toBeGreaterThan(1.35);
  });

  it('over a sofa standing free in the room: the picture on the wall hangs at eye height, not at „over the sofa“', () => {
    const room = rectRoom(5, 4.5, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 2.5 }] });
    const p = program(room, [item('sofa', 'generic-sofa-3', [2.5, 2.3, S]), item('art', 'generic-picture-wide')], [
      { kind: 'center', item: 'sofa' },
      { kind: 'above', item: 'art', target: 'sofa', height: 1.0 },
    ]);
    const layout = solveRoom(room, p, { seed: 2 });
    const art = byId(layout, 'art');
    const sofa = byId(layout, 'sofa');
    const apart = Math.hypot(art.x - sofa.x, art.y - sofa.y) - sofa.depth / 2;
    expect(apart, 'the sofa stands free').toBeGreaterThan(0.6);
    expect(art.elevation + art.height / 2).toBeCloseTo(1.5, 2);
  });

  it('a picture on its own wall: middle at 1.5 m, not at 1.75 m like the catalogue height (image review r7)', () => {
    const room = rectRoom(4.5, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 2.2 }] });
    const p = program(room, [item('art', 'generic-picture-large')], [{ kind: 'wall', item: 'art', wall: 'W2' }]);
    const art = byId(solveRoom(room, p, { seed: 2 }), 'art');
    expect(art.elevation + art.height / 2).toBeCloseTo(1.5, 2);
  });
});

describe('curtains frame the window (image review r7)', () => {
  it('an open panel reaches at most 25 cm past the frame', () => {
    const room = rectRoom(4.5, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 2.2, width: 1.2 }] });
    const p = program(room, [item('c1', 'generic-curtain'), item('c2', 'generic-curtain')], [
      { kind: 'window', item: 'c1', window: 'F1', place: 'over' },
      { kind: 'window', item: 'c2', window: 'F1', place: 'over' },
    ]);
    const layout = solveRoom(room, p, { seed: 2 });
    for (const id of ['c1', 'c2']) {
      const c = byId(layout, id);
      // window on the north wall from 1.6 to 2.8 m: the panel's outer edge
      const outer = Math.max(1.6 - (c.x - c.width / 2), c.x + c.width / 2 - 2.8);
      expect(outer, id).toBeLessThanOrEqual(0.25 + 1e-6);
      expect(outer, id).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe('lamps where they light (image review r7/r9)', () => {
  const room = rectRoom(4.5, 4, { doors: [{ wall: 'S', at: 0.8 }], windows: [{ wall: 'N', at: 2.2 }] });
  it('the desk lamp stands on the left of the writer, alone and beside the desk set', () => {
    for (const extra of [false, true]) {
      const items = [item('desk', 'generic-desk', [0.4, 2.0, -Math.PI / 2]), item('lamp', 'generic-table-lamp'), ...(extra ? [item('set', 'generic-desk-set')] : [])];
      const rels = [{ kind: 'on' as const, item: 'lamp', target: 'desk' }, ...(extra ? [{ kind: 'on' as const, item: 'set', target: 'desk' }] : [])];
      const layout = solveRoom(room, program(room, items, rels), { seed: 2 });
      const desk = byId(layout, 'desk');
      const lamp = byId(layout, 'lamp');
      // the writer looks into the desk (against its front); their left is the desk's −x
      const u = (lamp.x - desk.x) * Math.cos(desk.rotation) + (lamp.y - desk.y) * Math.sin(desk.rotation);
      expect(u, extra ? 'with the desk set' : 'alone').toBeLessThan(-0.1);
    }
  });

  it('a mirror over the chest hangs above the lamp standing on it (image review r9)', () => {
    const p = program(room, [item('chest', 'generic-dresser', [4.2, 2.0, Math.PI / 2]), item('lamp', 'generic-table-lamp'), item('mirror', 'generic-mirror-round')], [
      { kind: 'on', item: 'lamp', target: 'chest' },
      { kind: 'above', item: 'mirror', target: 'chest', height: 1.1 },
    ]);
    const layout = solveRoom(room, p, { seed: 2 });
    const lamp = byId(layout, 'lamp');
    const mirror = byId(layout, 'mirror');
    expect(mirror.elevation).toBeGreaterThan(lamp.elevation + lamp.height);
    expect(mirror.elevation + mirror.height / 2).toBeLessThanOrEqual(1.75 + 1e-6);
  });

  it('a lamp and a vase on a nightstand stand side by side, not in each other (image review r10)', () => {
    const p = program(room, [item('bed', 'generic-bed-140', [2.25, 3.0, Math.PI]), item('ns', 'generic-nightstand'), item('lamp', 'generic-table-lamp'), item('vase', 'generic-vase')], [
      { kind: 'near', item: 'ns', target: 'bed', max: 1.2 },
      { kind: 'on', item: 'lamp', target: 'ns' },
      { kind: 'on', item: 'vase', target: 'ns' },
    ]);
    const layout = solveRoom(room, p, { seed: 2 });
    const lamp = byId(layout, 'lamp');
    const vase = byId(layout, 'vase');
    // together wider than the 42 cm top: they stand diagonally, the round shade passes the vase
    expect(Math.hypot(lamp.x - vase.x, lamp.y - vase.y)).toBeGreaterThanOrEqual((lamp.width + vase.width) / 2);
  });

  it('a reading rug does not lie on the rug of the seating group (image review r11)', () => {
    const p = program(room, [item('sofa', 'generic-sofa-3', [2.25, 3.5, Math.PI]), item('rug', 'generic-rug-200'), item('chair', 'generic-armchair', [1.0, 1.4, 0]), item('rug2', 'generic-rug-120')], [
      { kind: 'under-front', item: 'rug', target: 'sofa' },
      { kind: 'under-front', item: 'rug2', target: 'chair' },
    ]);
    const layout = solveRoom(room, p, { seed: 2 });
    const corners = (i: PlacedItem) => boxCorners({ x: i.x, y: i.y, hw: i.width / 2, hd: i.depth / 2, rotation: i.rotation });
    const rugs = layout.items.filter((i) => i.id === 'rug' || i.id === 'rug2');
    expect(rugs).toHaveLength(2);
    expect(overlapDepth(corners(rugs[0]), corners(rugs[1]))).toBeLessThan(0.02);
  });

  it('a pendant over the coffee table hangs at 1.9 m, not in the line of sight', () => {
    const p = program(room, [item('sofa', 'generic-sofa-3', [2.25, 3.5, Math.PI]), item('coffee', 'generic-coffee-table'), item('pendant', 'generic-pendant')], [
      { kind: 'front-of', item: 'coffee', target: 'sofa' },
      { kind: 'above', item: 'pendant', target: 'coffee', height: 1.6 },
    ]);
    expect(byId(solveRoom(room, p, { seed: 2 }), 'pendant').elevation).toBeCloseTo(1.9, 2);
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

  it('in an L kitchen the other run does not stand in front of the dishwasher (image review r10)', () => {
    const room = rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 1.2 }], windows: [{ wall: 'W', at: 1.75, width: 1.0 }] });
    const p: RoomProgram = {
      ...program(room, []),
      kitchen: [
        { wall: 'W1', from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, modules: ['generic-k-tall-60', 'generic-k-drawer-60', 'generic-k-base-60', 'generic-k-sink-80', 'generic-k-base-60', 'generic-k-dishwasher'] },
        { wall: 'W2', from: { x: 4, y: 0 }, to: { x: 4, y: 3.5 }, modules: ['generic-k-drawer-60', 'generic-k-oven', 'generic-k-base-60'] },
      ],
    };
    const layout = solveRoom(room, p, { seed: 1 });
    const dw = layout.items.find((i) => i.catalogId === 'generic-k-dishwasher')!;
    const other = layout.items.filter((i) => i.id.startsWith('kitchen2-') && /k-(drawer|oven|base)/.test(i.catalogId));
    // its door folds down 60 cm into the room: no module of the other run in that strip
    const front = { x0: dw.x - dw.width / 2, x1: dw.x + dw.width / 2, y0: dw.y + dw.depth / 2, y1: dw.y + dw.depth / 2 + 0.6 };
    const into = other.map((o) => Math.min(front.x1, o.x + o.depth / 2) - Math.max(front.x0, o.x - o.depth / 2) > 0.05 && Math.min(front.y1, o.y + o.width / 2) - Math.max(front.y0, o.y - o.width / 2) > 0.05);
    expect(Math.abs(Math.sin(dw.rotation)), 'dishwasher on the first run').toBeLessThan(0.01);
    expect(into).not.toContain(true);
  });

  it('a runner without a relation lies along the kitchen run in the work aisle, not across the room', () => {
    const room = runRoom(1.6);
    const p = { ...withRun(room, ['generic-k-fridge', 'generic-k-base-60', 'generic-k-sink-80', 'generic-k-drawer-60', 'generic-k-base-60', 'generic-k-base-40']), items: [item('laeufer', 'generic-runner', [2.0, 2.2, Math.PI / 2])] };
    for (const seed of [1, 2]) {
      const runner = byId(solveRoom(room, p, { seed }), 'laeufer');
      // long side along the run (x), right in front of the 60 cm deep modules
      const ex = Math.abs(Math.cos(runner.rotation)) * runner.width + Math.abs(Math.sin(runner.rotation)) * runner.depth;
      expect(ex, `seed ${seed} ${JSON.stringify(runner)}`).toBeGreaterThan(1.9);
      expect(runner.y, `seed ${seed}`).toBeLessThan(0.6 + 0.4 + 0.15);
    }
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
  it.each(['generic-bed-140', 'generic-bed-160'])('a 160×230 rug lies across a double bed (%s), from just below the nightstands, out on both sides', (bedId) => {
    const room = rectRoom(4, 4, { doors: [{ wall: 'S', at: 3.4 }] });
    const p = program(room, [item('bed', bedId, [2, 1.05, S]), item('rug', 'generic-rug-160')], [{ kind: 'under-all', item: 'rug', target: 'bed' }]);
    const layout = solveRoom(room, p, { seed: 1 });
    const bed = byId(layout, 'bed');
    const rug = byId(layout, 'rug');
    // extent of the rug along the bed's width and along its length (the item's width runs along its own x axis)
    const turned = Math.abs(Math.sin(rug.rotation - bed.rotation)) > 0.5;
    const across = turned ? rug.depth : rug.width;
    const along = turned ? rug.width : rug.depth;
    expect(across).toBeGreaterThan(2.2);
    expect(across - bed.width).toBeGreaterThan(0.6);
    // head at the north wall: the rug starts 30–70 cm below it and ends past the foot
    const top = rug.y - along / 2;
    expect(top - (bed.y - bed.depth / 2)).toBeGreaterThanOrEqual(0.29);
    expect(top - (bed.y - bed.depth / 2)).toBeLessThanOrEqual(0.71);
    expect(rug.y + along / 2).toBeGreaterThan(bed.y + bed.depth / 2);
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

describe('a rug that reaches past its piece (D5)', () => {
  const bedroom = (w: number, d: number) => rectRoom(w, d, { doors: [{ wall: 'S', at: 0.6 }], windows: [{ wall: 'O', at: d / 2 }] });
  const bedRug = (room: RoomAnalysis) =>
    program(room, [item('bed', 'generic-bed-160', [room.size.x / 2, 1.1, 0]), item('rug', 'generic-rug-160')], [{ kind: 'under-all', item: 'rug', target: 'bed' }]);

  it('a plain 160×230 under a 160 bed (32 cm out each side) becomes the 200×300 where it fits, without counting as a smaller variant', () => {
    const room = bedroom(4.6, 4);
    const layout = solveRoom(room, bedRug(room), { seed: 3 });
    const rug = byId(layout, 'rug');
    expect(rug.catalogId).toBe('generic-rug-200');
    expect(rug.replaces).toBeUndefined();
  });

  it('the rug under the bed keeps out of the door swing where another of its places does (D5: the door catches on it; flat B)', () => {
    const { room, layout } = recorded('B', 'Schlafzimmer');
    const rug = layout.items.find((i) => i.catalogId.includes('rug'))!;
    const c = Math.cos(rug.rotation);
    const s = Math.sin(rug.rotation);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: rug.x + (a * rug.width * c) / 2 - (b * rug.depth * s) / 2, y: rug.y + (a * rug.width * s) / 2 + (b * rug.depth * c) / 2 }));
    const swings = room.walls.flatMap((w) => w.openings).flatMap((o) => (o.swing ? [o.swing] : []));
    expect(swings.length).toBeGreaterThan(0);
    for (const sw of swings) expect(overlapDepth(corners, sw)).toBeLessThan(2e-3);
  });

  it('in a room too narrow for the bigger rug the planned one stays', () => {
    const room = bedroom(2.9, 3.6);
    const layout = solveRoom(room, bedRug(room), { seed: 3 });
    expect(byId(layout, 'rug').catalogId).toBe('generic-rug-160');
  });
});
