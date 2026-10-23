import { describe, expect, it } from 'vitest';
import { isSplitChangeRecent, markSplitChange, zoomForWidth } from './splitResize';

describe('zoomForWidth', () => {
  it('keeps the visible world width when the pane gets narrower', () => {
    expect(zoomForWidth(60, 800, 400, 5, 2000)).toBe(30);
  });
  it('is reversible', () => {
    expect(zoomForWidth(zoomForWidth(60, 800, 500, 5, 2000), 500, 800, 5, 2000)).toBeCloseTo(60);
  });
  it('respects limits and ignores degenerate widths', () => {
    expect(zoomForWidth(6, 800, 100, 5, 2000)).toBe(5);
    expect(zoomForWidth(60, 0, 400, 5, 2000)).toBe(60);
  });
});

describe('isSplitChangeRecent', () => {
  it('is true shortly after a change only', () => {
    markSplitChange(1000);
    expect(isSplitChangeRecent(1100)).toBe(true);
    expect(isSplitChangeRecent(2000)).toBe(false);
  });
});
