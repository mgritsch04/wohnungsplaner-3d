/**
 * The run as the panel shows it (#442) and stage 6: pieces of the same kind become one line with
 * a count, every line knows its programme pieces, and a found product only counts once the room
 * places and walks through just as well with it.
 */
import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import { analyzeFlat } from '../analysis';
import { roomConceptOf } from '../concept/flatConcept';
import { TEST_FLATS } from '../fixtures/flats';
import { RECORDED } from '../fixtures/recorded';
import { reviewFlat, reviewRoom } from '../review';
import { asPlaced, reviewInputOf, type FurnishRunResult } from '../run';
import { existingPieces, solveRoom } from '../solver/solve';
import { programFromRecorded } from '../solver/recordedProgram';
import { parseFlatConcept } from '../concept/flatConcept';
import { testFlatInput } from '../concept/testFlats';
import type { RoomType } from '../../suggest/furnishing';
import { pickItems, placedRooms, proposalFrom, withProduct } from './proposal';
import { furnishingSheet } from './sheet';

/** A whole run built from the recorded answers, without asking Claude. */
function recordedRun(key: 'B' = 'B'): { result: FurnishRunResult; project: ReturnType<typeof TEST_FLATS.B.build> } {
  const input = testFlatInput(key);
  const project = input.project;
  const analysis = analyzeFlat(project);
  const rec = RECORDED[key]!;
  const concept = parseFlatConcept(rec.concept, input).value;
  const rooms = Object.keys(rec.programs).flatMap((name) => {
    const room = analysis.rooms.find((r) => r.name === name);
    if (!room) return [];
    const existing = existingPieces(project, room);
    const program = programFromRecorded(rec.programs[name], room, existing);
    const layout = solveRoom(room, program, { existing, seed: 7 });
    const type = roomConceptOf(concept, room).type as RoomType;
    const palette = concept.style.palette.map((c) => c.hex);
    const review = reviewRoom(reviewInputOf({ analysis: room, type, layout, program, existing: asPlaced(existing), palette }));
    return [{ roomId: room.roomId, program, layout, review, rounds: 0 }];
  });
  const inputs = rooms.map((r) => {
    const room = analysis.rooms.find((a) => a.roomId === r.roomId)!;
    return reviewInputOf({ analysis: room, type: roomConceptOf(concept, room).type as RoomType, layout: r.layout, program: r.program, existing: asPlaced(existingPieces(project, room)), palette: concept.style.palette.map((c) => c.hex) });
  });
  return { result: { analysis, concept, rooms, review: reviewFlat(inputs), failed: [], conceptProblems: [], calls: [] }, project };
}

