import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { createEmptyProject } from './factory';
import { buildMovePlan, categoryRank, checkAccess } from './movePlan';
import { addOpening, addRectRoom, closestWall } from './operations';
import type { Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

function flat(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Flur', ...props });
  addRectRoom(p, { x: 4.12, y: 0, width: 5, depth: 4, name: 'Wohnzimmer', ...props });
  const w = closestWall(p, { x: -0.06, y: 2 })!;
  addOpening(p, w.wall.id, 'door', w.s, { width: 0.9, height: 2.1 });
  const mid = closestWall(p, { x: 4.06, y: 2 })!;
  addOpening(p, mid.wall.id, 'passage', mid.s, { width: 1.0, height: 2.1 });
  return p;
}
function put(p: Project, id: string, at: { x: number; y: number }, patch: Partial<ReturnType<typeof createFurnitureFromCatalog>> = {}) {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(id)!, at), x: at.x, y: at.y, rotation: 0, ...patch };
  p.furniture.push(f);
  return f;
}

describe('stairwell and lift check (#487)', () => {
  const access = { stairWidth: 0.9, stairHeadroom: 2.1 };
  it('is unknown without measurements', () => {
    expect(checkAccess({ w: 2, d: 1, h: 1 }, undefined).status).toBe('unknown');
  });
  it('passes a slim piece and fails a wide one', () => {
    expect(checkAccess({ w: 2, d: 0.6, h: 0.8 }, access).status).toBe('ok');
    expect(checkAccess({ w: 2, d: 1.2, h: 1.1 }, access).status).toBe('no');
  });
  it('warns when the piece is tight or longer than the turn', () => {
    expect(checkAccess({ w: 2, d: 0.85, h: 0.85 }, access).status).toBe('tight');
    expect(checkAccess({ w: 2.4, d: 0.5, h: 0.5 }, { ...access, turnLength: 2 }).status).toBe('tight');
  });
  it('lets a lift rescue a piece that does not fit the stairwell', () => {
    const r = checkAccess({ w: 2, d: 1.0, h: 1.0 }, { ...access, liftWidth: 1.1, liftDepth: 2.1, liftHeight: 2.2 });
    expect(r.status).toBe('ok');
    expect(r.viaLift).toBe(true);
  });
});

describe('moving plan (#487)', () => {
  it('orders far rooms first and big pieces before small ones', () => {
    const p = flat();
    const lamp = put(p, 'generic-sofa-3', { x: 1, y: 1 }); // near entrance
    const far = put(p, 'generic-sofa-3', { x: 8, y: 2 });
    const plan = buildMovePlan(p);
    expect(plan.steps.map((s) => s.furnitureId)).toEqual([far.id, lamp.id]);
    expect(plan.steps.map((s) => s.order)).toEqual([1, 2]);
  });

  it('lists later purchases after moving-in pieces', () => {
    const p = flat();
    const later = put(p, 'generic-sofa-3', { x: 8, y: 2 }, { buyPhase: 'later' });
    const now = put(p, 'generic-sofa-3', { x: 1, y: 1 });
    expect(buildMovePlan(p).steps.map((s) => s.furnitureId)).toEqual([now.id, later.id]);
  });

  it('skips pieces that are already in the flat', () => {
    const p = flat();
    put(p, 'generic-sofa-3', { x: 1, y: 1 }, { existing: true });
    expect(buildMovePlan(p).steps).toHaveLength(0);
  });

  it('warns about a piece that does not fit the door and checks packages separately', () => {
    const p = flat();
    const big = put(p, 'generic-sofa-3', { x: 8, y: 2 }, { width: 2.4, depth: 1.2, height: 1.1 });
    expect(buildMovePlan(p).steps[0].status).toBe('no');
    expect(buildMovePlan(p).warnings).toBe(1);
    big.packages = [
      { name: 'Karton 1', width: 2.0, depth: 0.5, height: 0.3 },
      { name: 'Karton 2', width: 1.5, depth: 0.5, height: 0.3 },
    ];
    const step = buildMovePlan(p).steps[0];
    expect(step.pieces).toHaveLength(2);
    expect(step.status).toBe('ok');
    expect(step.assembly).toBe(true);
  });

  it('uses the stairwell sizes of the building', () => {
    const p = flat();
    put(p, 'generic-sofa-3', { x: 8, y: 2 }, { width: 2, depth: 0.9, height: 0.9 });
    p.moveAccess = { stairWidth: 0.8, stairHeadroom: 2.1 };
    const plan = buildMovePlan(p);
    expect(plan.accessMissing).toBe(false);
    expect(plan.steps[0].status).toBe('no');
    expect(plan.steps[0].pieces[0].messages.join(' ')).toContain('Treppenhaus');
  });

  it('reports missing building measurements and a missing entrance', () => {
    const p = flat();
    p.openings = [];
    put(p, 'generic-sofa-3', { x: 1, y: 1 });
    const plan = buildMovePlan(p);
    expect(plan.accessMissing).toBe(true);
    expect(plan.noEntrance).toBe(true);
    expect(plan.steps[0].status).toBe('unknown');
  });

  it('ranks built-ins before decor', () => {
    expect(categoryRank('kitchen')).toBeLessThan(categoryRank('sofa'));
    expect(categoryRank('sofa')).toBeLessThan(categoryRank('decor'));
  });
});
