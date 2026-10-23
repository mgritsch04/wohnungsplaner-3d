import { describe, expect, it } from 'vitest';
import { checkDoubles } from './functionRules';
import { RoomCtx } from './context';
import { layoutOf, put, rectRoom, review, rulesOf, type Put } from './testkit';
import { reviewFlat } from './index';

const room = (w = 4, d = 3.5) => rectRoom(w, d, { doors: [{ wall: 'S', at: d === 3.5 ? 3.2 : 3.2 }], windows: [{ wall: 'N', at: 2 }] });

/** A bedroom without findings: bed head at the east wall, wardrobe at the west wall, two lights. */
function bedroom(extra: ReturnType<typeof put>[] = [], skip: string[] = []) {
  const base = [
    put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W', id: 'bed' }),
    put('generic-wardrobe-150', { x: 0.3, y: 1.75, face: 'O', id: 'wardrobe' }),
    put('generic-pendant', { x: 2, y: 1.75, id: 'pendant' }),
    put('generic-floor-lamp', { x: 0.3, y: 0.3, id: 'lamp' }),
  ].filter((i) => !skip.includes(i.id));
  return review({ room: room(), type: 'bedroom', items: [...base, ...extra] });
}

describe('A Funktion', () => {
  it('A1 bedroom: a complete bedroom has no findings and passes', () => {
    const r = bedroom();
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
  });
  it('A1 bedroom: no bed is severe, no wardrobe in a big bedroom medium', () => {
    const r = bedroom([], ['bed']);
    expect(r.findings.find((f) => f.rule === 'A1')?.severity).toBe('S');
    expect(r.passed).toBe(false);
    expect(rulesOf(bedroom([], ['wardrobe']), 'M')).toContain('A1');
  });
  it('A1 living room needs seats for three', () => {
    const living = (items: ReturnType<typeof put>[]) => review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'N', at: 2.5 }] }), type: 'living', items });
    expect(rulesOf(living([put('generic-sofa-3', { x: 2.5, y: 3.5, face: 'N' })]))).not.toContain('A1');
    expect(rulesOf(living([put('generic-armchair', { x: 2.5, y: 3.5, face: 'N' })]), 'S')).toContain('A1');
  });
  it('A1 kitchen needs sink, hob, fridge and worktop; fitted pieces count', () => {
    const k = (ids: string[], existing: string[] = []) =>
      review({
        room: rectRoom(4, 3, { doors: [{ wall: 'W', at: 1.5 }], windows: [{ wall: 'O', at: 1.5 }] }),
        type: 'kitchen',
        items: ids.map((id, n) => put(id, { x: 0.4 + n * 0.7, y: 0.3, face: 'S' })),
        existing: existing.map((id) => put(id, { x: 3.5, y: 2.6, face: 'N' })),
      });
    const all = ['generic-k-fridge', 'generic-k-base-60', 'generic-k-sink-80', 'generic-k-cooktop'];
    expect(rulesOf(k(all))).not.toContain('A1');
    expect(k(all.filter((x) => !x.includes('sink'))).findings.some((f) => f.rule === 'A1' && /Spüle/.test(f.text))).toBe(true);
    expect(k(all.filter((x) => !x.includes('sink')), ['generic-k-sink-80']).findings.some((f) => f.rule === 'A1')).toBe(false);
  });
  it('A1 a living room with a kitchen run is checked like a kitchen; a wall cabinet over the washer is none', () => {
    const r = (type: Parameters<typeof review>[0]['type'], ids: string[]) =>
      review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'N', at: 2.5 }] }), type, items: ids.map((id, n) => put(id, { x: 0.4 + n * 0.7, y: 0.3, face: 'S' })) });
    const run = ['generic-k-fridge', 'generic-k-base-60', 'generic-k-sink-80', 'generic-k-oven', 'generic-sofa-3'];
    expect(r('living', run).findings.some((f) => f.rule === 'A1' && /Kochfeld/.test(f.text))).toBe(true);
    expect(r('living', [...run, 'generic-k-cooktop']).findings.some((f) => f.rule === 'A1')).toBe(false);
    expect(r('bath', ['generic-washer', 'generic-k-wall-60']).findings.some((f) => /Küche/.test(f.text))).toBe(false);
  });
  it('A1 dining, office, hall, kids, balcony and bath', () => {
    const r = (type: Parameters<typeof review>[0]['type'], items: ReturnType<typeof put>[], existing: ReturnType<typeof put>[] = [], area: [number, number] = [4, 3]) =>
      review({ room: rectRoom(area[0], area[1], { doors: [{ wall: 'S', at: 2 }] }), type, items, existing });
    expect(rulesOf(r('dining', [put('generic-dining-table-4', { x: 2, y: 1.5, face: 'S' })]), 'S')).toContain('A1');
    expect(
      rulesOf(
        r('dining', [put('generic-dining-table-4', { x: 2, y: 1.5, face: 'S' }), put('generic-chair', { x: 1.5, y: 0.8, face: 'S' }), put('generic-chair', { x: 2.5, y: 0.8, face: 'S' })]),
        'S',
      ),
    ).not.toContain('A1');
    expect(rulesOf(r('office', [put('generic-desk', { x: 2, y: 0.4, face: 'S' })]), 'S')).toContain('A1');
    expect(rulesOf(r('office', [put('generic-desk', { x: 2, y: 0.4, face: 'S' }), put('generic-office-chair', { x: 2, y: 1.1, face: 'N' })]), 'S')).not.toContain('A1');
    expect(rulesOf(r('hall', [], [], [3, 2]), 'S')).toContain('A1');
    expect(rulesOf(r('hall', [put('generic-coat-rack', { x: 1.5, y: 0.05, face: 'S' })], [], [3, 2]), 'S')).not.toContain('A1');
    expect(rulesOf(r('kids', []), 'S')).toContain('A1');
    expect(rulesOf(r('kids', [put('generic-bed-90', { x: 0.5, y: 1.2, face: 'O' }), put('generic-dresser', { x: 3.5, y: 0.3, face: 'S' }), put('generic-desk-small', { x: 3, y: 2.6, face: 'N' })]), 'S')).not.toContain('A1');
    expect(rulesOf(r('balcony', [], [], [2, 2]), 'S')).toContain('A1');
    expect(rulesOf(r('balcony', [put('generic-balcony-chair', { x: 1, y: 1, face: 'S' })], [], [2, 2]), 'S')).not.toContain('A1');
    // bath: washbasin plus WC or shower
    const bath = (fixed: string[]) => r('bath', [], fixed.map((id, n) => put(id, { x: 0.4 + n * 0.8, y: 0.3, face: 'S' })), [2.5, 2.5]);
    expect(rulesOf(bath(['generic-washbasin', 'generic-shower']), 'S')).not.toContain('A1');
    expect(rulesOf(bath(['generic-shower']), 'S')).toContain('A1');
  });
  it('A1 WC: the hand basin is medium, the toilet severe', () => {
    const wc = (fixed: string[]) => review({ room: rectRoom(1.2, 1.6, { doors: [{ wall: 'S', at: 0.6, width: 0.7 }] }), type: 'bath', items: [], existing: fixed.map((id) => put(id, { x: 0.6, y: 0.3, face: 'S' })) });
    expect(wc(['generic-toilet']).findings.find((f) => f.rule === 'A1')?.severity).toBe('M');
    expect(rulesOf(wc(['generic-toilet', 'generic-washbasin']))).not.toContain('A1');
  });
  it('A1 a required programme piece that was dropped is severe', () => {
    const r = review({
      room: room(),
      type: 'bedroom',
      items: [put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W' })],
      dropped: [{ id: 'wardrobe', catalogId: 'generic-wardrobe-150', reason: 'passt nicht mehr hin' }],
      program: { roomId: 'room_test', reading: '', zones: [], items: [{ id: 'wardrobe', catalogId: 'generic-wardrobe-150', zone: 'z', why: '', required: true, label: 'Kleiderschrank' }], relations: [], walk: '', check: [] },
    });
    expect(r.findings.some((f) => f.rule === 'A1' && f.severity === 'S' && /Kleiderschrank/.test(f.text))).toBe(true);
  });
  it('A2 a function twice in the flat is medium, once is fine, a reason allows it', () => {
    const dining = (id: string) => {
      const a = rectRoom(4, 3, { id, name: id, doors: [{ wall: 'S', at: 2 }] });
      return {
        analysis: a,
        type: 'dining' as const,
        layout: layoutOf(id, [put('generic-dining-table-4', { x: 2, y: 1.5, face: 'S' }), put('generic-chair', { x: 1.5, y: 0.8, face: 'S' }), put('generic-chair', { x: 2.5, y: 0.8, face: 'S' })]),
      };
    };
    const one = reviewFlat([dining('a')]);
    expect(one.flat).toEqual([]);
    const two = reviewFlat([dining('a'), dining('b')]);
    expect(two.flat.map((f) => f.rule)).toEqual(['A2']);
    expect(two.flat[0].severity).toBe('M');
    expect(two.flat[0].roomId).toBeNull();
    const ctxs = [dining('a'), dining('b')].map((i) => new RoomCtx({ ...i, options: { allowDouble: ['dining'] } }));
    expect(checkDoubles(ctxs)).toEqual([]);
  });
  it('A2 two kitchens, two televisions and two guest beds', () => {
    const k = (id: string) => ({ analysis: rectRoom(3, 3, { id, name: id, doors: [{ wall: 'S', at: 1.5 }] }), type: 'other' as const, layout: layoutOf(id, [put('generic-k-sink-80', { x: 1, y: 0.3, face: 'S' })]) });
    expect(reviewFlat([k('a'), k('b')]).flat.some((f) => /Küchenzeile/.test(f.text))).toBe(true);
    const guest = (id: string) => ({ analysis: rectRoom(3, 3, { id, name: id, doors: [{ wall: 'S', at: 1.5 }] }), type: 'office' as const, layout: layoutOf(id, [put('generic-bed-90', { x: 0.5, y: 1.2, face: 'O' })]) });
    expect(reviewFlat([guest('a'), guest('b')]).flat.some((f) => /Gästeschlafplatz/.test(f.text))).toBe(true);
    expect(reviewFlat([guest('a')]).flat).toEqual([]);
    const tv = (id: string) => ({ analysis: rectRoom(3, 3, { id, name: id, doors: [{ wall: 'S', at: 1.5 }] }), type: 'living' as const, layout: layoutOf(id, [put('generic-tv', { x: 1.5, y: 0.05, face: 'S' })]) });
    expect(reviewFlat([tv('a'), tv('b')]).flat.some((f) => /Fernseher/.test(f.text))).toBe(true);
  });
  it('A3 a new sanitary piece is severe, a fitted one is not, a hand basin in the WC may be new', () => {
    const base = { room: rectRoom(2.5, 2.5, { doors: [{ wall: 'S', at: 1.25 }] }), type: 'bath' as const };
    expect(rulesOf(review({ ...base, items: [put('generic-toilet', { x: 0.5, y: 0.3, face: 'S' })] }), 'S')).toContain('A3');
    expect(rulesOf(review({ ...base, items: [], existing: [put('generic-toilet', { x: 0.5, y: 0.3, face: 'S' })] }))).not.toContain('A3');
    expect(rulesOf(review({ ...base, items: [put('generic-toilet', { x: 0.5, y: 0.3, face: 'S' })], options: { allowNewSanitary: true } }))).not.toContain('A3');
    const wc = { room: rectRoom(1.2, 1.6, { doors: [{ wall: 'S', at: 0.6, width: 0.7 }] }), type: 'bath' as const, existing: [put('generic-toilet', { x: 0.6, y: 0.3, face: 'S' })] };
    expect(rulesOf(review({ ...wc, items: [put('generic-washbasin', { x: 0.95, y: 0.9, face: 'W' })] }))).not.toContain('A3');
  });
});

