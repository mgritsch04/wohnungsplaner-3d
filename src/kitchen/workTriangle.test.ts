import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { derivePlan } from '../model/derived';
import { ProjectSchema, type Project } from '../model/schema';
import { DEFAULT_TRIANGLE_LIMITS, frontCenter, kitchenWorkTriangles } from './workTriangle';

const props = { thickness: 0.12, height: 2.6 };

function kitchenRoom() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 5, name: 'Küche', ...props });
  return p;
}

/** Item facing south (front = +y), front-edge centre at (x, y + depth/2). */
function put(p: Project, catalogId: string, x: number, y: number, rotation = 0) {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), x, y, rotation };
  p.furniture.push(f);
  return f;
}

const tri = (p: Project, limits = DEFAULT_TRIANGLE_LIMITS) => kitchenWorkTriangles(p, derivePlan(p), limits);

describe('kitchen work triangle (#82)', () => {
  it('measures front-edge centres and accepts a triangle within the rule of thumb', () => {
    const p = kitchenRoom();
    const sink = put(p, 'generic-k-sink-80', 1, 0.3);
    put(p, 'generic-k-cooktop', 2.8, 0.3);
    put(p, 'generic-k-fridge', 2, 2.5, Math.PI); // facing north
    expect(frontCenter(sink)).toEqual({ x: 1, y: 0.6 });
    const [r] = tri(p);
    expect(r.roomName).toBe('Küche');
    expect(r.sides!.map((s) => s.length.toFixed(3))).toEqual(['1.801', '1.807', '1.866']);
    expect(r.sides!.every((s) => s.status === 'ok')).toBe(true);
    expect(r.sum).toBeCloseTo(5.473, 3);
    expect(r.ok).toBe(true);
    expect(r.messages).toEqual([]);
  });

  it('flags a side that is too short', () => {
    const p = kitchenRoom();
    put(p, 'generic-k-sink-80', 1, 0.3);
    put(p, 'generic-k-cooktop', 1.8, 0.3); // 0.80 m next to the sink
    put(p, 'generic-k-fridge', 1.4, 2.5, Math.PI);
    const [r] = tri(p);
    expect(r.ok).toBe(false);
    expect(r.sides![0]).toMatchObject({ from: 'sink', to: 'cooktop', status: 'short' });
    expect(r.messages[0]).toBe('Spüle – Herd: 0,80 m ist kürzer als 1,20 m.');
  });

  it('flags a total that is too long (long walking distances)', () => {
    const p = kitchenRoom();
    put(p, 'generic-k-sink-80', 0.5, 0.3);
    put(p, 'generic-k-cooktop', 3.1, 0.3);
    put(p, 'generic-k-fridge', 5.6, 4.1, Math.PI);
    const [r] = tri(p);
    expect(r.sumStatus).toBe('long');
    expect(r.sum!).toBeGreaterThan(8);
    expect(r.messages.some((m) => m.startsWith('Summe') && m.includes('länger als 8,00 m'))).toBe(true);
  });

  it('reports missing elements clearly; an oven counts when there is no cooktop', () => {
    const p = kitchenRoom();
    put(p, 'generic-k-sink-80', 1, 0.3);
    put(p, 'generic-k-oven', 2.8, 0.3);
    const [r] = tri(p);
    expect(r.corners).toBeUndefined();
    expect(r.messages).toEqual(['Arbeitsdreieck nicht prüfbar: Kühlschrank fehlt im Raum „Küche“.']);
    put(p, 'generic-k-fridge', 2, 2.5, Math.PI);
    expect(tri(p)[0].corners!.cooktop.id).toBe(p.furniture[1].id); // oven as cooking place
  });

  it('ignores rooms without kitchen appliances', () => {
    const p = kitchenRoom();
    put(p, 'generic-sofa-3', 3, 2);
    expect(tri(p)).toEqual([]);
  });

  it('uses adjustable limits and picks the shortest combination', () => {
    const p = kitchenRoom();
    put(p, 'generic-k-sink-80', 1, 0.3);
    put(p, 'generic-k-sink-80', 5.5, 0.3); // second sink far away
    put(p, 'generic-k-cooktop', 2.8, 0.3);
    put(p, 'generic-k-fridge', 2, 2.5, Math.PI);
    const [r] = tri(p);
    expect(r.corners!.sink.id).toBe(p.furniture[0].id);
    expect(tri(p, { ...DEFAULT_TRIANGLE_LIMITS, sideMin: 1.85 })[0].sides!.filter((s) => s.status === 'short')).toHaveLength(2);
  });

  it('old projects load with the default limits', () => {
    const raw = structuredClone(createEmptyProject()) as unknown as { settings: Record<string, unknown> };
    delete raw.settings.kitchenTriangle;
    expect(ProjectSchema.parse(raw).settings.kitchenTriangle).toEqual({ show: true, sideMin: 1.2, sideMax: 2.7, sumMin: 4, sumMax: 8 });
    expect(ProjectSchema.parse({ ...raw, settings: { ...raw.settings, kitchenTriangle: { sideMax: 3 } } }).settings.kitchenTriangle).toEqual({
      show: true,
      sideMin: 1.2,
      sideMax: 3,
      sumMin: 4,
      sumMax: 8,
    });
  });
});
