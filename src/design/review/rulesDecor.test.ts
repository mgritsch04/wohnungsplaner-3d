import { describe, expect, it } from 'vitest';
import type { RoomProgram } from '../types';
import { put, rectRoom, review, rulesOf, type Scenario } from './testkit';

const living = (items: ReturnType<typeof put>[], extra: Partial<Scenario> = {}) =>
  review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'N', at: 2.5 }] }), type: 'living', items, ...extra });
const has = (r: ReturnType<typeof review>, rule: string, text?: RegExp) => r.findings.some((f) => f.rule === rule && (!text || text.test(f.text)));
const prog = (p: Partial<RoomProgram>): RoomProgram => ({ roomId: 'room_test', reading: '', zones: [], items: [], relations: [], walk: '', check: [], ...p });
const sofa = put('generic-sofa-3', { x: 2.5, y: 3.5, face: 'N', id: 'sofa' });

describe('D1 / D2 Pflanzen', () => {
  it('a large plant in a corner, beside a piece or at the window is fine, free in the room is medium', () => {
    expect(has(living([sofa, put('generic-plant', { x: 0.3, y: 0.3 })]), 'D1')).toBe(false);
    expect(has(living([sofa, put('generic-plant', { x: 4.1, y: 3.5 })]), 'D1')).toBe(false); // beside the sofa
    expect(has(living([sofa, put('generic-plant', { x: 2.5, y: 0.5 })]), 'D1')).toBe(false); // at the window
    expect(has(living([sofa, put('generic-plant', { x: 3.0, y: 1.8 })]), 'D1', /frei im Raum/)).toBe(true);
  });
  it('a plant on the way between two doors is severe in every room', () => {
    const hall = (type: 'hall' | 'other') => review({ room: rectRoom(1.2, 4, { doors: [{ wall: 'S', at: 0.6, width: 0.8 }, { wall: 'N', at: 0.6, width: 0.8 }], passThrough: true }), type, items: [put('generic-plant', { x: 0.6, y: 2 })] });
    expect(hall('hall').findings.find((f) => f.rule === 'D1' && /im Weg/.test(f.text))?.severity).toBe('S');
    expect(hall('other').findings.find((f) => f.rule === 'D1' && /im Weg/.test(f.text))?.severity).toBe('S');
    const corner = review({ room: rectRoom(1.2, 4, { doors: [{ wall: 'S', at: 0.6, width: 0.8 }, { wall: 'N', at: 0.6, width: 0.8 }], passThrough: true }), type: 'hall', items: [put('generic-plant-small', { x: 1.0, y: 2, elevation: 0.8 })] });
    expect(has(corner, 'D1')).toBe(false);
  });
  it('a big plant in a room without windows is light', () => {
    const r = review({ room: rectRoom(3, 3, { doors: [{ wall: 'S', at: 1.5 }] }), type: 'other', items: [put('generic-plant', { x: 0.3, y: 0.3 })] });
    expect(r.findings.find((f) => f.rule === 'D1')?.severity).toBe('L');
  });
  it('D2 a small plant or box on the floor is medium, on a sideboard it is fine', () => {
    expect(has(living([sofa, put('generic-plant-small', { x: 0.3, y: 0.3 })]), 'D2')).toBe(true);
    expect(has(living([sofa, put('generic-sideboard', { x: 3.3, y: 0.225, face: 'S', id: 'sb' }), put('generic-plant-small', { x: 3.3, y: 0.225, elevation: 0.8, parent: 'sb' })]), 'D2')).toBe(false);
    expect(has(living([sofa, put('generic-storage-box', { x: 4.5, y: 2 })]), 'D2')).toBe(true);
    expect(has(living([sofa, put('generic-shelf-cube', { x: 4.7, y: 1.5, face: 'W', id: 'sh' }), put('generic-storage-box', { x: 4.7, y: 1.5, elevation: 0.5, parent: 'sh' })]), 'D2')).toBe(false);
  });
});

