import type { Furniture } from './schema';

/**
 * How open a curtain is (#413): 0 = closed, 0.5 = half, 1 = open. A curtain without a stored
 * state hangs open (gathered at the side). Window coverings (blinds, roller shutters) keep their
 * state on the opening (`opening.shading.closed`, see model/shading.ts).
 */
export function coverOpenness(item: Pick<Furniture, 'closed'>): number {
  return 1 - (item.closed ?? 0);
}
