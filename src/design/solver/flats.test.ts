/**
 * The solver on every room of test flats C–F (#440) with synthetic programmes: L-shaped living
 * room (C), studio (D), bay with slanted walls and four doors (E), existing fitted kitchen and a
 * „frei lassen“ area (F). No hard rule broken, checked independently.
 */
import { describe, expect, it } from 'vitest';
import { analyzeFlat } from '../analysis';
import { TEST_FLATS } from '../fixtures/flats';
import type { RoomType } from '../types';
import { existingPieces, solveRoom } from './solve';
import { randomProgram, type Kind } from './testPrograms';
import { independentCheck } from './verify';

const KIND: Partial<Record<RoomType, Kind>> = { living: 'living', bedroom: 'bedroom', kids: 'bedroom', office: 'office', dining: 'dining', hall: 'hall', kitchen: 'kitchen', other: 'living' };

const rooms = (['C', 'D', 'E', 'F'] as const).flatMap((key) => {
  const project = TEST_FLATS[key].build();
  const flat = analyzeFlat(project);
  return flat.rooms.filter((r) => KIND[r.typeFromName] && r.area > 4).map((r) => ({ key, project, room: r }));
});

describe('solver on test flats C–F', () => {
  it.each(rooms.map((x) => [`${x.key} ${x.room.name}`, x] as const))('%s', (_, { project, room }) => {
    const existing = existingPieces(project, room);
    // a fitted kitchen is already there: plan the living part only
    const kind = room.typeFromName === 'kitchen' && existing.length ? 'living' : KIND[room.typeFromName]!;
    const program = randomProgram(room, kind, room.roomId.length);
    const layout = solveRoom(room, program, { existing, seed: 3 });
    expect(layout.unsolved).toEqual([]);
    expect(independentCheck(room, layout, existing)).toEqual([]);
    const keepFree = room.userZones.filter((z) => z.keepFree);
    if (keepFree.length) expect(layout.items.length).toBeGreaterThan(0);
  });
});