describe('D3 / D4 Licht', () => {
  it('a table lamp stands on a nightstand, sideboard or desk, not on the dining table or the floor', () => {
    const sb = put('generic-sideboard', { x: 3.3, y: 0.225, face: 'S', id: 'sb' });
    expect(has(living([sofa, sb, put('generic-table-lamp', { x: 3.3, y: 0.225, parent: 'sb', elevation: 0.8 })]), 'D3')).toBe(false);
    const table = put('generic-dining-table-4', { x: 2.5, y: 1.8, face: 'S', id: 't' });
    expect(has(living([sofa, table, put('generic-table-lamp', { x: 2.5, y: 1.8, parent: 't', elevation: 0.75 })]), 'D3', /Esstisch|stört/)).toBe(true);
    expect(has(living([sofa, put('generic-table-lamp', { x: 4.5, y: 2.5, elevation: 0 })]), 'D3', /frei/)).toBe(true);
  });
  it('a desk without a lamp is light', () => {
    const office = (lamp: boolean) => review({ room: rectRoom(3, 3, { doors: [{ wall: 'W', at: 1.5 }], windows: [{ wall: 'O', at: 1.5 }] }), type: 'office', items: [put('generic-desk', { x: 1.5, y: 2.65, face: 'N' }), put('generic-office-chair', { x: 1.5, y: 1.9, face: 'S' }), ...(lamp ? [put('generic-floor-lamp', { x: 2.5, y: 2.7 })] : [])] });
    expect(has(office(false), 'D4', /Schreibtisch/)).toBe(true);
    expect(has(office(true), 'D4', /Schreibtisch/)).toBe(false);
  });
  it('a dining table without pendant, a reading corner without lamp and a big room with one light', () => {
    const dining = (pendant: boolean) =>
      review({ room: rectRoom(4, 3, { doors: [{ wall: 'W', at: 1.5 }] }), type: 'dining', items: [put('generic-dining-table-4', { x: 2, y: 1.5, face: 'S' }), put('generic-chair', { x: 1.6, y: 0.915, face: 'S' }), put('generic-chair', { x: 2.4, y: 0.915, face: 'S' }), ...(pendant ? [put('generic-pendant', { x: 2, y: 1.5 })] : [])] });
    expect(has(dining(false), 'D4', /Pendelleuchte/)).toBe(true);
    expect(has(dining(true), 'D4', /Pendelleuchte/)).toBe(false);
    // outside there is no ceiling for a pendant
    const balcony = review({ room: rectRoom(3, 1.5, { doors: [{ wall: 'S', at: 0.5 }] }), type: 'balcony', items: [put('generic-balcony-table', { x: 1, y: 0.75 }), put('generic-balcony-chair', { x: 0.5, y: 0.75, face: 'O' }), put('generic-balcony-chair', { x: 1.5, y: 0.75, face: 'W' })] });
    expect(has(balcony, 'D4')).toBe(false);
    const zone = { id: 'lesen', function: 'Leseecke', rect: { x0: 3.8, y0: 2.2, x1: 5, y1: 3.4 }, why: '' };
    expect(has(living([sofa, put('generic-armchair', { x: 4.4, y: 2.8, face: 'W' })], { program: prog({ zones: [zone] }) }), 'D4', /Leseecke/)).toBe(true);
    expect(has(living([sofa, put('generic-armchair', { x: 4.4, y: 2.8, face: 'W' }), put('generic-floor-lamp', { x: 4.7, y: 3.2 })], { program: prog({ zones: [zone] }) }), 'D4', /Leseecke/)).toBe(false);
    expect(has(living([sofa, put('generic-floor-lamp', { x: 4.7, y: 3.2 })]), 'D4', /nur eine Lichtquelle/)).toBe(true);
    expect(has(living([sofa, put('generic-floor-lamp', { x: 4.7, y: 3.2 }), put('generic-pendant', { x: 2.5, y: 2 })]), 'D4', /Lichtquelle/)).toBe(false);
  });
});

