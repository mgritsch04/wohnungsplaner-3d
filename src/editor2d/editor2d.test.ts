import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { derivePlan } from '../model/derived';
import { hitTest } from './hitTest';

describe('2D hit testing priority', () => {
  it('selects furniture standing in front of a wall or corner, not the wall', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const tv = p.furniture.find((f) => f.catalogId === 'generic-tv-sideboard')!;
    // a point inside the sideboard but close to the north wall face
    const pt = { x: tv.x, y: tv.y - tv.depth / 2 + 0.01 };
    expect(hitTest(p, d, pt, 0.1)).toEqual({ type: 'furniture', id: tv.id });
  });
  it('still selects the wall when clicking its exposed part', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const hit = hitTest(p, d, { x: 4.5, y: -0.06 }, 0.05);
    expect(hit?.type).toBe('wall');
  });
});
