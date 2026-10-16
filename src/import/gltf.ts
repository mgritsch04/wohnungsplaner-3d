import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** Local decoder path (copied from three.js by scripts/copy-draco.mjs). */
export const DRACO_PATH = `${import.meta.env.BASE_URL ?? '/'}draco/`;
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export class ModelFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelFileError';
  }
}

export type ModelKind = 'glb' | 'gltf';

/** Check magic bytes / JSON header. External .gltf resources (separate .bin/.png) are not supported. */
export async function sniffModelFile(file: Blob): Promise<ModelKind> {
  if (file.size === 0) throw new ModelFileError('Die Datei ist leer.');
  if (file.size > MAX_MODEL_BYTES) throw new ModelFileError(`Das Modell ist zu groß (${(file.size / 1048576).toFixed(1)} MB, max. ${MAX_MODEL_BYTES / 1048576} MB).`);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) {
    const version = head[4] | (head[5] << 8);
    if (version !== 2) throw new ModelFileError(`GLB-Version ${version} wird nicht unterstützt (nur glTF 2.0).`);
    return 'glb';
  }
  const text = await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).text();
  if (/^\s*\{/.test(text) && /"asset"\s*:/.test(text)) {
    const full = file.size <= 4 * 1024 * 1024 ? text : await file.text();
    let json: { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    try {
      json = JSON.parse(full);
    } catch {
      throw new ModelFileError('Die .gltf-Datei ist kein gültiges JSON.');
    }
    if (!json.asset?.version?.startsWith('2')) throw new ModelFileError('Nur glTF 2.0 wird unterstützt.');
    const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((r) => r.uri && !r.uri.startsWith('data:'));
    if (external) throw new ModelFileError('Diese .gltf-Datei verweist auf externe Dateien (.bin/Texturen). Bitte als .glb (alles in einer Datei) exportieren.');
    return 'gltf';
  }
  throw new ModelFileError('Kein glTF/GLB-Modell. Unterstützt werden .glb und eigenständige .gltf-Dateien.');
}

export interface ModelInfo {
  /** Bounding box size in glTF units (meters by spec). */
  size: { x: number; y: number; z: number };
  meshes: number;
  triangles: number;
  textures: number;
}

/** Parse a model and measure it. Throws ModelFileError for corrupt files. */
export async function inspectModel(data: ArrayBuffer): Promise<ModelInfo> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  try {
    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => loader.parse(data, '', resolve, reject));
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) throw new ModelFileError('Das Modell enthält keine sichtbare Geometrie.');
    const size = box.getSize(new THREE.Vector3());
    let meshes = 0;
    let triangles = 0;
    const textures = new Set<THREE.Texture>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const g = m.geometry;
      triangles += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
    });
    return { size: { x: size.x, y: size.y, z: size.z }, meshes, triangles: Math.round(triangles), textures: textures.size };
  } catch (e) {
    if (e instanceof ModelFileError) throw e;
    throw new ModelFileError(`Das Modell konnte nicht gelesen werden (${e instanceof Error ? e.message : String(e)}).`);
  } finally {
    draco.dispose();
  }
}

/**
 * Suggest real dimensions. glTF uses meters; models exported in cm or mm are
 * common, so implausible sizes get a unit suggestion – never applied silently.
 */
export function suggestUnit(size: { x: number; y: number; z: number }): { factor: number; note: string | null } {
  const max = Math.max(size.x, size.y, size.z);
  // furniture is rarely larger than ~6 m: prefer the unit that yields a plausible size
  if (max > 30 && max / 100 <= 6) return { factor: 0.01, note: 'Das Modell ist über 30 m groß – vermutlich in Zentimetern modelliert.' };
  if (max > 30) return { factor: 0.001, note: 'Das Modell ist sehr groß – vermutlich in Millimetern modelliert.' };
  if (max < 0.05) return { factor: 1, note: 'Das Modell ist kleiner als 5 cm – bitte Maße prüfen.' };
  return { factor: 1, note: null };
}
