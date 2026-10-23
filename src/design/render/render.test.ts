import { describe, expect, it } from 'vitest';
import { derivePlan } from '../../model/derived';
import { pointInPolygon, type Vec2 } from '../../model/vec';
import type { RoomType } from '../../suggest/furnishing';
import { analyzeFlat } from '../analysis';
import { FLAT_KEYS, TEST_FLATS, type FlatKey } from '../fixtures/flats';
import heute from '../review/fixtures/heute.json';
import { reviewFlat, type ReviewInput } from '../review';
import { rectRoom } from '../review/testkit';
import type { PlacedItem, RoomProgram } from '../types';
import { LabelLayer } from './labels';
import { roomPlanSvg, roomTextMap, svgToPng, type RoomPlanInput } from './index';

type Recorded = { type: string; items: Omit<PlacedItem, 'id' | 'zone'>[] };

function flat(key: FlatKey) {
  const project = TEST_FLATS[key].build();
  const analysis = analyzeFlat(project, derivePlan(project));
  const names = Object.fromEntries(project.rooms.map((r) => [r.id, r.name]));
  const existing = (poly: Vec2[]): PlacedItem[] =>
    project.furniture
      .filter((f) => f.existing && pointInPolygon(f, poly))
      .map((f) => ({ id: f.id, catalogId: f.catalogId ?? '', zone: 'bestand', x: f.x, y: f.y, rotation: f.rotation, elevation: f.elevation, width: f.width, depth: f.depth, height: f.height }));
  return { project, analysis, names, existing };
}

/** The proposal of the old flow for A or B (review/fixtures/heute.json) as input of the walk-through. */
function heuteInputs(key: 'A' | 'B'): { inputs: ReviewInput[]; names: Record<string, string> } {
  const f = flat(key);
  const recorded = (heute as unknown as Record<string, Record<string, Recorded>>)[key];
  const inputs = f.analysis.rooms.map((room) => {
    const rec = recorded[room.name];
    const items: PlacedItem[] = rec.items.map((i, n) => ({ ...i, id: `${room.roomId}-${n}`, zone: 'heute' }));
    return { analysis: room, type: rec.type as RoomType, layout: { roomId: room.roomId, items, dropped: [], cost: 0, unsolved: [], seed: 0 }, existing: f.existing(room.polygon) };
  });
  return { inputs, names: f.names };
}

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');
const all = (doc: Document, sel: string) => [...doc.querySelectorAll(sel)];