describe('A4 Küche', () => {
  const kitchen = (xs: { fridge: number; sink: number; cook: number }, extra: ReturnType<typeof put>[] = []) =>
    review({
      room: rectRoom(4, 3, { doors: [{ wall: 'W', at: 1.5 }], windows: [{ wall: 'O', at: 1.5 }] }),
      type: 'kitchen',
      items: [
        put('generic-k-fridge', { x: xs.fridge, y: 0.325, face: 'S' }),
        put('generic-k-base-60', { x: 0.9, y: 0.3, face: 'S' }),
        put('generic-k-sink-80', { x: xs.sink, y: 0.3, face: 'S' }),
        put('generic-k-base-60', { x: xs.cook, y: 0.3, face: 'S' }),
        put('generic-k-cooktop', { x: xs.cook, y: 0.3, face: 'S' }),
        put('generic-pendant', { x: 2, y: 1.5 }),
        put('generic-pendant', { x: 3, y: 1.5 }),
        ...extra,
      ],
    });
  it('worktop between sink and hob: 60 cm is enough, less is medium', () => {
    expect(rulesOf(kitchen({ fridge: 0.3, sink: 1.6, cook: 2.9 }))).not.toContain('A4');
    expect(kitchen({ fridge: 0.3, sink: 1.6, cook: 2.5 }).findings.some((f) => f.rule === 'A4' && /Arbeitsfläche/.test(f.text))).toBe(true);
  });
  it('hob next to a tall cabinet or the wall', () => {
    expect(kitchen({ fridge: 0.3, sink: 1.6, cook: 2.9 }, [put('generic-k-tall-60', { x: 3.5, y: 0.3, face: 'S' })]).findings.some((f) => f.rule === 'A4' && /Hochschrank/.test(f.text))).toBe(true);
    expect(kitchen({ fridge: 0.3, sink: 1.2, cook: 3.7 }).findings.some((f) => f.rule === 'A4' && /Wand/.test(f.text))).toBe(true);
  });
  it('the existing kitchen is not judged, it stays as it is', () => {
    const r = review({
      room: rectRoom(4, 3, { doors: [{ wall: 'W', at: 1.5 }], windows: [{ wall: 'O', at: 1.5 }] }),
      type: 'kitchen',
      items: [],
      existing: [put('generic-k-fridge', { x: 0.3, y: 0.325, face: 'S' }), put('generic-k-sink-80', { x: 1.0, y: 0.3, face: 'S' }), put('generic-k-base-60', { x: 1.7, y: 0.3, face: 'S' }), put('generic-k-cooktop', { x: 1.7, y: 0.3, face: 'S' })],
    });
    expect(rulesOf(r)).not.toContain('A4');
  });
  it('working triangle between 3.6 and 7 m', () => {
    expect(kitchen({ fridge: 0.3, sink: 1.6, cook: 2.9 }).findings.some((f) => /Arbeitsdreieck/.test(f.text))).toBe(false);
    expect(kitchen({ fridge: 0.3, sink: 1.3, cook: 1.9 }).findings.some((f) => /Arbeitsdreieck.*eng/.test(f.text))).toBe(true);
  });
  it('A5 anchor piece outside its zone', () => {
    const program = (zone: { x0: number; y0: number; x1: number; y1: number }) => ({
      roomId: 'room_test',
      reading: '',
      zones: [{ id: 'sleep', function: 'Schlafen', rect: zone, why: '' }],
      items: [{ id: 'bed', catalogId: 'generic-bed-140', zone: 'sleep', why: '', required: true, label: 'Doppelbett' }],
      relations: [],
      walk: '',
      check: [],
    });
    const run = (zone: { x0: number; y0: number; x1: number; y1: number }) => review({ room: room(), type: 'bedroom', items: [put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W', id: 'bed', zone: 'sleep' }), put('generic-wardrobe-150', { x: 0.3, y: 1.75, face: 'O' }), put('generic-pendant', { x: 2, y: 1.75 }), put('generic-floor-lamp', { x: 0.3, y: 0.3 })], program: program(zone) });
    expect(rulesOf(run({ x0: 2, y0: 0.5, x1: 4, y1: 3 }))).not.toContain('A5');
    expect(rulesOf(run({ x0: 0, y0: 0, x1: 1, y1: 1 }), 'M')).toContain('A5');
  });
});

describe('B Wege und Zugang', () => {
  const crossRoom = (barrier: Put | null, opts: { passThrough?: boolean; h?: number } = {}) => {
    const h = opts.h ?? 3;
    return review({
      room: rectRoom(3, h, { doors: [{ wall: 'W', at: h / 2 }, { wall: 'O', at: h / 2 }], passThrough: opts.passThrough }),
      type: 'other',
      items: barrier ? [put('generic-sideboard', { id: 'wall', face: 'W', ...barrier })] : [],
    });
  };
  it('B1 no way through between two doors is severe, a gap of 1 m is fine', () => {
    expect(rulesOf(crossRoom({ x: 1.5, y: 1.5, width: 3.0 }), 'S')).toContain('B1');
    expect(rulesOf(crossRoom({ x: 1.5, y: 1.5, width: 1.0 }))).not.toContain('B1');
  });
  it('B2 main way narrower than 90 cm (pass-through room) is medium', () => {
    expect(rulesOf(crossRoom({ x: 1.5, y: 1.5, width: 1.5 }, { passThrough: true }), 'M')).toContain('B2');
    expect(rulesOf(crossRoom({ x: 1.5, y: 1.5, width: 1.0 }, { passThrough: true }))).not.toContain('B2');
    expect(rulesOf(crossRoom({ x: 1.5, y: 1.5, width: 1.5 }, { passThrough: false }))).not.toContain('B2');
  });
  it('B3 a long detour is light', () => {
    expect(rulesOf(crossRoom({ x: 1.5, y: 2.5, width: 3.4 }, { h: 5 }), 'L')).toContain('B3');
    expect(rulesOf(crossRoom({ x: 1.5, y: 2.5, width: 1.0 }, { h: 5 }))).not.toContain('B3');
  });
  it('B4 anything in the door swing is severe, plants and lamps too', () => {
    // door on the south wall: swing x 0.35…1.25, y 2.6…3.5
    expect(rulesOf(review({ room: room(), type: 'other', items: [put('generic-wardrobe-100', { x: 0.9, y: 3.0, face: 'N' })] }), 'S')).toContain('B4');
    expect(rulesOf(review({ room: room(), type: 'other', items: [put('generic-plant', { x: 0.9, y: 3.0 })] }), 'S')).toContain('B4');
    expect(rulesOf(review({ room: room(), type: 'other', items: [put('generic-floor-lamp', { x: 0.9, y: 3.0 })] }), 'S')).toContain('B4');
    expect(rulesOf(review({ room: room(), type: 'other', items: [put('generic-wardrobe-100', { x: 2.5, y: 3.0, face: 'N' })] }))).not.toContain('B4');
  });
  it('B4 a rug in the swing is no hard finding', () => {
    expect(rulesOf(review({ room: room(), type: 'other', items: [put('generic-runner', { x: 0.8, y: 3.0 })] }), 'S')).not.toContain('B4');
  });
  it('B5 a piece less than 50 cm behind a door that does not swing in', () => {
    const r = (y: number) => review({ room: rectRoom(3, 3, { doors: [{ wall: 'S', at: 1.5, swingsIn: false }] }), type: 'other', items: [put('generic-shelf-80', { x: 1.5, y, face: 'S' })] });
    expect(rulesOf(r(2.7), 'M')).toContain('B5');
    expect(rulesOf(r(1.5))).not.toContain('B5');
  });
  it('B6 floor in front of a wardrobe: 70 cm', () => {
    const r = (bedX: number) => review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'other', items: [put('generic-wardrobe-150', { x: 0.3, y: 1.75, face: 'O' }), put('generic-sideboard', { x: bedX, y: 1.75, face: 'W' })] });
    expect(rulesOf(r(1.6))).not.toContain('B6');
    expect(rulesOf(r(1.3), 'M')).toContain('B6');
  });
  it('B6 beside the bed: 50 cm on one side at least', () => {
    const r = (y: number) => review({ room: rectRoom(3, 3, { doors: [{ wall: 'S', at: 1.5 }] }), type: 'other', items: [put('generic-bed-90', { x: 1.5, y, face: 'S' }), put('generic-wardrobe-100', { x: 0.3, y: 1.0, face: 'O' }), put('generic-wardrobe-100', { x: 2.7, y: 1.0, face: 'W' })] });
    // bed 0.95 wide between two wardrobes 0.6 deep: 1.5-0.475-0.6 = 0.425 each side
    expect(rulesOf(r(1.5), 'M')).toContain('B6');
    const free = review({ room: rectRoom(4, 3, { doors: [{ wall: 'S', at: 2 }] }), type: 'other', items: [put('generic-bed-90', { x: 1.5, y: 1.5, face: 'S' })] });
    expect(rulesOf(free)).not.toContain('B6');
  });
  it('B6 chair zone at the desk: 75 cm', () => {
    const r = (deskY: number) => review({ room: rectRoom(3, 3, { doors: [{ wall: 'S', at: 1.5 }] }), type: 'office', items: [put('generic-desk', { x: 1.5, y: deskY, face: 'S' })] });
    expect(rulesOf(r(0.35))).not.toContain('B6');
    expect(rulesOf(r(2.2), 'M')).toContain('B6');
  });
  it('B6 kitchen: 100 cm in front, below 120 cm only light', () => {
    const r = (d: number) => review({ room: rectRoom(3, d, { doors: [{ wall: 'W', at: d / 2 }] }), type: 'other', items: [put('generic-k-base-60', { x: 1.5, y: 0.3, face: 'S' })] });
    expect(rulesOf(r(2.5))).not.toContain('B6');
    expect(r(1.7).findings.find((f) => f.rule === 'B6')?.severity).toBe('L');
    expect(r(1.5).findings.find((f) => f.rule === 'B6')?.severity).toBe('M');
  });
  it('B6 WC and washbasin: 55 cm', () => {
    const r = (d: number) => review({ room: rectRoom(1.6, d, { doors: [{ wall: 'O', at: d / 2, width: 0.7, swingsIn: false }] }), type: 'bath', items: [], existing: [put('generic-toilet', { x: 0.8, y: 0.27, face: 'S' })] });
    expect(rulesOf(r(1.6))).not.toContain('B6');
    expect(rulesOf(r(0.95), 'M')).toContain('B6');
  });
  it('B7 a piece enclosed by others is not reachable', () => {
    const ring = [
      put('generic-sideboard', { x: 2, y: 1.2, face: 'S', width: 1.2 }),
      put('generic-sideboard', { x: 2, y: 2.3, face: 'N', width: 1.2 }),
      put('generic-sideboard', { x: 1.35, y: 1.75, face: 'O', width: 0.9, depth: 0.2 }),
      put('generic-sideboard', { x: 2.65, y: 1.75, face: 'W', width: 0.9, depth: 0.2 }),
    ];
    const inner = put('generic-coffee-table', { x: 2, y: 1.75, face: 'S', width: 0.6, depth: 0.4, id: 'inner' });
    const r = review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'other', items: [...ring, inner] });
    expect(r.findings.some((f) => f.rule === 'B7' && f.items.includes('inner'))).toBe(true);
    expect(rulesOf(review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }] }), type: 'other', items: [inner] }))).not.toContain('B7');
  });
  it('B8 no reachable window is light', () => {
    const row = [0.5, 1.5, 2.5, 3.5].map((x) => put('generic-wardrobe-100', { x, y: 0.3, face: 'S' }));
    expect(rulesOf(review({ room: room(), type: 'other', items: row }), 'L')).toContain('B8');
    expect(rulesOf(review({ room: room(), type: 'other', items: [] }))).not.toContain('B8');
    // on the balcony one is outside already
    expect(rulesOf(review({ room: room(), type: 'balcony', items: row }))).not.toContain('B8');
  });
});
