import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { applyDraft, floorPlanToDraft, parseFloorPlan, parseFloorPlanJson, projectToFloorPlan } from './floorplan/convert';
import { parseProject, parseProjectJson, serializeProject, PROJECT_MIGRATIONS } from './project/projectFile';
import { buildPackage, parsePackageOrProject, referencedAssetIds } from './project/packageFile';
import { FileFormatError } from './zodErrors';
import { PROJECT_SCHEMA_VERSION } from '../model/schema';
import exampleText from '../../docs/examples/apartment-plan.example.json?raw';

describe('project file', () => {
  it('round-trips a project through JSON', () => {
    const p = createSampleProject();
    const back = parseProjectJson(serializeProject(p)).project;
    expect(back).toEqual(p);
  });

  it('rejects invalid JSON, wrong formats and newer schema versions with clear errors', () => {
    expect(() => parseProjectJson('{nope')).toThrow(FileFormatError);
    expect(() => parseProject({ format: 'apartment-plan' })).toThrow(/Grundriss-Datei/);
    expect(() => parseProject({ format: 'something' })).toThrow(/Unbekanntes Dateiformat/);
    const p = createSampleProject();
    expect(() => parseProject({ ...p, schemaVersion: PROJECT_SCHEMA_VERSION + 1 })).toThrow(/neueren Version/);
    expect(() => parseProject({ ...p, schemaVersion: 0 })).toThrow(/Schema-Version/);
  });

  it('reports schema violations with paths', () => {
    const p = createSampleProject();
    const bad = structuredClone(p) as unknown as { walls: { thickness: number }[] };
    bad.walls[0].thickness = -1;
    try {
      parseProject(bad);
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(FileFormatError);
      expect((e as FileFormatError).details.join(' ')).toMatch(/walls\.0\.thickness/);
    }
  });

  it('rejects inconsistent references', () => {
    const p = createSampleProject();
    p.openings[0].wallId = 'does-not-exist';
    expect(() => parseProject(p)).toThrow(/inkonsistente/);
  });

  it('has a migration table (empty for v1)', () => {
    expect(Object.keys(PROJECT_MIGRATIONS)).toHaveLength(PROJECT_SCHEMA_VERSION - 1);
  });
});

describe('project package', () => {
  it('embeds referenced assets and restores them', async () => {
    const p = createEmptyProject();
    p.underlay = {
      imageAssetId: 'asset_img',
      sourceAssetId: 'asset_src',
      fileName: 'plan.pdf',
      sourceKind: 'pdf',
      pixelWidth: 10,
      pixelHeight: 10,
      metersPerPixel: 0.01,
      calibrated: true,
      scaleSource: 'reference',
      checks: [],
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 0.5,
      visible: true,
      locked: false,
    };
    expect(referencedAssetIds(p).sort()).toEqual(['asset_img', 'asset_src']);
    const blobs: Record<string, Blob> = { asset_img: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) };
    const { pkg, missing } = await buildPackage(p, async (id) => blobs[id]);
    expect(missing).toEqual(['asset_src']);
    const parsed = parsePackageOrProject(JSON.stringify(pkg));
    expect(parsed.project.underlay?.fileName).toBe('plan.pdf');
    const restored = new Uint8Array(await parsed.assets.asset_img.arrayBuffer());
    expect([...restored]).toEqual([1, 2, 3]);
    expect(parsed.warnings.join(' ')).toMatch(/asset_src/);
  });

  it('also accepts a bare project file', () => {
    const p = createSampleProject();
    expect(parsePackageOrProject(JSON.stringify(p)).project.id).toBe(p.id);
  });
});

