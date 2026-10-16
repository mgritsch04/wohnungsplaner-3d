import { describe, expect, it } from 'vitest';
import { nextMenuIndex } from './menuNav';

describe('toolbar menu keyboard navigation (#100)', () => {
  it('moves down and up and wraps around', () => {
    expect(nextMenuIndex(4, 0, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(4, 3, 'ArrowDown')).toBe(0);
    expect(nextMenuIndex(4, 2, 'ArrowUp')).toBe(1);
    expect(nextMenuIndex(4, 0, 'ArrowUp')).toBe(3);
  });

  it('starts at the first / last entry when no entry has the focus', () => {
    expect(nextMenuIndex(4, -1, 'ArrowDown')).toBe(0);
    expect(nextMenuIndex(4, -1, 'ArrowUp')).toBe(3);
  });

  it('jumps with Home / End and ignores other keys and empty menus', () => {
    expect(nextMenuIndex(5, 2, 'Home')).toBe(0);
    expect(nextMenuIndex(5, 2, 'End')).toBe(4);
    expect(nextMenuIndex(5, 2, 'Enter')).toBeNull();
    expect(nextMenuIndex(5, 2, 'a')).toBeNull();
    expect(nextMenuIndex(0, -1, 'ArrowDown')).toBeNull();
  });
});
