import { describe, expect, it } from 'vitest';
import { put, rectRoom, review, type Scenario } from './testkit';

const has = (r: ReturnType<typeof review>, rule: string, text: RegExp) => r.findings.some((f) => f.rule === rule && text.test(f.text));
const run = (s: Partial<Scenario> & Pick<Scenario, 'items'>) => review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'N', at: 2.5 }] }), type: 'living', ...s });

describe('Bildprüfung r4: Regeln, die die Begehung bisher nicht meldete', () => {
  it('G1 the rug of the seating group lies into the cook’s aisle', () => {
    const kitchen = (rugY: number) =>
      review({
        room: rectRoom(5, 5, { doors: [{ wall: 'S', at: 4 }] }),
        type: 'living',
        items: [put('generic-k-base-60', { x: 1.0, y: 0.3, face: 'S' }), put('generic-k-base-60', { x: 1.6, y: 0.3, face: 'S' }), put('generic-rug-240', { x: 2, y: rugY })],
      });
    expect(has(kitchen(1.2), 'D5', /Arbeitsbereich vor der Küchenzeile/)).toBe(true);
    expect(has(kitchen(3.5), 'D5', /Arbeitsbereich vor der Küchenzeile/)).toBe(false);
  });

  it('G2 both sides of a double bed must be walkable, a wardrobe at the foot end closes one', () => {
    const bed = put('generic-bed-160', { x: 1.1, y: 1.75, face: 'O' });
    const room = rectRoom(4, 3.5, { doors: [{ wall: 'S', at: 3 }] });
    const closed = review({ room, type: 'bedroom', items: [bed, put('generic-wardrobe-100', { x: 2.4, y: 0.45, face: 'W' })] });
    expect(closed.findings.find((f) => /eingeschlossen/.test(f.text))?.severity).toBe('M');
    expect(has(review({ room, type: 'bedroom', items: [bed] }), 'C1', /eingeschlossen/)).toBe(false);
  });

  it('G3 the television across from a window mirrors it, a window at the side does not', () => {
    const tv = put('generic-tv', { x: 2.5, y: 3.9, face: 'N' });
    expect(has(run({ items: [tv] }), 'C3', /gegenüber, bei Tageslicht spiegelt/)).toBe(true);
    const side = review({ room: rectRoom(5, 4, { doors: [{ wall: 'S', at: 4 }], windows: [{ wall: 'O', at: 2 }] }), type: 'living', items: [tv] });
    expect(has(side, 'C3', /gegenüber, bei Tageslicht spiegelt/)).toBe(false);
  });

  it('G5 an armchair that looks at the dining table instead of the group is medium', () => {
    const room = rectRoom(6, 4, { doors: [{ wall: 'S', at: 5 }], windows: [{ wall: 'N', at: 3 }] });
    const base = [put('generic-sofa-3', { x: 1.2, y: 2, face: 'O' }), put('generic-dining-table-4', { x: 4.6, y: 3.2, face: 'S' })];
    expect(has(review({ room, type: 'living', items: [...base, put('generic-armchair', { x: 3.0, y: 3.2, face: 'O' })] }), 'C2', /Esstisch statt zur Sitzgruppe/)).toBe(true);
    expect(has(review({ room, type: 'living', items: [...base, put('generic-armchair', { x: 3.0, y: 2.0, face: 'W' })] }), 'C2', /Esstisch statt zur Sitzgruppe/)).toBe(false);
  });

  it('G6 a coffee table much smaller than the sofa is light', () => {
    const sofa = put('generic-sofa-3', { x: 2.5, y: 3.3, face: 'N', width: 2.0, depth: 0.9 });
    const table = (width: number) => put('generic-coffee-table', { x: 2.5, y: 2.3, face: 'N', width, depth: 0.5 });
    expect(has(run({ items: [sofa, table(0.45)] }), 'C2', /viel kleiner als/)).toBe(true);
    expect(has(run({ items: [sofa, table(1.0)] }), 'C2', /viel kleiner als/)).toBe(false);
  });

  it('G7 a rug barely wider than the sofa is light, 15 cm and more each side is fine', () => {
    const sofa = put('generic-sofa-3', { x: 2.5, y: 3.3, face: 'N', width: 2.0, depth: 0.9 });
    const table = put('generic-coffee-table', { x: 2.5, y: 2.3, face: 'N', width: 1.0, depth: 0.5 });
    const rug = (width: number) => put('generic-rug-240', { x: 2.5, y: 2.6, width, depth: 1.6 });
    expect(has(run({ items: [sofa, table, rug(2.1)] }), 'D5', /ragt nur/)).toBe(true);
    expect(has(run({ items: [sofa, table, rug(2.5)] }), 'D5', /ragt nur/)).toBe(false);
  });

  it('G4 a strip of 52 cm between the sofa back and the next piece is reported like one to the wall', () => {
    const items = (shelfY: number) => [put('generic-sofa-3', { x: 2.5, y: 2.2, face: 'S' }), put('generic-shelf-80', { x: 2.5, y: shelfY, face: 'S' })];
    // sofa back at y = 1.75; shelf front edge 52 cm above it
    const gap = run({ items: items(1.75 - 0.52 - 0.15) });
    expect(has(gap, 'C8', /nächsten Möbel/)).toBe(true);
    expect(has(run({ items: items(1.75 - 0.9 - 0.15) }), 'C8', /nächsten Möbel/)).toBe(false);
  });
});
