import type * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACO_PATH } from '../import/gltf';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { db } from '../persistence/db';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { downloadBlob, safeFileName } from '../ui/fileUtils';

/** Loads the imported 3D models of the project; items whose model is missing or broken keep their procedural body. */
async function loadImportedModels(project: Project): Promise<{ models: Map<string, THREE.Object3D>; failed: number }> {
  const models = new Map<string, THREE.Object3D>();
  const items = project.furniture.filter((f) => f.model.type === 'gltf');
  if (!items.length) return { models, failed: 0 };
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  let failed = 0;
  try {
    for (const f of items) {
      if (f.model.type !== 'gltf') continue;
      try {
        const blob = f.model.assetId ? await db.getAsset(f.model.assetId) : null;
        const data = blob ? await blob.arrayBuffer() : f.model.url ? await (await fetch(f.model.url)).arrayBuffer() : null;
        if (!data) {
          failed++;
          continue;
        }
        const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => loader.parse(data, '', resolve, reject));
        models.set(f.id, gltf.scene);
      } catch {
        failed++;
      }
    }
  } finally {
    draco.dispose();
  }
  return { models, failed };
}

/** Menu action: the whole flat as one .glb file (project name + .glb). */
export async function exportGlbFile() {
  const ui = useUiStore.getState();
  const project = useProjectStore.getState().project;
  try {
    // the exporter (GLTFExporter) is loaded on demand – it stays out of the start bundle
    const { exportProjectGlb } = await import('./glb');
    const { models, failed } = await loadImportedModels(project);
    const glb = await exportProjectGlb(project, derivePlan(project), { models });
    downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), `${safeFileName(project.name)}.glb`);
    ui.toast(failed ? `3D-Modell als GLB exportiert (${failed} importierte Modell(e) fehlten – Ersatzkörper verwendet).` : '3D-Modell als GLB exportiert', failed ? 'info' : 'success');
  } catch (e) {
    ui.toast(`GLB-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}