describe('D5 Teppich', () => {
  const rugRoom = (rugY: number) => living([sofa, put('generic-coffee-table', { x: 2.5, y: 2.3, face: 'N' }), put('generic-rug-160', { x: 2.5, y: rugY, face: 'N' })]);
  it('the sofa stands with its front feet on the rug', () => {
    expect(has(rugRoom(2.6), 'D5')).toBe(false);
    expect(has(rugRoom(1.5), 'D5', /Vorderfüßen/)).toBe(true);
  });
  it('a bed rug sticks out 40 cm at the sides', () => {
    const bed = (w: number) => review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'bedroom', items: [put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W' }), put('generic-rug-160', { x: 2.5, y: 1.6, face: 'W', width: w, depth: 2.3 })] });
    expect(has(bed(1.6), 'D5', /Bett/)).toBe(true);
    expect(has(bed(2.4), 'D5', /Bett/)).toBe(false);
  });
  it('a rug in a door swing is light', () => {
    const r = review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'other', items: [put('generic-rug-160', { x: 0.8, y: 3.0 })] });
    expect(has(r, 'D5', /Tür/)).toBe(true);
    expect(has(review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'other', items: [put('generic-rug-160', { x: 3.0, y: 1.5 })] }), 'D5')).toBe(false);
  });
  it('a runner lies in the middle of the hall', () => {
    const hall = (x: number) => review({ room: rectRoom(1.4, 4, { doors: [{ wall: 'S', at: 0.7 }, { wall: 'N', at: 0.7 }] }), type: 'hall', items: [put('generic-runner', { x, y: 2 })] });
    expect(has(hall(0.7), 'D5', /Mitte/)).toBe(false);
    expect(has(hall(0.5), 'D5', /Mitte/)).toBe(true);
  });
});

describe('D6 Bild und Spiegel', () => {
  const pic = (x: number, id: string, w?: number) => put(id, { x, y: 3.97, face: 'N', elevation: 1.3, parent: 'sofa', ...(w ? { width: w } : {}) });
  it('a picture above the sofa is centred and 40–90 % of its width', () => {
    expect(has(living([sofa, pic(2.5, 'generic-picture-large')]), 'D6')).toBe(false);
    expect(has(living([sofa, pic(2.9, 'generic-picture-large')]), 'D6', /neben der Mitte/)).toBe(true);
    expect(has(living([sofa, pic(2.5, 'generic-picture')]), 'D6', /zu klein/)).toBe(true);
    expect(has(living([sofa, pic(2.5, 'generic-picture-large', 2.0)]), 'D6', /zu breit/)).toBe(true);
  });
  it('a picture over a window or a door is light', () => {
    expect(has(living([sofa, put('generic-picture', { x: 2.5, y: 0.02, face: 'S', elevation: 1.35 })]), 'D6', /Fenster/)).toBe(true);
    expect(has(living([sofa, put('generic-picture', { x: 1.0, y: 3.98, face: 'N', elevation: 1.35 })]), 'D6', /Tür/)).toBe(true);
  });
  it('the bath mirror hangs above the washbasin', () => {
    const bath = (mx: number) => review({ room: rectRoom(2.5, 2.5, { doors: [{ wall: 'S', at: 1.25 }] }), type: 'bath', items: [put('generic-bath-mirror', { x: mx, y: 0.03, face: 'S' })], existing: [put('generic-washbasin', { x: 1.0, y: 0.25, face: 'S' }), put('generic-toilet', { x: 2.0, y: 0.3, face: 'S' })] });
    expect(has(bath(1.0), 'D6')).toBe(false);
    expect(has(bath(2.0), 'D6', /Badspiegel/)).toBe(true);
  });
});

