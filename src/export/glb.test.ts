import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { createSampleProject } from '../model/sample';
import { buildExportScene, exportProjectGlb, readGlbJson } from './glb';

const header = (glb: ArrayBuffer) => {
  const v = new DataView(glb);
  return { magic: new TextDecoder().decode(new Uint8Array(glb, 0, 4)), version: v.getUint32(4, true), length: v.getUint32(8, true) };
};

describe('GLB export (#87)', () => {
  it('writes valid binary glTF 2.0 for the sample apartment', async () => {
    const p = createSampleProject();
    const glb = await exportProjectGlb(p, derivePlan(p));
    const h = header(glb);
    expect(h.magic).toBe('glTF');
    expect(h.version).toBe(2);
    expect(h.length).toBe(glb.byteLength);
    expect(readGlbJson(glb).asset.version).toBe('2.0');
  });

  it('contains the expected named nodes: walls, floors per room, doors/windows, every furniture item', async () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const json = readGlbJson(await exportProjectGlb(p, d));
    const names = (json.nodes ?? []).map((n) => n.name ?? '');
    for (const group of ['Wände', 'Böden', 'Türen und Fenster', 'Möbel']) expect(names).toContain(group);
    expect(names.filter((n) => /^Wand \d+$/.test(n))).toHaveLength(p.walls.length);
    for (const r of p.rooms) expect(names).toContain(r.name);
    const doors = p.openings.filter((o) => o.kind === 'door').length;
    expect(names.filter((n) => /^Tür \d+/.test(n)).length).toBeGreaterThanOrEqual(doors);
    expect(names.filter((n) => /^Fenster \d+/.test(n)).length).toBeGreaterThanOrEqual(p.openings.filter((o) => o.kind === 'window').length);
    // every furniture item is one named node (duplicates such as two night stands included)
    const furnitureGroup = json.nodes!.find((n) => n.name === 'Möbel')!;
    expect(furnitureGroup.children).toHaveLength(p.furniture.length);
    expect(furnitureGroup.children!.map((i) => json.nodes![i].name).sort()).toEqual(p.furniture.map((f) => f.name).sort());
    expect((json.meshes ?? []).length).toBeGreaterThan(10);
  });

  it('uses metres with Y up and places furniture at its plan position', () => {
    const p = createSampleProject();
    const scene = buildExportScene(p, derivePlan(p));
    const f = p.furniture[0];
    const node = scene.getObjectByName('Möbel')!.children[0];
    expect(node.name).toBe(f.name);
    expect(node.position.toArray()).toEqual([f.x, f.elevation, f.y]);
    const box = new THREE.Box3().setFromObject(scene.getObjectByName('Wände')!);
    expect(box.max.y).toBeCloseTo(p.walls[0].height, 3); // wall height in metres, upwards
    expect(box.max.x - box.min.x).toBeGreaterThan(8); // the 8.6 m wide sample, not centimetres
    expect(box.max.x - box.min.x).toBeLessThan(10);
  });

  it('uses a supplied imported model instead of the procedural body, scaled to the item', () => {
    const p = createSampleProject();
    const f = p.furniture[0];
    const model = new THREE.Mesh(new THREE.BoxGeometry(100, 50, 30)); // e.g. a model in centimetres
    model.name = 'importiert';
    const scene = buildExportScene(p, derivePlan(p), { models: new Map([[f.id, model]]) });
    const node = scene.getObjectByName('Möbel')!.children[0];
    expect(node.getObjectByName('importiert')).toBeDefined();
    const size = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(f.height, 3);
  });

  it('exports an empty project without error', async () => {
    const p = createEmptyProject('Leer');
    const glb = await exportProjectGlb(p, derivePlan(p));
    expect(header(glb).magic).toBe('glTF');
    const names = (readGlbJson(glb).nodes ?? []).map((n) => n.name);
    expect(names).toContain('Möbel');
  });
});
