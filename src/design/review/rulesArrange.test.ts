import { describe, expect, it } from 'vitest';
import { put, rectRoom, review, rulesOf, type Scenario } from './testkit';

const sc = (s: Partial<Scenario> & Pick<Scenario, 'items'>) => review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3.2 }], windows: [{ wall: 'N', at: 2 }] }), type: 'other', ...s });
const light = [put('generic-pendant', { x: 2, y: 1.75 }), put('generic-floor-lamp', { x: 0.3, y: 0.3 })];
const has = (r: ReturnType<typeof review>, rule: string, text?: RegExp) => r.findings.some((f) => f.rule === rule && (!text || text.test(f.text)));

describe('C1 Bett', () => {
  it('head against a wall, not under the window, both sides free', () => {
    const r = sc({ type: 'bedroom', items: [put('generic-bed-140', { x: 2.975, y: 1.6, face: 'W' }), put('generic-wardrobe-150', { x: 0.3, y: 1.75, face: 'O' }), ...light] });
    expect(rulesOf(r).filter((x) => x === 'C1')).toEqual([]);
  });
  it('head not at a wall (bed in the middle) is medium', () => {
    const r = sc({ type: 'bedroom', items: [put('generic-bed-140', { x: 2, y: 1.8, face: 'S' }), ...light] });
    expect(has(r, 'C1', /Kopfteil.*nicht an der Wand/)).toBe(true);
  });
  it('head under the window is light', () => {
    const r = sc({ type: 'bedroom', items: [put('generic-bed-140', { x: 2, y: 1.025, face: 'S' }), ...light] });
    expect(r.findings.find((f) => f.rule === 'C1')?.severity).toBe('L');
  });
  it('a double bed reachable from one side only is medium', () => {
    const r = sc({ type: 'bedroom', items: [put('generic-bed-140', { x: 0.725, y: 1.025, face: 'S' }), ...light] });
    expect(has(r, 'C1', /nur von einer Seite/)).toBe(true);
    expect(r.findings.find((f) => /nur von einer Seite/.test(f.text))?.severity).toBe('M');
  });
});

describe('C2 Sitzgruppe', () => {
  const living = (tableY: number, extra: ReturnType<typeof put>[] = []) => review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'N', at: 2.5 }] }), type: 'living', items: [put('generic-sofa-3', { x: 3, y: 3.5, face: 'N' }), put('generic-coffee-table', { x: 3, y: tableY, face: 'N' }), ...extra] });
  it('coffee table 30–60 cm in front of the sofa', () => {
    expect(has(living(3.05 - 0.45 - 0.3), 'C2')).toBe(false);
    expect(has(living(3.05 - 0.1 - 0.3), 'C2', /Couchtisch/)).toBe(true);
    expect(has(living(3.05 - 0.9 - 0.3), 'C2', /Couchtisch/)).toBe(true);
  });
  it('an armchair faces the group', () => {
    expect(has(living(2.3, [put('generic-armchair', { x: 4.5, y: 2.2, face: 'W' })]), 'C2', /Sessel|schaut/)).toBe(false);
    expect(has(living(2.3, [put('generic-armchair', { x: 4.5, y: 2.2, face: 'O' })]), 'C2', /schaut nicht/)).toBe(true);
  });
  it('a sofa with its back directly in front of the room door is light', () => {
    const sofaAt = (x: number) => review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }] }), type: 'living', items: [put('generic-sofa-3', { x, y: 2.4, face: 'N' })] });
    expect(sofaAt(1).findings.find((f) => f.rule === 'C2')?.severity).toBe('L');
    expect(has(sofaAt(3.6), 'C2')).toBe(false);
  });
});

