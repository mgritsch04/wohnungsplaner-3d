import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createEmptyProject } from './factory';
import { addRectRoom } from './operations';
import { derivePlan } from './derived';
import { coveredConnections, fixtureCorners, fixtureSize, FIXTURE_ELEVATION, snapFixtureToWall, usesWater } from './fixtures';
import { placementIssues } from './placement';
import { ProjectSchema, type Fixture, type FixtureKind, type Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

/** 6 × 5 m room, interior x 0..6, y 0..5 */
function room() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 5, name: 'Küche', ...props });
  return p;
}

function fixture(p: Project, kind: FixtureKind, at: { x: number; y: number }): Fixture {
  const snap = snapFixtureToWall(p, { kind, count: 1 }, at)!;
  const f: Fixture = { id: `fix_${p.fixtures.length}`, kind, elevation: FIXTURE_ELEVATION[kind], count: 1, x: snap.x, y: snap.y, rotation: snap.rotation };
  p.fixtures.push(f);
  return f;
}

function item(p: Project, catalogId: string, x: number, y: number) {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), x, y, rotation: 0 };
  p.furniture.push(f);
  return f;
}

describe('installation plan (#64, #81)', () => {
  it('snaps a socket onto the nearest wall face, front into the room', () => {
    const p = room();
    const s = snapFixtureToWall(p, { kind: 'socket', count: 1 }, { x: 2, y: 0.3 })!;
    expect(s).not.toBeNull();
    // top wall face is y = 0; the socket box (2 cm deep) sits in front of it
    expect(s.x).toBeCloseTo(2, 6);
    expect(s.y).toBeCloseTo(fixtureSize({ kind: 'socket', count: 1 }).depth / 2, 6);
    expect(Math.cos(s.rotation)).toBeCloseTo(1, 6); // front faces +y
    // left wall (face x = 0): front faces +x
    const l = snapFixtureToWall(p, { kind: 'switch', count: 1 }, { x: 0.2, y: 3 })!;
    expect(l.x).toBeCloseTo(fixtureSize({ kind: 'switch', count: 1 }).depth / 2, 2);
    expect(l.y).toBeCloseTo(3, 6);
    expect(-Math.sin(l.rotation)).toBeCloseTo(1, 6);
  });

  it('works from the outer side of a wall too and needs a wall nearby', () => {
    const p = room();
    const out = snapFixtureToWall(p, { kind: 'water', count: 1 }, { x: 3, y: -0.4 })!;
    expect(out.y).toBeLessThan(-0.12);
    expect(snapFixtureToWall(p, { kind: 'socket', count: 1 }, { x: 3, y: 2.5 })).toBeNull();
  });

  it('keeps a radiator within the wall length', () => {
    const p = room();
    const r = snapFixtureToWall(p, { kind: 'radiator', count: 1, width: 1.2 }, { x: -0.05, y: 0.2 })!;
    const corners = fixtureCorners({ kind: 'radiator', count: 1, width: 1.2, ...r });
    // the wall centreline runs from x = -0.06 to 6.06
    expect(Math.min(...corners.map((c) => c.x))).toBeGreaterThanOrEqual(-0.06 - 1e-6);
  });

  it('marks furniture standing in front of a water connection, but not a sink or wall cabinet', () => {
    const p = room();
    const w = fixture(p, 'water', { x: 3, y: 0.1 });
    fixture(p, 'socket', { x: 1, y: 0.1 });
    const board = item(p, 'generic-sideboard', 3, 0.3);
    const sink = item(p, 'generic-k-sink-80', 3, 0.3);
    const wall = { ...item(p, 'generic-k-wall-60', 3, 0.2) };
    expect(coveredConnections(p, board).map((f) => f.id)).toEqual([w.id]);
    expect(coveredConnections(p, sink)).toEqual([]);
    expect(coveredConnections(p, wall)).toEqual([]);
    expect(usesWater(sink)).toBe(true);
    const issues = placementIssues(p, derivePlan(p), board).filter((i) => i.kind === 'connection');
    expect(issues).toHaveLength(1);
    expect(issues[0].short).toBe('steht vor einem Wasseranschluss');
    // sockets are no reason to mark anything
    const sofa = item(p, 'generic-sofa-2', 1, 0.5);
    expect(coveredConnections(p, sofa)).toEqual([]);
  });

  it('does not mark furniture a little away from the connection', () => {
    const p = room();
    fixture(p, 'drain', { x: 3, y: 0.1 });
    const board = item(p, 'generic-sideboard', 5, 0.3);
    expect(coveredConnections(p, board)).toEqual([]);
  });

  it('loads projects saved before #64 with an empty installation plan', () => {
    const p = room();
    const raw = JSON.parse(JSON.stringify(p));
    delete raw.fixtures;
    expect(ProjectSchema.parse(raw).fixtures).toEqual([]);
    p.fixtures.push({ id: 'f1', kind: 'radiator', x: 1, y: 0.05, rotation: 0, elevation: 0.15, width: 0.8, height: 0.6, count: 1 });
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p))).fixtures[0]).toMatchObject({ kind: 'radiator', width: 0.8 });
  });
});
