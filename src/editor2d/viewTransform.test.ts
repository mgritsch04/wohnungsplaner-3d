import { describe, expect, it } from 'vitest';
import { ICON_MIN_ZOOM, roomLabelDetail } from './viewTransform';

describe('level of detail when zooming out (#382)', () => {
  it('shows the full label in a big room and drops area, then name, as the room shrinks on screen', () => {
    expect(roomLabelDetail('Wohnzimmer', 8, 3, 60)).toBe('full');
    expect(roomLabelDetail('Wohnzimmer', 8, 3, 20)).toBe('name');
    expect(roomLabelDetail('Wohnzimmer', 8, 3, 8)).toBe('none');
  });
  it('hides the label when the room is too flat', () => {
    expect(roomLabelDetail('Bad', 3, 0.3, 60)).toBe('none');
  });
  it('keeps icons above the threshold only', () => {
    expect(ICON_MIN_ZOOM).toBeGreaterThan(5);
  });
});
