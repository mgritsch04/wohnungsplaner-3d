/**
 * Keyboard navigation inside a toolbar menu (#100): which entry gets the focus for a key.
 * `current` is the index of the focused entry (-1 when none of them has the focus).
 * Returns null for keys the menu does not handle.
 */
export function nextMenuIndex(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
