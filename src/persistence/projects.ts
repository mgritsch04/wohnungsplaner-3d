import type { Project } from '../model/schema';
import { parseProjectJson, serializeProject } from '../formats/project/projectFile';
import { referencedAssetIds } from '../formats/project/packageFile';
import { db } from './db';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  rooms: number;
  items: number;
}

const INDEX_KEY = 'projectIndex';
const LAST_KEY = 'lastProjectId';

async function readIndex(): Promise<ProjectMeta[]> {
  return (await db.getMeta<ProjectMeta[]>(INDEX_KEY)) ?? [];
}

export async function saveProject(p: Project): Promise<void> {
  await db.putProject(p.id, serializeProject(p));
  const index = (await readIndex()).filter((m) => m.id !== p.id);
  index.unshift({ id: p.id, name: p.name, updatedAt: p.updatedAt, rooms: p.rooms.length, items: p.furniture.length });
  await db.putMeta(INDEX_KEY, index);
  await db.putMeta(LAST_KEY, p.id);
}

export async function loadProject(id: string): Promise<{ project: Project; warnings: string[] } | null> {
  const json = await db.getProject(id);
  if (!json) return null;
  return parseProjectJson(json);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const index = await readIndex();
  return [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Delete a project and the assets that no other saved project references. */
export async function deleteProject(id: string): Promise<void> {
  const loaded = await loadProject(id).catch(() => null);
  await db.deleteProject(id);
  const index = (await readIndex()).filter((m) => m.id !== id);
  await db.putMeta(INDEX_KEY, index);
  if (loaded) {
    const stillUsed = new Set<string>();
    // models referenced by the imported catalog must survive project deletion
    const catalog = (await db.getMeta<{ model: { type: string; assetId?: string } }[]>('importedCatalog')) ?? [];
    for (const c of catalog) if (c.model.type === 'gltf' && c.model.assetId) stillUsed.add(c.model.assetId);
    for (const m of index) {
      const other = await loadProject(m.id).catch(() => null);
      if (other) referencedAssetIds(other.project).forEach((a) => stillUsed.add(a));
    }
    for (const a of referencedAssetIds(loaded.project)) if (!stillUsed.has(a)) await db.deleteAsset(a);
  }
  if ((await db.getMeta<string>(LAST_KEY)) === id) await db.putMeta(LAST_KEY, index[0]?.id ?? null);
}

export async function lastProjectId(): Promise<string | null> {
  return (await db.getMeta<string | null>(LAST_KEY)) ?? null;
}