describe('D7 Vorhang', () => {
  it('a curtain as wide as the window is fine, a narrow one is light', () => {
    const curtain = (w: number) => living([sofa, put('generic-curtain', { x: 2.5, y: 0.05, face: 'S', width: w })]);
    // the fabric counts, not how wide the open panel hangs
    const pair = living([sofa, put('generic-curtain', { x: 1.6, y: 0.05, face: 'S', width: 0.49 }), put('generic-curtain', { x: 3.4, y: 0.05, face: 'S', width: 0.49 })]);
    expect(has(pair, 'D7')).toBe(false);
    // one panel on one side: light, a pair frames the window
    expect(curtain(1.4).findings.some((f) => f.rule === 'D7' && /nur ein Vorhangschal/.test(f.text))).toBe(true);
    expect(has(curtain(0.8), 'D7')).toBe(true);
  });
  it('a bedroom without darkening when the user wants one', () => {
    const bedroom = (curtain: boolean) =>
      review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }], windows: [{ wall: 'N', at: 2 }] }), type: 'bedroom', options: { darkening: true }, items: [put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W' }), ...(curtain ? [put('generic-curtain', { x: 2, y: 0.05, face: 'S' })] : [])] });
    expect(has(bedroom(false), 'D7', /Verdunkelung/)).toBe(true);
    expect(has(bedroom(true), 'D7', /Verdunkelung/)).toBe(false);
  });
});

describe('D8 zu viel Gleiches', () => {
  it('more than one ceiling light per 6 m² in a hall', () => {
    const hall = (n: number) => review({ room: rectRoom(1.2, 4, { doors: [{ wall: 'S', at: 0.6 }] }), type: 'hall', items: Array.from({ length: n }, (_, k) => put('generic-pendant', { x: 0.6, y: 1 + k })) });
    expect(has(hall(2), 'D8')).toBe(true);
    expect(has(hall(1), 'D8')).toBe(false);
  });
  it('more than three pictures need a planned group', () => {
    const pics = ['a', 'b', 'c', 'd'].map((id, k) => put('generic-picture', { id, x: 1 + k * 0.7, y: 0.02, face: 'S', elevation: 1.4 }));
    expect(has(living([sofa, ...pics]), 'D8', /Bilder/)).toBe(true);
    expect(has(living([sofa, ...pics], { program: prog({ relations: [{ kind: 'align', items: ['a', 'b', 'c', 'd'] }] }) }), 'D8', /Bilder/)).toBe(false);
    expect(has(living([sofa, ...pics.slice(0, 3)]), 'D8', /Bilder/)).toBe(false);
  });
  it('three equal pieces without an order', () => {
    const shelves = ['a', 'b', 'c'].map((id, k) => put('generic-shelf-80', { id, x: 0.4 + k * 0.9, y: 0.15, face: 'S' }));
    expect(has(living([sofa, ...shelves]), 'D8', /ohne erkennbare Ordnung/)).toBe(true);
    expect(has(living([sofa, ...shelves], { program: prog({ relations: [{ kind: 'align', items: ['a', 'b', 'c'] }] }) }), 'D8', /ohne erkennbare Ordnung/)).toBe(false);
  });
});

