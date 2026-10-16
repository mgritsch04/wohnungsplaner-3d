import { beforeEach, describe, expect, it } from 'vitest';
import { formatTape, measureBetween } from './tapeMeasure';
import { useTapeStore } from './tapeStore';

describe('3D tape measure (#88)', () => {
  it('measures the straight distance with horizontal and vertical parts', () => {
    expect(measureBetween([0, 0, 0], [3, 0, 4])).toEqual({ length: 5, horizontal: 5, vertical: 0 });
    expect(measureBetween([1, 0, 1], [1, 2.6, 1])).toEqual({ length: 2.6, horizontal: 0, vertical: 2.6 });
    const r = measureBetween([0, 1.2, 0], [2, 0.2, 0]);
    expect(r).toEqual({ length: 2.24, horizontal: 2, vertical: 1 });
  });

  it('rounds to whole centimetres', () => {
    expect(measureBetween([0, 0, 0], [1.2345, 0, 0]).length).toBe(1.23);
    expect(measureBetween([0, 0, 0], [1.2351, 0, 0]).length).toBe(1.24);
    expect(formatTape(2.35)).toBe('2,35 m');
    expect(formatTape(0.5)).toBe('0,50 m');
  });

  describe('store', () => {
    beforeEach(() => useTapeStore.setState({ active: false, pending: null, items: [] }));
    it('pairs clicks into measurements, several in a row, clear removes them', () => {
      const s = useTapeStore.getState();
      s.setActive(true);
      s.addPoint([0, 0, 0]);
      expect(useTapeStore.getState().pending).toEqual([0, 0, 0]);
      s.addPoint([1, 0, 0]);
      s.addPoint([0, 0, 1]);
      s.addPoint([0, 2, 1]);
      expect(useTapeStore.getState().items.map((i) => measureBetween(i.a, i.b).length)).toEqual([1, 2]);
      s.clear();
      expect(useTapeStore.getState()).toMatchObject({ pending: null, items: [], active: true });
      s.addPoint([5, 5, 5]);
      s.setActive(false); // switching off drops an unfinished measurement
      expect(useTapeStore.getState().pending).toBeNull();
    });
  });
});
