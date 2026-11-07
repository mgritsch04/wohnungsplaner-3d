import { describe, expect, it } from 'vitest';
import { withActualSize } from './sizeLabel';

describe('the size in Claude’s description follows the piece that stands there', () => {
  it('a bigger rug: the new size, in the order the description used', () => {
    expect(withActualSize('Flachgewebe-Teppich 120×170, Wolle', 'generic-rug-120', 'generic-rug-160', 1.6, 2.3)).toBe('Flachgewebe-Teppich 160×230, Wolle');
    expect(withActualSize('Teppich 170 x 120', 'generic-rug-120', 'generic-rug-160', 1.6, 2.3)).toBe('Teppich 230×160');
  });
  it('the planned piece keeps the words as they are', () => {
    expect(withActualSize('Teppich 150×220', 'generic-rug-160', 'generic-rug-160', 1.6, 2.3)).toBe('Teppich 150×220');
  });
});