describe('Raumbild (render/)', () => {
  for (const key of FLAT_KEYS)
    it(`draws every empty room of test flat ${key}: walls, openings, ways, labels inside the image`, () => {
      const f = flat(key);
      for (const room of f.analysis.rooms) {
        const plan = roomPlanSvg({ analysis: room, existing: f.existing(room.polygon), roomNames: f.names });
        const doc = parse(plan.svg);
        expect(doc.querySelector('parsererror'), room.name).toBeNull();
        expect(plan.svg, room.name).not.toMatch(/NaN|Infinity|undefined/);
        expect(Math.max(plan.width, plan.height), room.name).toBeLessThanOrEqual(1600);
        const labels = new Set(all(doc, '[data-label]').map((e) => e.getAttribute('data-label')));
        for (const w of room.walls) {
          expect(labels.has(w.id), `${room.name} ${w.id}`).toBe(true);
          for (const o of w.openings) expect(labels.has(o.id), `${room.name} ${o.id}`).toBe(true);
        }
        expect(all(doc, '[data-opening]').length).toBe(room.walls.reduce((n, w) => n + w.openings.length, 0));
        // in the empty room every way fits, as wide as stage 0 measured it
        expect(all(doc, '[data-way="ok"], [data-way="narrow"]').length, room.name).toBe(room.walkways.length);
        expect(all(doc, '[data-way="blocked"]').length).toBe(0);
        for (const t of all(doc, 'text')) {
          const x = Number(t.getAttribute('x'));
          const y = Number(t.getAttribute('y'));
          expect(x >= 0 && x <= plan.width && y >= 0 && y <= plan.height, `${room.name}: ${t.textContent}`).toBe(true);
        }
        if (room.mainDoor) expect(doc.querySelector(`[data-main-door="${room.mainDoor}"]`)).not.toBeNull();
      }
    });

  it('shows the old proposal of the living kitchen B: blocked ways, the pieces and the findings where they are', () => {
    const { inputs, names } = heuteInputs('B');
    const review = reviewFlat(inputs);
    const k = inputs.findIndex((i) => i.analysis.name === 'Wohnküche');
    const input: RoomPlanInput = { ...inputs[k], review: review.rooms[k], roomNames: names };
    const plan = roomPlanSvg(input);
    const doc = parse(plan.svg);
    expect(all(doc, '[data-way="blocked"]').length).toBe(3);
    expect(plan.ways.every((w) => w.fits === 0)).toBe(true);
    expect(all(doc, '[data-item]').length).toBe(inputs[k].layout.items.length + (input.existing?.length ?? 0));
    const marks = all(doc, '[data-finding]');
    expect(marks.length).toBe(review.rooms[k].findings.filter((f) => f.where).length);
    expect(marks.filter((m) => m.getAttribute('data-severity') === 'S').length).toBeGreaterThanOrEqual(3);
    expect(plan.svg).toContain('nicht bestanden');
    // door labels name the room behind them
    expect(doc.querySelector('[data-label="T1"]')!.textContent).toBe('T1 Balkon');
    expect(doc.querySelector('[data-label="T3"]')!.textContent).toBe('T3 Vorraum');
  });

  it('draws the zones of the programme and labels the pieces with their ids', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'W', at: 1, width: 0.9 }], windows: [{ wall: 'S', at: 2.5, width: 1.4 }] });
    const program: RoomProgram = {
      roomId: room.roomId,
      reading: '',
      zones: [
        { id: 'sitzen', function: 'Sitzen', rect: { x0: 1.5, y0: 1.5, x1: 5, y1: 4 }, why: '' },
        { id: 'lesen', function: 'Lesen', rect: { x0: 0, y0: 2.5, x1: 1.5, y1: 4 }, why: '' },
      ],
      items: [
        { id: 'sofa', catalogId: 'generic-sofa-3', zone: 'sitzen', why: '' },
        { id: 'coffee', catalogId: 'generic-coffee-table', zone: 'sitzen', why: '' },
      ],
      relations: [],
      walk: '',
      check: [],
    };
    const items: PlacedItem[] = [
      { id: 'sofa', catalogId: 'generic-sofa-3', zone: 'sitzen', x: 3.2, y: 3.5, rotation: Math.PI, elevation: 0, width: 2.1, depth: 0.9, height: 0.85 },
      { id: 'coffee', catalogId: 'generic-coffee-table', zone: 'sitzen', x: 3.2, y: 2.5, rotation: Math.PI, elevation: 0, width: 1.1, depth: 0.6, height: 0.45, parent: 'sofa' },
    ];
    const plan = roomPlanSvg({ analysis: room, program, layout: { roomId: room.roomId, items, dropped: [], cost: 0, unsolved: [], seed: 1 } });
    const doc = parse(plan.svg);
    expect(all(doc, '[data-zone]').map((z) => z.getAttribute('data-zone'))).toEqual(['sitzen', 'lesen']);
    expect(doc.querySelector('[data-label="sofa"]')!.textContent).toBe('sofa');
    expect(doc.querySelector('[data-label="coffee"]')!.textContent).toBe('coffee');
    expect(doc.querySelector('[data-label="sitzen"]')).not.toBeNull();
    expect(doc.querySelector('[data-item="sofa"]')!.getAttribute('transform')).toContain('rotate(180)');
  });

  it('puts a label at its next place when the first is taken, and keeps it inside the image', () => {
    const layer = new LabelLayer({ x0: 0, y0: 0, x1: 200, y1: 100 });
    const a = layer.place('Sofa', 11, false, [{ x: 50, y: 50 }]);
    const b = layer.place('Tisch', 11, false, [
      { x: 52, y: 50 },
      { x: 195, y: 50 },
      { x: 50, y: 80 },
    ]);
    expect(a.free).toBe(true);
    expect(b).toMatchObject({ x: 50, y: 80, free: true });
  });

  it('writes the same as text: pieces with place and front, kitchen run, ways and findings', () => {
    const { inputs, names } = heuteInputs('B');
    const review = reviewFlat(inputs);
    const k = inputs.findIndex((i) => i.analysis.name === 'Wohnküche');
    const text = roomTextMap({ ...inputs[k], review: review.rooms[k], roomNames: names });
    expect(text).toMatch(/\(Sofa 3-Sitzer\), 210 × 90 cm, Mitte \(\d+,\d+\), Rücken an W3, Front nach N/);
    expect(text).toMatch(/Küchenzeile an W2: Kühlschrank 60, .*Spüle 80/);
    expect(text.match(/versperrt, kein Durchkommen/g)).toHaveLength(3);
    expect(text).toContain('Begehung: 0 Punkte, nicht bestanden.');
    expect(text).toMatch(/- \[schwer\] B4: .*\(bei x=\d+, y=\d+\)/);
    // whole cm only, as in the room sketch
    expect(text).not.toMatch(/\d\.\d+ cm|\(\d+\.\d/);
  });

  it('keeps the drawings of two rooms as snapshots to look at', async () => {
    const { inputs, names } = heuteInputs('B');
    const k = inputs.findIndex((i) => i.analysis.name === 'Wohnküche');
    await expect(roomPlanSvg({ ...inputs[k], roomNames: names }).svg).toMatchFileSnapshot('__snapshots__/plan-B-Wohnkueche-heute.svg');
    await expect(roomTextMap({ ...inputs[k], roomNames: names })).toMatchFileSnapshot('__snapshots__/textmap-B-Wohnkueche-heute.txt');
    const e = flat('E');
    const living = e.analysis.rooms.find((r) => r.name === 'Wohnzimmer')!;
    await expect(roomPlanSvg({ analysis: living, roomNames: e.names }).svg).toMatchFileSnapshot('__snapshots__/plan-E-Wohnzimmer-leer.svg');
  });

  it('gives up on the PNG with a clear message where no browser draws it', async () => {
    const plan = roomPlanSvg({ analysis: rectRoom(3, 3) });
    await expect(svgToPng(plan, { timeoutMs: 50 })).rejects.toThrow(/Raumbild|Browser/);
  });

  it('draws a room in a few milliseconds', () => {
    const { inputs, names } = heuteInputs('A');
    const review = reviewFlat(inputs);
    const t0 = performance.now();
    inputs.forEach((inp, k) => roomPlanSvg({ ...inp, review: review.rooms[k], roomNames: names }));
    expect((performance.now() - t0) / inputs.length).toBeLessThan(50);
  });
});