describe('apartment-plan.json', () => {
  const plan = {
    format: 'apartment-plan',
    version: 1,
    units: 'cm',
    walls: [
      { id: 'a', start: [0, 0], end: [400, 0], thickness: 20 },
      { id: 'b', start: { x: 400, y: 0 }, end: [400, 300] },
      { id: 'c', start: [400, 300], end: [0, 300] },
      { id: 'd', start: [0, 300], end: [0, 0] },
    ],
    openings: [
      { type: 'door', wall: 'c', offset: 100, width: 90, hinge: 'start', swing: 'left' },
      { type: 'window', at: [200, 0], width: 120 },
    ],
    rooms: [{ name: 'Wohnküche', labelPoint: [200, 150], statedArea: 11.0 }],
  };

  it('parses units and point formats into a draft', () => {
    const d = floorPlanToDraft(parseFloorPlan(plan), 'test.json');
    expect(d.walls).toHaveLength(4);
    expect(d.walls[0].b).toEqual({ x: 4, y: 0 });
    expect(d.walls[0].thickness).toBe(0.2);
    expect(d.walls[1].thickness).toBe(0.12); // default
    expect(d.walls[1].status).toBe('estimated');
    expect(d.openings[0].center).toEqual({ x: 3, y: 3 });
    expect(d.rooms[0].statedArea).toBeCloseTo(11.0 * 0.0001, 9);
  });

  it('applies a draft to a project, creating rooms from enclosed walls', () => {
    const p = createEmptyProject();
    const res = applyDraft(p, floorPlanToDraft(parseFloorPlan({ ...plan, units: 'm', walls: plan.walls.map((w) => ({ ...w, thickness: 0.2, start: Array.isArray(w.start) ? w.start.map((v) => v / 100) : { x: w.start.x / 100, y: w.start.y / 100 }, end: (w.end as number[]).map((v) => v / 100) })), openings: [{ type: 'door', wall: 'c', offset: 1, width: 0.9 }], rooms: [{ name: 'Wohnküche', labelPoint: [2, 1.5] }] }), 'x'));
    expect(res.roomsAdded).toBe(1);
    expect(res.openingsAdded).toBe(1);
    const g = derivePlan(p).rooms.get(p.rooms[0].id)!;
    expect(g.area).toBeCloseTo(3.8 * 2.8, 6);
    // door swing/hinge preserved relative to the original wall direction (c: from x=4 to x=0)
    const o = p.openings[0];
    const w = p.walls.find((x) => x.id === o.wallId)!;
    const a = p.nodes.find((n) => n.id === w.a)!;
    const b = p.nodes.find((n) => n.id === w.b)!;
    const reversed = b.x > a.x; // wall stored in the opposite direction to the file
    expect(o.hinge).toBe(reversed ? 'end' : 'start');
    expect(o.swing).toBe(reversed ? 'right' : 'left');
  });

  it('round-trips project → plan → project with identical geometry', () => {
    const p = createSampleProject();
    const plan = JSON.parse(JSON.stringify(projectToFloorPlan(p, { includeFurniture: true })));
    const q = createEmptyProject();
    applyDraft(q, floorPlanToDraft(parseFloorPlan(plan), 'roundtrip'));
    const area = (x: typeof p) => [...derivePlan(x).rooms.values()].map((g) => Math.round(g.area * 1000) / 1000).sort();
    expect(area(q)).toEqual(area(p));
    expect(q.openings).toHaveLength(p.openings.length);
    expect(q.walls).toHaveLength(p.walls.length);
    expect(q.furniture).toHaveLength(p.furniture.length);
    const sumW = (x: typeof p) => x.openings.reduce((s, o) => s + o.width, 0);
    expect(sumW(q)).toBeCloseTo(sumW(p), 6);
  });

  it('gives helpful errors for invalid plans', () => {
    expect(() => parseFloorPlanJson('[')).toThrow(/kein gültiges JSON/);
    expect(() => parseFloorPlan({ format: 'apartment-plan', version: 99, walls: [] })).toThrow(/nicht unterstützt/);
    expect(() => parseFloorPlan({ format: 'apartment-plan', version: 1, walls: [{ start: [0, 0] }] })).toThrow(FileFormatError);
    expect(() => parseFloorPlan({ format: 'apartment-plan', version: 1, walls: [], openings: [{ type: 'door', width: 1 }] })).toThrow(FileFormatError);
    expect(() => parseFloorPlan({ format: 'wohnungsplaner-project' })).toThrow(/Projektdatei/);
  });

  it('supports y-up coordinate systems', () => {
    const d = floorPlanToDraft(parseFloorPlan({ format: 'apartment-plan', version: 1, coordinateSystem: { y: 'up' }, walls: [{ start: [0, 0], end: [0, 3] }] }), 'x');
    expect(d.walls[0].b).toEqual({ x: 0, y: -3 });
  });
});

describe('documentation example', () => {
  it('docs/examples/apartment-plan.example.json is valid and imports cleanly', () => {
    const text = exampleText;
    const p = createEmptyProject();
    const res = applyDraft(p, floorPlanToDraft(parseFloorPlanJson(text), 'example'));
    expect(res.roomsAdded).toBe(2);
    expect(res.openingsAdded).toBe(4);
    expect(p.rooms.map((r) => r.name).sort()).toEqual(['Schlafzimmer', 'Wohnzimmer']);
  });
});