describe('E Gesamteindruck', () => {
  it('E1 occupancy: too full and half-heartedly empty are medium', () => {
    expect(has(living([sofa]), 'E1', /halbherzig/)).toBe(true);
    expect(has(living([put('generic-sofa-corner', { x: 2.5, y: 3.1, face: 'N' }), put('generic-coffee-table', { x: 2.5, y: 1.8 })]), 'E1')).toBe(false);
    const full = [0, 1, 2].map((k) => put('generic-sofa-corner', { x: 1.3 + k * 1.4, y: 1 + k, face: 'N' }));
    expect(has(living(full), 'E1', /zu voll/)).toBe(true);
    expect(has(review({ room: rectRoom(1.2, 4, { doors: [{ wall: 'S', at: 0.6 }] }), type: 'hall', items: [put('generic-wardrobe-100', { x: 0.3, y: 1, face: 'O' }), put('generic-wardrobe-100', { x: 0.3, y: 2, face: 'O' })] }), 'E1', /zu voll/)).toBe(true);
  });
  it('E1 a living room with less than a fifth of its floor furnished is light: rather empty (#443)', () => {
    const group = [put('generic-sofa-3', { x: 2.5, y: 3.55, face: 'N' }), put('generic-coffee-table', { x: 2.5, y: 2.6 }), put('generic-armchair', { x: 4.3, y: 2.6, face: 'W' })];
    expect(living(group).findings.find((f) => f.rule === 'E1')?.severity).toBe('L');
  });
  it('E6 one half of the room almost empty, everything in the other is medium (#443)', () => {
    const bedroom = (items: ReturnType<typeof put>[]) => review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4.5 }], windows: [{ wall: 'N', at: 2.5 }] }), type: 'bedroom', items });
    const west = [put('generic-bed-160', { x: 1.1, y: 1.5, face: 'O' }), put('generic-wardrobe-150', { x: 1.5, y: 3.7, face: 'N' }), put('generic-nightstand', { x: 0.25, y: 0.3, face: 'O' })];
    expect(has(bedroom(west), 'E6', /östliche Hälfte/)).toBe(true);
    expect(has(bedroom([...west, put('generic-desk', { x: 4.6, y: 2, face: 'W' }), put('generic-office-chair', { x: 4.0, y: 2, face: 'O' }), put('generic-dresser', { x: 3.6, y: 0.25, face: 'S' })]), 'E6')).toBe(false);
  });
  it('E6 an open patch more than 3.6 m across, far from every piece, is medium (#443)', () => {
    const big = (items: ReturnType<typeof put>[]) => review({ room: rectRoom(7, 5, { doors: [{ wall: 'S', at: 6.5 }], windows: [{ wall: 'N', at: 3.5 }] }), type: 'living', items });
    const corner = [put('generic-sofa-3', { x: 1.2, y: 4.5, face: 'N' }), put('generic-shelf-80', { x: 6.5, y: 0.25, face: 'S' })];
    expect(has(big(corner), 'E6', /Durchmesser/)).toBe(true);
    const spread = [...corner, put('generic-coffee-table', { x: 1.2, y: 3.4 }), put('generic-dining-table-4', { x: 4.5, y: 2.5 }), put('generic-armchair', { x: 3.0, y: 1.0, face: 'S' }), put('generic-dresser', { x: 5.8, y: 4.75, face: 'N' }), put('generic-shelf-80', { x: 0.5, y: 0.15, face: 'S' })];
    expect(has(big(spread), 'E6', /Durchmesser/)).toBe(false);
  });
  it('D4 a sofa without a floor or table lamp beside it is light', () => {
    expect(has(living([sofa]), 'D4', /Neben/)).toBe(true);
    expect(has(living([sofa, put('generic-floor-lamp', { x: 3.9, y: 3.6 })]), 'D4', /Neben/)).toBe(false);
  });
  it('E2 a piece more than 1 m outside its zone, zones on top of each other', () => {
    const zones = [{ id: 'sitzen', function: 'Sitzgruppe', rect: { x0: 0, y0: 2, x1: 2, y1: 4 }, why: '' }];
    expect(has(living([put('generic-sofa-3', { x: 1.0, y: 3.5, face: 'N', zone: 'sitzen' })], { program: prog({ zones }) }), 'E2')).toBe(false);
    expect(has(living([put('generic-sofa-3', { x: 4.2, y: 3.5, face: 'N', zone: 'sitzen' })], { program: prog({ zones }) }), 'E2', /außerhalb/)).toBe(true);
    const overlapping = [...zones, { id: 'lesen', function: 'Leseecke', rect: { x0: 0.2, y0: 2.2, x1: 2, y1: 4 }, why: '' }];
    expect(has(living([sofa], { program: prog({ zones: overlapping }) }), 'E2', /überlappen/)).toBe(true);
  });
  it('E3 chairs without a table, equal shelves on different walls', () => {
    expect(has(living([sofa, put('generic-chair', { x: 4.5, y: 2 })]), 'E3', /Stühle/)).toBe(true);
    expect(has(living([sofa, put('generic-chair', { x: 4.5, y: 2 }), put('generic-dining-table-4', { x: 3.5, y: 2 })]), 'E3', /Stühle/)).toBe(false);
    const shelf = (id: string, x: number, y: number, face: 'S' | 'W') => put('generic-shelf-80', { id, x, y, face, zone: 'z' });
    expect(has(living([sofa, shelf('a', 1, 0.15, 'S'), shelf('b', 4.85, 2, 'W')]), 'E3', /verschiedenen Wänden/)).toBe(true);
    expect(has(living([sofa, shelf('a', 1, 0.15, 'S'), shelf('b', 2, 0.15, 'S')]), 'E3', /verschiedenen Wänden/)).toBe(false);
  });
  it('E4 a colour outside the palette is light, neutrals and palette colours fit', () => {
    const palette = ['#7d8a96', '#c8b59a'];
    const run = (color: string) => living([sofa], { palette, program: prog({ items: [{ id: 'sofa', catalogId: 'generic-sofa-3', zone: 'z', why: '', color }] }) });
    expect(has(run('#7a8a97'), 'E4')).toBe(false);
    expect(has(run('#f0f0f0'), 'E4')).toBe(false);
    expect(has(run('#d4202a'), 'E4')).toBe(true);
  });
  it('E5 the eye-catcher is hidden from the main door', () => {
    const bed = put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W' });
    const run = (blocker: boolean) => review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'bedroom', items: [bed, ...(blocker ? [put('generic-wardrobe-100', { x: 1.2, y: 2.6, face: 'N' })] : [])] });
    expect(has(run(true), 'E5')).toBe(true);
    expect(has(run(false), 'E5')).toBe(false);
  });
});

