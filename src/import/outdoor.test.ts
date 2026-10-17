import { describe, expect, it } from 'vitest';
import type { DraftOpening, DraftWall } from './draft';
import { balconyDoors, BALCONY_DOOR_HEIGHT, outdoorRailings, RAILING_HEIGHT } from './outdoor';
import { proposeRooms, roomInteriors } from './rooms';

const wall = (ax: number, ay: number, bx: number, by: number, thickness = 0.25): DraftWall => ({
  id: `w${ax}${ay}${bx}${by}`,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness,
  height: 2.5,
  status: 'estimated',
  accepted: true,
});
// a 6 × 4 m flat (wall centre lines), the balcony floor lies below the south wall
const flat = [wall(0, 0, 6, 0), wall(0, 4, 6, 4), wall(0, 0, 0, 4), wall(6, 0, 6, 4)];
const floor = [
  { x: 0.5, y: 4.3 },
  { x: 4.5, y: 4.3 },
  { x: 4.5, y: 5.8 },
  { x: 0.5, y: 5.8 },
];
const texts = [
  { str: 'Wohnen 22,00 m2', x: 3, y: 2 },
  { str: 'Balkon', x: 2, y: 5 },
];

describe('balconies and terraces (#214)', () => {
  it('closes a named balcony floor next to the flat with railings, so it becomes a room', () => {
    const railings = outdoorRailings(flat, texts, [floor], () => false);
    expect(railings).toHaveLength(3);
    for (const r of railings) expect(r.height).toBe(RAILING_HEIGHT);
    // the open sides end on the south wall's centre line
    expect(railings.some((r) => r.a.y === 4 || r.b.y === 4)).toBe(true);
    const rooms = proposeRooms([...flat, ...railings], { texts });
    const balcony = rooms.find((r) => r.name === 'Balkon')!;
    expect(balcony).toBeDefined();
    expect(balcony.area).toBeGreaterThan(5);
    expect(balcony.area).toBeLessThan(7);
  });

  it('leaves areas alone that are not named as balcony, already enclosed or far from the walls', () => {
    expect(outdoorRailings(flat, [{ str: 'Garten', x: 2, y: 5 }], [floor], () => false)).toEqual([]);
    expect(outdoorRailings(flat, texts, [floor], () => true)).toEqual([]);
    const far = floor.map((p) => ({ x: p.x, y: p.y + 5 }));
    expect(outdoorRailings(flat, [{ str: 'Balkon', x: 2, y: 10 }], [far], () => false)).toEqual([]);
  });
});

describe('balcony doors (#37)', () => {
  const opening = (kind: DraftOpening['kind'], x: number, y: number): DraftOpening => ({
    id: `o${x}${y}`,
    kind,
    center: { x, y },
    width: 1,
    height: 1.4,
    sillHeight: 0.9,
    status: 'uncertain',
    accepted: true,
  });
  it('a window in the wall onto the balcony becomes a door to the floor, other windows stay', () => {
    const railings = outdoorRailings(flat, texts, [floor], () => false);
    const walls = [...flat, ...railings];
    const out = balconyDoors([opening('window', 2.5, 4), opening('window', 5.2, 4), opening('window', 3, 0)], texts, roomInteriors(walls));
    expect(out[0]).toMatchObject({ kind: 'door', sillHeight: 0, height: BALCONY_DOOR_HEIGHT });
    // beside the balcony (x = 5.2 lies past its end at 4.5) and on the far side: still windows
    expect(out[1].kind).toBe('window');
    expect(out[2].kind).toBe('window');
  });
  it('without an outdoor area nothing changes', () => {
    const o = [opening('window', 2.5, 4)];
    expect(balconyDoors(o, [{ str: 'Wohnen', x: 3, y: 2 }], roomInteriors(flat))).toBe(o);
  });
});
