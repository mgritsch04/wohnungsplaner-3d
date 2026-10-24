/**
 * Inputs of stage 1 and 2 for the test flats (tests and local recording runs): the project,
 * its analysis from stage 0 and the text forms Claude reads.
 */
import { analyzeFlat, flatSketch, roomSketch } from '../analysis';
import { TEST_FLATS, type FlatKey } from '../fixtures/flats';
import type { FlatConceptInput } from './flatConcept';

export interface TestFlatInput extends FlatConceptInput {
  roomSketch: (roomId: string) => string;
  /** Room id by room name. */
  roomId: (name: string) => string;
}

export function testFlatInput(key: FlatKey): TestFlatInput {
  const t = TEST_FLATS[key];
  const project = t.build();
  const analysis = analyzeFlat(project);
  const ctx = { project, flat: analysis };
  return {
    project,
    analysis,
    sketch: flatSketch(ctx),
    wishes: t.wishes,
    roomSketch: (id) => {
      const room = analysis.rooms.find((r) => r.roomId === id);
      return room ? roomSketch(ctx, room) : '';
    },
    roomId: (name) => {
      const room = analysis.rooms.find((r) => r.name === name);
      if (!room) throw new Error(`Raum ${name} fehlt in Testwohnung ${key}`);
      return room.roomId;
    },
  };
}
