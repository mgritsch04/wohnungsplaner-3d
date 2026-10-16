import { describe, expect, it } from 'vitest';
import { createSampleProject } from './sample';
import { derivePlan } from './derived';
import { placementIssues } from './placement';

describe('sample apartment placement', () => {
  it('has no furniture in walls, door leaves or door swings', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const problems = p.furniture.flatMap((f) => placementIssues(p, d, f).filter((i) => i.kind !== 'overlap').map((i) => `${f.name}: ${i.message}`));
    expect(problems).toEqual([]);
  });
});
