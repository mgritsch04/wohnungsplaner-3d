import { describe, expect, it } from 'vitest';
import type { DraftOpening } from './draft';
import { applyDoorWidths, doorLabelWidth } from './doorWidths';

const door = (x: number, width: number): DraftOpening => ({ id: `o${x}`, kind: 'door', center: { x, y: 0 }, width, height: 2.1, sillHeight: 0, status: 'uncertain', accepted: true });

describe('door widths (#267)', () => {
  it('reads clear widths from door labels', () => {
    expect(doorLabelWidth('80 / 200')).toBeCloseTo(0.8);
    expect(doorLabelWidth('90x210')).toBeCloseTo(0.9);
    expect(doorLabelWidth('0,80 / 2,00')).toBeCloseTo(0.8);
    expect(doorLabelWidth('120 / 90')).toBeUndefined(); // a window-like label
    expect(doorLabelWidth('Bad')).toBeUndefined();
  });
  it('takes the width from the label next to the door', () => {
    const r = applyDoorWidths([door(1, 0.9), door(5, 0.9)], [{ str: '80 / 200', x: 1.2, y: 0.4 }]);
    expect(r.openings[0].width).toBeCloseTo(0.8);
    expect(r.openings[1].width).toBeCloseTo(0.8); // no label: gap minus jamb allowance
    expect(r.labelled).toBe(1);
    expect(r.reduced).toBe(1);
  });
  it('does not widen a door and leaves windows and narrow gaps alone', () => {
    const win: DraftOpening = { ...door(9, 1.2), kind: 'window' };
    const r = applyDoorWidths([door(1, 0.65), win], [{ str: '90 / 200', x: 1, y: 0 }]);
    expect(r.openings[0].width).toBeCloseTo(0.65);
    expect(r.openings[1].width).toBe(1.2);
  });
});