describe('Punkte und Kennzahlen', () => {
  it('a room with a severe finding does not pass', () => {
    const r = living([sofa, put('generic-wardrobe-100', { x: 1.0, y: 3.5, face: 'N' })]);
    expect(rulesOf(r, 'S')).toContain('B4');
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(100);
  });
  it('key figures: occupancy, walks and dropped pieces', () => {
    const room = rectRoom(4, 3, { doors: [{ wall: 'W', at: 1.5 }, { wall: 'O', at: 1.5 }] });
    const r = review({ room, type: 'other', items: [put('generic-sideboard', { x: 2, y: 1.5, face: 'W', width: 1.0 })], dropped: [{ id: 'x', catalogId: 'generic-sofa-3', reason: 'passt nicht' }] });
    expect(r.metrics.occupancy).toBeCloseTo(0.45 * 1.0 / 12, 3);
    expect(r.metrics.walkEmpty).toBeCloseTo(4, 1);
    expect(r.metrics.walkFurnished).toBeGreaterThan(r.metrics.walkEmpty);
    expect(r.metrics.dropped).toBe(1);
  });
  it('same input gives the same findings', () => {
    const items = [sofa, put('generic-wardrobe-100', { x: 1.0, y: 3.5, face: 'N', id: 'w' }), put('generic-plant', { x: 3, y: 1.8, id: 'p' })];
    expect(JSON.stringify(living(items).findings)).toBe(JSON.stringify(living(items).findings));
  });
  it('takes less than 100 ms for a furnished room', () => {
    const items = [
      sofa,
      put('generic-coffee-table', { x: 2.5, y: 2.3 }),
      put('generic-armchair', { x: 4.3, y: 2.5, face: 'W' }),
      put('generic-tv-sideboard', { x: 2.5, y: 0.21, face: 'S' }),
      put('generic-shelf-80', { x: 0.4, y: 0.15, face: 'S' }),
      put('generic-dining-table-6', { x: 1.5, y: 1.6, face: 'S' }),
      ...[0, 1, 2, 3].map((k) => put('generic-chair', { x: 1 + k * 0.45, y: 1.0, face: 'S' })),
      put('generic-plant', { x: 4.6, y: 0.4 }),
      put('generic-floor-lamp', { x: 4.6, y: 3.5 }),
      put('generic-pendant', { x: 1.5, y: 1.6 }),
    ];
    living(items);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) living(items);
    expect((performance.now() - t0) / 5).toBeLessThan(100);
  });
});
