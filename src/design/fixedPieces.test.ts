/**
 * Own pieces as fixed givens of the furnishing suggestion (#493): a fixed bike, desk or poster is
 * read like fitted pieces (obstacle, relation target, "already there"), an unfixed own piece is not.
 */
import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { emptyForm, ownItemFromForm, type OwnForm } from '../catalog/own';
import { derivePlan } from '../model/derived';
import type { Furniture, Project } from '../model/schema';
import { boundsOf } from '../model/vec';
import { FurnitureSchema } from '../model/schema';
import { analyzeFlat, roomSketch } from './analysis';
import { TEST_FLATS } from './fixtures/flats';
import { ownGivenAlready } from './concept/roomProgram';
import { existingPieces, solveRoom } from './solver/solve';
import { randomProgram } from './solver/testPrograms';
import { independentCheck } from './solver/verify';

function ownPiece(project: Project, shape: string, name: string, at: { x: number; y: number }, patch: Partial<OwnForm> = {}): Furniture {
  const item = ownItemFromForm({ ...emptyForm(shape), name, ...patch });
  const f = createFurnitureFromCatalog(item, { x: at.x, y: at.y });
  project.furniture.push(f);
  return f;
}

describe('own pieces in the furnishing suggestion', () => {
  const project = TEST_FLATS.A.build();
  const d = derivePlan(project);
  const living = project.rooms.find((r) => r.name === 'Wohnzimmer')!;
  const c = d.rooms.get(living.id)!.centroid;
  const box = boundsOf(d.rooms.get(living.id)!.interior)!;
  // the bike stands along the north wall, the desk in the opposite corner; the poster hangs above the bike
  const bike = ownPiece(project, 'bike', 'Rennrad', { x: box.minX + 1.2, y: box.minY + 0.35 });
  const loose = ownPiece(project, 'chair', 'Hocker lose', { x: c.x + 1, y: c.y }, { fixed: false });
  const desk = ownPiece(project, 'desk', 'Schreibtisch Eiche', { x: box.maxX - 0.8, y: box.maxY - 0.4 }, { fixed: true });
  const poster = ownPiece(project, 'picture', 'Poster Berge', { x: box.minX + 1.2, y: box.minY + 0.02 }, { fixed: true, elevation: 140 });
  const flat = analyzeFlat(project);
  const room = flat.rooms.find((r) => r.roomId === living.id)!;

  it('own pieces are fixed by default and valid furniture', () => {
    for (const f of [bike, desk, poster]) {
      expect(f.fixed).toBe(true);
      expect(FurnitureSchema.safeParse(f).success).toBe(true);
    }
    expect(loose.fixed).toBeUndefined();
  });

  it('reads fixed own pieces as existing, not the loose one', () => {
    expect(room.existing).toContain(bike.id);
    expect(room.existing).toContain(desk.id);
    expect(room.existing).toContain(poster.id);
    expect(room.existing).not.toContain(loose.id);
  });

  it('tells Claude about them, with the mounting height of a hanging one', () => {
    const text = roomSketch({ project, flat }, room);
    expect(text).toMatch(/Bestand \(bleibt stehen, nicht neu planen\): .*Rennrad/);
    expect(text).toMatch(/Poster Berge[^;]*hängt ab 140 cm Höhe/);
    expect(text).not.toContain('Hocker lose');
  });

  it('the solver plans around them without a hard rule broken', () => {
    const existing = existingPieces(project, room);
    expect(existing.map((e) => e.id)).toEqual(expect.arrayContaining([bike.id, desk.id]));
    const layout = solveRoom(room, randomProgram(room, 'living', 5), { existing, seed: 3 });
    expect(layout.unsolved).toEqual([]);
    expect(independentCheck(room, layout, existing)).toEqual([]);
  });

  it('a second desk or bed is not planned next to a fixed own one', () => {
    expect(ownGivenAlready([desk], 'desk', 'office')).toBe(true);
    expect(ownGivenAlready([desk], 'bed', 'bedroom')).toBe(false);
    expect(ownGivenAlready([ownPiece(project, 'bed', 'Bett', { x: 0, y: 0 })], 'bed', 'bedroom')).toBe(true);
    // two beds are normal in a children's room
    expect(ownGivenAlready([ownPiece(project, 'bed', 'Bett', { x: 0, y: 0 })], 'bed', 'kids')).toBe(false);
    expect(ownGivenAlready([loose], 'desk', 'office')).toBe(false);
  });
});
