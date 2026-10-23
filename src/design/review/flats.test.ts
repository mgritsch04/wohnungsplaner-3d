import { describe, expect, it } from 'vitest';
import { derivePlan } from '../../model/derived';
import { analyzeFlat } from '../analysis';
import { FLAT_KEYS, TEST_FLATS } from '../fixtures/flats';
import { reviewFlat, type ReviewInput } from './index';

describe.each(FLAT_KEYS)('Begehung der leeren Testwohnung %s', (key) => {
  const project = TEST_FLATS[key].build();
  const analysis = analyzeFlat(project, derivePlan(project));
  const inputs: ReviewInput[] = analysis.rooms.map((room) => ({
    analysis: room,
    type: room.typeFromName,
    layout: { roomId: room.roomId, items: [], dropped: [], cost: 0, unsolved: [], seed: 0 },
  }));

  it('reviews every room without error in under 100 ms and gives consistent points', () => {
    for (const input of inputs) {
      const t0 = performance.now();
      const review = reviewFlat([input]);
      expect(performance.now() - t0, input.analysis.name).toBeLessThan(100);
      const room = review.rooms[0];
      expect(room.score).toBeGreaterThanOrEqual(0);
      expect(room.score).toBeLessThanOrEqual(100);
      expect(room.metrics.occupancy).toBeGreaterThanOrEqual(0);
    }
  });

  it('an empty bedroom or living room lacks its required pieces', () => {
    const review = reviewFlat(inputs);
    for (const [i, input] of inputs.entries()) {
      if (input.type === 'bedroom' && input.analysis.area >= 7) expect(review.rooms[i].findings.some((f) => f.rule === 'A1' && f.severity === 'S'), input.analysis.name).toBe(true);
      if (input.type === 'living') expect(review.rooms[i].passed, input.analysis.name).toBe(false);
    }
  });
});
