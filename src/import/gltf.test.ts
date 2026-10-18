import { describe, expect, it } from 'vitest';
import { baseBox, inspectModel, ModelFileError, sniffModelFile, suggestUnit } from './gltf';
import { boxGlb } from '../test/glbFixture';

describe('GLB/glTF import', () => {
  it('accepts a valid GLB and measures its size in meters', async () => {
    const glb = boxGlb(0.8, 2.0, 0.6);
    expect(await sniffModelFile(new Blob([glb]))).toBe('glb');
    const info = await inspectModel(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer);
    expect(info.size.x).toBeCloseTo(0.8, 6);
    expect(info.size.y).toBeCloseTo(2.0, 6);
    expect(info.size.z).toBeCloseTo(0.6, 6);
    expect(info.meshes).toBe(1);
    expect(info.triangles).toBe(12);
  });

  it('rejects empty, foreign, external-resource and corrupt files', async () => {
    await expect(sniffModelFile(new Blob([]))).rejects.toThrow(ModelFileError);
    await expect(sniffModelFile(new Blob(['hello']))).rejects.toThrow(/Kein glTF/);
    const external = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'model.bin', byteLength: 10 }] });
    await expect(sniffModelFile(new Blob([external]))).rejects.toThrow(/externe Dateien/);
    const v1 = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0, 12, 0, 0, 0]);
    await expect(sniffModelFile(new Blob([v1]))).rejects.toThrow(/Version 1/);
    const corrupt = boxGlb(1, 1, 1).slice(0, 40);
    await expect(inspectModel(corrupt.buffer as ArrayBuffer)).rejects.toThrow(ModelFileError);
  });

  it('suggests a unit for implausibly sized models', () => {
    expect(suggestUnit({ x: 200, y: 90, z: 80 }).factor).toBe(0.01);
    expect(suggestUnit({ x: 2000, y: 900, z: 800 }).factor).toBe(0.001);
    expect(suggestUnit({ x: 2, y: 0.9, z: 0.8 })).toEqual({ factor: 1, note: null });
  });
});

describe('baseBox (#269)', () => {
  it('misst nur den unteren Teil: bei einer Topfpflanze den Topf, nicht die Blätter', async () => {
    const THREE = await import('three');
    // SYNTHETIC plant: pot 19 cm wide and 20 cm high, leaves 60 cm wide above it, 1.2 m tall in total
    const plant = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.2, 0.19));
    pot.position.y = 0.1;
    const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.5));
    leaves.position.set(0.1, 0.7, 0);
    plant.add(pot, leaves);
    const b = baseBox(plant)!;
    const size = b.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.19, 3);
    expect(size.z).toBeCloseTo(0.19, 3);
    expect(baseBox(new THREE.Group())).toBeNull();
    // one mesh for pot and leaves: only its vertices in the lowest slice count
    const merged = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.095, 1.2, 16, 12));
    merged.position.y = 0.6;
    const m = baseBox(merged)!.getSize(new THREE.Vector3());
    expect(m.x).toBeLessThan(0.25);
  });
});