describe('proposalFrom', () => {
  const { result, project } = recordedRun();

  it('makes a room list with reason, brief and the walk-through behind it', () => {
    const p = proposalFrom(result, project);
    expect(p.summary).toBe(result.concept.living);
    expect(p.rooms.map((r) => r.roomId).sort()).toEqual(result.rooms.map((r) => r.roomId).sort());
    for (const room of p.rooms) {
      expect(room.picks.length).toBeGreaterThan(0);
      for (const pick of room.picks) {
        expect(pick.reason).toBeTruthy();
        expect(pick.label).toBeTruthy();
        expect(pick.quantity).toBeGreaterThan(0);
        // every line knows the programme pieces it stands for, as many as it counts
        expect(pickItems(pick)).toHaveLength(pick.quantity);
      }
      expect(room.brief?.zones.length).toBeGreaterThan(0);
      expect(room.brief?.palette).toEqual(result.concept.style.palette.map((c) => c.hex));
    }
  });

  it('counts pieces of the same kind in one line instead of repeating them', () => {
    const p = proposalFrom(result, project);
    for (const room of p.rooms) {
      const keys = room.picks.map((x) => `${x.catalogId}|${x.zone}|${x.label}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
    // the dining chairs of the living kitchen are one line with four
    const kitchen = p.rooms.find((r) => r.roomId === result.analysis.rooms.find((a) => a.name === 'Wohnküche')!.roomId)!;
    expect(kitchen.picks.some((x) => x.quantity > 1)).toBe(true);
  });

  it('leaves out what found no place and says so under the planner check', () => {
    const p = proposalFrom(result, project);
    for (const room of p.rooms) {
      const run = result.rooms.find((r) => r.roomId === room.roomId)!;
      expect(room.fixes ?? []).toHaveLength(run.layout.dropped.length);
      const shown = room.picks.flatMap(pickItems);
      for (const d of run.layout.dropped) expect(shown).not.toContain(d.id);
    }
  });

  it('gives the preview the placed rooms with their zones', () => {
    const placed = placedRooms(result);
    expect(placed).toHaveLength(result.rooms.length);
    for (const r of placed) {
      expect(r.layout.items.length).toBeGreaterThan(0);
      expect(r.program?.zones.length).toBeGreaterThan(0);
    }
  });
});

describe('withProduct', () => {
  const { result, project } = recordedRun();
  const room = result.rooms.find((r) => r.program.items.some((i) => i.catalogId === 'generic-nightstand'))!;
  const target = room.program.items.find((i) => i.catalogId === 'generic-nightstand')!;
  // a real product looks like its placeholder, only with its own id, size and price
  const base = findCatalogItem('generic-nightstand')!;
  const product = (id: string, patch: Partial<CatalogItem> = {}): CatalogItem => ({ ...base, id, name: `Produkt ${id}`, price: { amount: 99, currency: 'EUR', status: 'estimate' }, ...patch });

  it('takes a product that fits: it stands in the room and the walk-through is no worse', () => {
    const p = product('fits');
    const r = withProduct(result, project, { roomId: room.roomId, items: [target.id], catalogId: p.id }, [p], {}, 7);
    expect(r.taken).toBe(true);
    const after = r.result.rooms.find((x) => x.roomId === room.roomId)!;
    expect(after.program.items.find((i) => i.id === target.id)?.catalogId).toBe(p.id);
    expect(after.layout.items.some((i) => i.catalogId === p.id)).toBe(true);
    expect(after.review.findings.filter((f) => f.severity === 'S')).toHaveLength(room.review.findings.filter((f) => f.severity === 'S').length);
    // the other rooms are untouched
    expect(r.result.rooms.filter((x) => x.roomId !== room.roomId)).toEqual(result.rooms.filter((x) => x.roomId !== room.roomId));
  });

  it('does not take a product that no longer fits into the room', () => {
    const huge = product('huge', { width: 2.4, depth: 1.2, height: 2.2 });
    const r = withProduct(result, project, { roomId: room.roomId, items: [target.id], catalogId: huge.id }, [huge], {}, 7);
    expect(r.taken).toBe(false);
    expect(r.why).toBeTruthy();
    expect(r.result).toBe(result);
  });

  it('leaves everything as it is for a room that does not belong to the proposal', () => {
    const p = product('fits');
    const r = withProduct(result, project, { roomId: 'gibt-es-nicht', items: [], catalogId: p.id }, [p]);
    expect(r.taken).toBe(false);
    expect(r.result).toBe(result);
  });
});

describe('Einrichtungsblatt (#436)', () => {
  const { result, project } = recordedRun();
  const names = Object.fromEntries(project.rooms.map((r) => [r.id, r.name]));

  it('names each room, what stands where with its measures and why, and the lights with height and colour temperature', () => {
    const sheet = furnishingSheet(result, names);
    expect(sheet).toContain('# Einrichtungsblatt (Kaufbar)');
    expect(sheet).toContain(result.concept.style.idea);
    for (const r of result.rooms) expect(sheet).toContain(`## ${names[r.roomId]}`);
    // the sofa of the living kitchen: measures, wall or free place, which way it faces, its reason
    expect(sheet).toMatch(/\| Schlafsofa[^|]*\| 210 × 90 × 82 \| (an W\d \([A-Za-zü]+\), Mitte \d+ cm von der Ecke mit W\d|frei im Raum[^|]*); Blick nach [A-Za-zü]+ \| .+\|/);
    // the chairs of the dining table counted once
    expect(sheet).toMatch(/Dazu: 4 × Stuhl/);
    expect(sheet).toMatch(/Pendelleuchte[^\n]*Unterkante \d+ cm über dem Boden[^\n]*2700 K, dimmbar/);
    expect(furnishingSheet(result, names, [], [result.rooms[0].roomId], 'Ideal')).not.toContain(`## ${names[result.rooms[1].roomId]}`);
  });
});
