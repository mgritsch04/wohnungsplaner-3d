import { createStore, del, delMany, get, set } from 'idb-keyval';
import type { Project } from '../model/schema';
import { newId } from '../model/ids';
import { parseProjectJson, serializeProject } from '../formats/project/projectFile';
import { referencedAssetIds, type PackageVersion } from '../formats/project/packageFile';
import { VERSION_LIMIT, VersionLimitError, cleanVersionName, contentHash, defaultVersionName } from '../versions/versions';

/**
 * Saved project states (#66) in their own IndexedDB database, keyed by project:
 *   list:<projectId>  → VersionMeta[] (newest first)
 *   data:<versionId>  → serialized project JSON of that state
 * Assets (GLB models, plan images) are NOT copied – a state only references
 * asset ids that already live in the shared asset store.
 */
const versionStore = createStore('wohnungsplaner-versions', 'versions');

export interface VersionMeta {
  id: string;
  projectId: string;
  name: string;
  /** ISO timestamp when the state was saved. */
  createdAt: string;
  /** Saved automatically before opening another state. */
  auto: boolean;
  /** Number of furniture objects (for the list). */
  items: number;
  /** Hash of the restorable content (skips duplicate automatic states). */
  hash: string;
  /** Asset ids the state references (kept alive when other projects are deleted). */
  assetIds: string[];
}

const listKey = (projectId: string) => `list:${projectId}`;
const dataKey = (versionId: string) => `data:${versionId}`;

// all writes go through one queue so concurrent saves cannot lose list entries
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  return (await get<VersionMeta[]>(listKey(projectId), versionStore)) ?? [];
}

function metaFor(p: Project, projectId: string, name: string, auto: boolean, createdAt = new Date().toISOString()): VersionMeta {
  return {
    id: newId('ver'),
    projectId,
    name: cleanVersionName(name, defaultVersionName(new Date(createdAt))),
    createdAt,
    auto,
    items: p.furniture.length,
    hash: contentHash(p),
    assetIds: referencedAssetIds(p),
  };
}

/** Save `p` as a new state of its project. Throws VersionLimitError at the limit. */
export function saveVersion(p: Project, name: string, opts: { auto?: boolean } = {}): Promise<VersionMeta> {
  return serial(async () => {
    const list = await listVersions(p.id);
    if (list.length >= VERSION_LIMIT) throw new VersionLimitError();
    const meta = metaFor(p, p.id, name, !!opts.auto);
    await set(dataKey(meta.id), serializeProject(p), versionStore);
    await set(listKey(p.id), [meta, ...list], versionStore);
    return meta;
  });
}

/** The project document of a saved state (migrated + validated like a project file). */
export async function loadVersion(versionId: string): Promise<Project | null> {
  const json = await get<string>(dataKey(versionId), versionStore);
  if (!json) return null;
  return parseProjectJson(json).project;
}

export function deleteVersion(projectId: string, versionId: string): Promise<void> {
  return serial(async () => {
    const list = await listVersions(projectId);
    await set(listKey(projectId), list.filter((m) => m.id !== versionId), versionStore);
    await del(dataKey(versionId), versionStore);
  });
}

/** Remove every saved state of a project (when the project itself is deleted). */
export function deleteAllVersions(projectId: string): Promise<void> {
  return serial(async () => {
    const list = await listVersions(projectId);
    await delMany([...list.map((m) => dataKey(m.id)), listKey(projectId)], versionStore);
  });
}

/** Asset ids referenced by the saved states of a project. */
export async function versionAssetIds(projectId: string): Promise<string[]> {
  return [...new Set((await listVersions(projectId)).flatMap((m) => m.assetIds))];
}

/** All states of a project with their documents, for the project package. */
export async function exportVersions(projectId: string): Promise<PackageVersion[]> {
  const out: PackageVersion[] = [];
  for (const m of await listVersions(projectId)) {
    const project = await loadVersion(m.id).catch(() => null);
    if (project) out.push({ name: m.name, createdAt: m.createdAt, auto: m.auto, project });
  }
  return out;
}

/** Replace the states of `projectId` with imported ones (newest VERSION_LIMIT are kept). */
export function replaceVersions(projectId: string, versions: PackageVersion[]): Promise<VersionMeta[]> {
  return serial(async () => {
    const old = await listVersions(projectId);
    await delMany(old.map((m) => dataKey(m.id)), versionStore);
    const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, VERSION_LIMIT);
    const metas: VersionMeta[] = [];
    for (const v of sorted) {
      const meta = metaFor(v.project, projectId, v.name, v.auto, v.createdAt);
      await set(dataKey(meta.id), serializeProject(v.project), versionStore);
      metas.push(meta);
    }
    await set(listKey(projectId), metas, versionStore);
    return metas;
  });
}

/** Rename a saved state (variant). Returns the updated entry or null when it does not exist. */
export function renameVersion(projectId: string, versionId: string, name: string): Promise<VersionMeta | null> {
  return serial(async () => {
    const list = await listVersions(projectId);
    const i = list.findIndex((m) => m.id === versionId);
    if (i < 0) return null;
    const updated = { ...list[i], name: cleanVersionName(name, list[i].name) };
    await set(listKey(projectId), list.map((m, j) => (j === i ? updated : m)), versionStore);
    return updated;
  });
}

/** Copy a saved state under a new name (a new variant to work from). Throws VersionLimitError at the limit. */
export function duplicateVersion(projectId: string, versionId: string, name: string): Promise<VersionMeta | null> {
  return serial(async () => {
    const list = await listVersions(projectId);
    const src = list.find((m) => m.id === versionId);
    const json = src && (await get<string>(dataKey(versionId), versionStore));
    if (!src || !json) return null;
    if (list.length >= VERSION_LIMIT) throw new VersionLimitError();
    const meta: VersionMeta = { ...src, id: newId('ver'), name: cleanVersionName(name, `${src.name} (Kopie)`), createdAt: new Date().toISOString(), auto: false };
    await set(dataKey(meta.id), json, versionStore);
    await set(listKey(projectId), [meta, ...list], versionStore);
    return meta;
  });
}
