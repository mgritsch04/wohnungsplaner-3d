import { describe, expect, it } from 'vitest';
import { toRItem } from '../review/items';
import { put, rectRoom } from '../review/testkit';
import { backOf, gazeOf, hasGaze, type GazePiece } from './gaze';

const piece = (catalogId: string, at: Parameters<typeof put>[1], ref?: string): GazePiece => {
  const it = put(catalogId, at);
  return { ...toRItem(it, false, []), ref: ref ?? it.id };
};

// W1 north with the window F1 at x=1.5–2.7 m, W2 east, W3 south with the door T1, W4 west with the passage T2
const room = rectRoom(5, 4, { doors: [{ wall: 'S', at: 4.4 }, { wall: 'W', at: 1.0, kind: 'passage' }], windows: [{ wall: 'N', at: 2.1 }] });

describe('gaze of a piece (#436)', () => {
  it('a sofa looks at the window and tells the distance from its front edge', () => {
    const sofa = piece('generic-sofa-3', { x: 2.1, y: 3.4, face: 'N' });
    const g = gazeOf(room, sofa, [sofa]);
    expect(g.targets[0].kind).toBe('window');
    expect(g.text).toMatch(/^schaut auf: Fenster F1 \(2\d\d cm\)/);
  });

  it('a window only partly in the beam shows up next to the bare wall', () => {
    const sofa = piece('generic-sofa-3', { x: 3.0, y: 3.4, face: 'N' });
    const g = gazeOf(room, sofa, [sofa]);
    expect(g.text).toContain('Wand W1');
    expect(g.text).toContain('Fenster F1');
  });

  it('the kitchen run is the target, named by its wall', () => {
    const run = ['generic-k-sink-80', 'generic-k-fridge'].map((id, n) => piece(id, { x: 4.7, y: 1.2 + n * 0.8, face: 'W' }));
    const sofa = piece('generic-sofa-3', { x: 1.2, y: 2, face: 'O' });
    const g = gazeOf(room, sofa, [sofa, ...run]);
    expect(g.targets[0].kind).toBe('kitchen');
    expect(g.text).toMatch(/Küchenzeile an W2/);
  });

  it('looks over the coffee table and the rug at the television', () => {
    const coffee = piece('generic-coffee-table', { x: 2.1, y: 2.6, face: 'N' });
    const board = piece('generic-tv', { x: 2.1, y: 0.1, face: 'S' }, 'Fernseher');
    const sofa = piece('generic-sofa-3', { x: 2.1, y: 3.4, face: 'N' });
    const g = gazeOf(room, sofa, [sofa, coffee, board]);
    expect(g.targets[0].text).toBe('Fernseher');
    expect(g.targets[0].kind).toBe('tv');
  });

  it('a door and a passage are named as such', () => {
    const bed = piece('generic-bed-140', { x: 0.6, y: 1.2, face: 'S' });
    expect(gazeOf(room, bed, [bed]).text).toMatch(/Tür T1/);
    const chair = piece('generic-armchair', { x: 3, y: 3.0, face: 'W' });
    expect(gazeOf(room, chair, [chair]).targets.map((t) => t.text)).toContain('Durchgang T2');
  });

  it('knows which pieces get a gaze line', () => {
    expect(hasGaze(piece('generic-sofa-3', { x: 1, y: 1 }))).toBe(true);
    expect(hasGaze(piece('generic-bed-140', { x: 1, y: 1 }))).toBe(true);
    expect(hasGaze(piece('generic-desk', { x: 1, y: 1 }))).toBe(true);
    expect(hasGaze(piece('generic-dining-table-4', { x: 1, y: 1 }))).toBe(false);
  });

  it('a sofa that divides the room turns its back to the kitchen run; one against a wall has no back line', () => {
    const run = piece('generic-k-sink-80', { x: 2.5, y: 0.3, face: 'S' });
    const free = piece('generic-sofa-3', { x: 2.5, y: 1.4, face: 'S' });
    expect(backOf(room, free, [free, run])).toMatch(/^Rücken zu: Küchenzeile an W1/);
    const walled = piece('generic-sofa-3', { x: 2.5, y: 3.55, face: 'N' });
    expect(backOf(room, walled, [walled])).toBeNull();
  });
});