describe('C3 Fernseher', () => {
  const tvRoom = (tv: ReturnType<typeof put>, board?: ReturnType<typeof put>) =>
    review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'N', at: 2.5 }] }), type: 'living', items: [put('generic-sofa-3', { x: 2.5, y: 3.5, face: 'N' }), ...(board ? [board] : []), tv] });
  it('opposite the sofa at a comfortable distance', () => {
    expect(has(tvRoom(put('generic-tv', { x: 4.95, y: 2.0, face: 'W', elevation: 0.45 })), 'C3', /gegenüber/)).toBe(true);
    expect(has(tvRoom(put('generic-tv', { x: 2.5, y: 0.21, face: 'S', elevation: 0.45, parent: 'b' }), put('generic-tv-sideboard', { id: 'b', x: 2.5, y: 0.21, face: 'S' })), 'C3', /gegenüber|angenehm/)).toBe(false);
  });
  it('too close is medium', () => {
    expect(has(tvRoom(put('generic-tv', { x: 2.5, y: 2.0, face: 'S', elevation: 0.5 })), 'C3', /angenehm/)).toBe(true);
  });
  it('in front of a window is medium', () => {
    const r = tvRoom(put('generic-tv', { x: 2.5, y: 0.21, face: 'S', elevation: 0.45, parent: 'b' }), put('generic-tv-sideboard', { id: 'b', x: 2.5, y: 0.21, face: 'S' }));
    expect(has(r, 'C3', /Fenster/)).toBe(true);
    const r2 = tvRoom(put('generic-tv', { x: 4.3, y: 0.21, face: 'S', elevation: 0.45, parent: 'b' }), put('generic-tv-sideboard', { id: 'b', x: 4.3, y: 0.21, face: 'S' }));
    expect(has(r2, 'C3', /Fenster/)).toBe(false);
  });
});

describe('C4 Esstisch', () => {
  const dining = (opts: { chairs?: [number, number, 'N' | 'S'][]; pendant?: [number, number]; h?: number } = {}) => {
    const h = opts.h ?? 3;
    const chairs: [number, number, 'N' | 'S'][] = opts.chairs ?? [[1.6, 0.915, 'S'], [2.4, 0.915, 'S'], [1.6, 2.085, 'N'], [2.4, 2.085, 'N']];
    return review({
      room: rectRoom(4, h, { doors: [{ wall: 'W', at: h / 2 }] }),
      type: 'dining',
      items: [put('generic-dining-table-4', { x: 2, y: h / 2, face: 'S' }), ...chairs.map(([x, y, f]) => put('generic-chair', { x, y, face: f })), put('generic-pendant', { x: opts.pendant?.[0] ?? 2, y: opts.pendant?.[1] ?? h / 2 })],
    });
  };
  it('chairs at the table, pendant above it, room behind the chairs', () => {
    expect(has(dining(), 'C4')).toBe(false);
  });
  it('a chair away from the table is medium', () => {
    expect(has(dining({ chairs: [[1.6, 0.915, 'S'], [2.4, 0.915, 'S'], [1.6, 2.085, 'N'], [3.6, 2.7, 'N']] }), 'C4', /nicht am Tisch/)).toBe(true);
  });
  it('less than 75 cm behind the chairs on two sides is light', () => {
    const r = dining({ h: 2.0, chairs: [[1.6, 0.415, 'S'], [2.4, 0.415, 'S'], [1.6, 1.585, 'N'], [2.4, 1.585, 'N']] });
    expect(r.findings.find((f) => f.rule === 'C4' && /75 cm/.test(f.text))?.severity).toBe('L');
  });
  it('pendant not over the table is light', () => {
    expect(has(dining({ pendant: [0.5, 0.5] }), 'C4', /Pendel/)).toBe(true);
  });
  it('table in the working aisle of the kitchen is medium', () => {
    const kitchen = (tableY: number) =>
      review({
        room: rectRoom(4, 3.5, { doors: [{ wall: 'W', at: 1.75 }] }),
        type: 'kitchen',
        items: [put('generic-k-base-60', { x: 1.0, y: 0.3, face: 'S' }), put('generic-k-base-60', { x: 1.6, y: 0.3, face: 'S' }), put('generic-dining-table-4', { x: 1.6, y: tableY, face: 'S' })],
      });
    expect(has(kitchen(1.35), 'C4', /Arbeitsgang/)).toBe(true);
    expect(has(kitchen(2.5), 'C4', /Arbeitsgang/)).toBe(false);
  });
});

