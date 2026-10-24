/**
 * Einbau of the new proposal (#442): the solver's layouts of the test flats become furniture
 * that the plan's own checks accept – no piece in a wall, in an opened door leaf, in a door
 * swing, in front of a water connection or in another piece – with names, colours, worktops and
 * zones, and an applied proposal is replaced, never stacked.
 */
import { describe, expect, it } from 'vitest';
import { derivePlan } from '../../model/derived';
import { placementIssues } from '../../model/placement';
import type { Project } from '../../model/schema';
import { applyFurnishing } from '../../suggest/furnishing';
import { analyzeFlat } from '../analysis';
import { TEST_FLATS, type FlatKey } from '../fixtures/flats';
import { RECORDED } from '../fixtures/recorded';
import { programFromRecorded } from '../solver/recordedProgram';
import { existingPieces, solveRoom } from '../solver/solve';
import { randomProgram, type Kind } from '../solver/testPrograms';
import type { RoomProgram, RoomType } from '../types';
import { isPlaceholderId, layoutSuggestion, type PlacedRoom } from '.';

const KIND: Partial<Record<RoomType, Kind>> = { living: 'living', bedroom: 'bedroom', kids: 'bedroom', office: 'office', dining: 'dining', hall: 'hall', kitchen: 'kitchen', other: 'living' };

/** The rooms of a test flat as the solver places them: recorded programmes for A and B, random ones for the others. */
function placed(key: FlatKey, project: Project): PlacedRoom[] {
  const rooms: PlacedRoom[] = [];
  const rec = RECORDED[key];
  for (const room of analyzeFlat(project).rooms) {
    const existing = existingPieces(project, room);
    let program: RoomProgram;
    let type = room.typeFromName as RoomType;
    if (rec) {
      const raw = rec.programs[room.name];
      if (!raw) continue;
      program = programFromRecorded(raw, room, existing);
      type = (rec.concept.rooms.find((r) => r.room === room.name)?.type ?? type) as RoomType;
    } else {
      if (!KIND[room.typeFromName] || room.area <= 4) continue;
      program = randomProgram(room, room.typeFromName === 'kitchen' && existing.length ? 'living' : KIND[room.typeFromName]!, room.roomId.length);
    }
    rooms.push({ analysis: room, type, program, layout: solveRoom(room, program, { existing, seed: 7 }) });
  }
  return rooms;
}

describe('Einbau of the new proposal', () => {
  it.each(['A', 'B', 'C', 'D', 'E', 'F'] as FlatKey[])('flat %s: every piece passes the plan checks', (key) => {
    const project = TEST_FLATS[key].build();
    const s = layoutSuggestion(project, placed(key, project));
    expect(s.items.length).toBeGreaterThan(10);
    const p = { ...project, furniture: [...project.furniture, ...s.items] };
    const d = derivePlan(p);
    const issues = s.items.flatMap((f) => placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`));
    expect(issues).toEqual([]);
  });

  it('names placeholders after the programme, colours them and completes the kitchen', () => {
    const project = TEST_FLATS.A.build();
    const rooms = placed('A', project);
    const s = layoutSuggestion(project, rooms);
    const kitchen = s.rooms.find((r) => r.roomName === 'Küche')!;
    const types = kitchen.placed.map((f) => f.kitchen?.type).filter(Boolean);
    expect(types.filter((t) => t === 'countertop').length).toBe(1);
    expect(types.filter((t) => t === 'cooktop').length).toBe(1);
    expect(types.filter((t) => t === 'wall').length).toBeGreaterThan(0);
    expect(kitchen.placed.every((f) => f.suggested)).toBe(true);

    const room = rooms.find((r) => r.analysis.name === 'Küche')!;
    const table = room.program!.items.find((i) => i.id === 'table')!;
    const item = kitchen.placed.find((f) => f.name.startsWith(table.label ?? '-'));
    expect(item?.name).toBe(`${table.label} (Platzhalter)`);
    expect(isPlaceholderId(item!.catalogId!)).toBe(true);
    if (table.color) expect(item!.color).toBe(table.color);

    // every piece keeps the pose the solver found
    const solved = room.layout.items.find((i) => i.id === 'table')!;
    expect(item!.x).toBeCloseTo(solved.x, 4);
    expect(item!.y).toBeCloseTo(solved.y, 4);
    expect(item!.rotation).toBe(solved.rotation);
  });

  it('carries the zones of the programmes and the pieces that found no place', () => {
    const project = TEST_FLATS.A.build();
    const rooms = placed('A', project);
    const s = layoutSuggestion(project, rooms);
    const zones = rooms.flatMap((r) => r.program?.zones ?? []);
    expect(s.zones?.length).toBe(zones.length);
    for (const z of s.zones!) expect(z.points).toHaveLength(4);
    const dropped = rooms.reduce((n, r) => n + r.layout.dropped.length, 0);
    expect(s.rooms.reduce((n, r) => n + (r.notes?.length ?? 0), 0)).toBe(dropped);
  });

  it('replaces an applied proposal in the same rooms instead of stacking it', () => {
    const project = TEST_FLATS.B.build();
    const own = project.furniture.length;
    const rooms = placed('B', project);
    const first = layoutSuggestion(project, rooms);
    expect(first.replaces).toEqual([]);
    applyFurnishing(project, first);
    const second = layoutSuggestion(project, rooms);
    expect(new Set(second.replaces)).toEqual(new Set(first.items.map((f) => f.id)));
    applyFurnishing(project, second);
    expect(project.furniture.length).toBe(own + second.items.length);
  });
});