describe('C5 Schreibtisch', () => {
  const office = (wall: 'N' | 'S' | 'O') =>
    review({ room: rectRoom(4, 3.5, { doors: [{ wall: 'W', at: 1.75 }], windows: [{ wall, at: wall === 'O' ? 1.9 : 2 }] }), type: 'office', items: [put('generic-desk', { x: 2, y: 2.65, face: 'N' }), put('generic-office-chair', { x: 2, y: 1.9, face: 'S' })] });
  it('daylight from the side is good, behind the screen or in the back is light', () => {
    expect(has(office('O'), 'C5')).toBe(false);
    expect(has(office('S'), 'C5', /hinter dem Bildschirm/)).toBe(true);
    expect(has(office('N'), 'C5', /Rücken/)).toBe(true);
  });
});

describe('C6 / C7 hohe Möbel', () => {
  it('a tall piece free in the room is medium, at the wall it is fine, a planned divider is allowed', () => {
    expect(has(sc({ items: [put('generic-wardrobe-100', { x: 2, y: 1.75, face: 'S', id: 'w' })] }), 'C6')).toBe(true);
    expect(has(sc({ items: [put('generic-wardrobe-100', { x: 3.5, y: 0.3, face: 'S' })] }), 'C6')).toBe(false);
    const prog = { roomId: 'room_test', reading: '', zones: [], items: [], relations: [{ kind: 'center' as const, item: 'w' }], walk: '', check: [] };
    expect(has(sc({ items: [put('generic-wardrobe-100', { x: 2, y: 1.75, face: 'S', id: 'w' })], program: prog }), 'C6')).toBe(false);
  });
  it('something higher than the sill in front of the window is medium', () => {
    expect(has(sc({ items: [put('generic-wardrobe-100', { x: 2, y: 0.3, face: 'S' })] }), 'C7')).toBe(true);
    expect(has(sc({ items: [put('generic-sideboard', { x: 2, y: 0.225, face: 'S' })] }), 'C7')).toBe(false);
    expect(has(sc({ items: [put('generic-plant', { x: 2, y: 0.4 })] }), 'C7')).toBe(false);
  });
});

describe('C8 Wandmöbel', () => {
  it('flush is fine, a gap of 5–30 cm or a crooked piece is light', () => {
    expect(has(sc({ items: [put('generic-sideboard', { x: 3.3, y: 0.225, face: 'S' })] }), 'C8')).toBe(false);
    expect(has(sc({ items: [put('generic-sideboard', { x: 3.3, y: 0.225 + 0.15, face: 'S' })] }), 'C8', /Spalt/)).toBe(true);
    expect(has(sc({ items: [put('generic-sideboard', { x: 3.3, y: 0.3, rotation: 0.1 })] }), 'C8', /schief/)).toBe(true);
    expect(has(sc({ items: [put('generic-sideboard', { x: 3.3, y: 0.225 + 0.6, face: 'S' })] }), 'C8')).toBe(false);
  });
});

describe('C9 eingeklemmt', () => {
  it('two pieces less than 20 cm apart are medium, touching or wide apart are fine', () => {
    const pair = (gap: number) => sc({ items: [put('generic-wardrobe-100', { x: 0.5, y: 3.0, face: 'N' }), put('generic-sideboard', { x: 1.0 + gap + 0.8, y: 3.2, face: 'N' })] });
    expect(has(pair(0.1), 'C9')).toBe(true);
    expect(has(pair(0.5), 'C9')).toBe(false);
    expect(has(pair(0), 'C9')).toBe(false);
  });
  it('bed and nightstand are a pair', () => {
    expect(has(sc({ type: 'bedroom', items: [put('generic-bed-140', { x: 3.1, y: 1.025, face: 'S' }), put('generic-nightstand', { x: 2.1, y: 0.19, face: 'S' })] }), 'C9')).toBe(false);
  });
});
