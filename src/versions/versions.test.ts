import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { FurnitureSchema, PROJECT_SCHEMA_VERSION, type Furniture, type Project } from '../model/schema';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { db } from '../persistence/db';
import { deleteProject, loadProject, saveProject } from '../persistence/projects';
import { deleteAllVersions, deleteVersion, duplicateVersion, exportVersions, listVersions, loadVersion, renameVersion, replaceVersions, saveVersion } from '../persistence/versions';
import { buildPackage, parsePackageOrProject } from '../formats/project/packageFile';
import { parseProjectJson, serializeProject } from '../formats/project/projectFile';
import { openVersion } from './versionActions';
import { VERSION_LIMIT, VersionLimitError, autoVersionName, contentHash, restoreVersionContent } from './versions';
import { buildVariantPlans } from './variantPlan';
import { occupiedFraction, pairRooms, summarizeVariant } from './compare';

const walls = { thickness: 0.1, height: 2.5 };

function item(over: Partial<Furniture> & { id: string }): Furniture {
  return FurnitureSchema.parse({ name: over.id, category: 'sofa', x: 0, y: 0, width: 1, depth: 1, height: 0.8, model: { type: 'procedural', shape: 'box' }, ...over });
}

function apartment(name = 'Testwohnung'): Project {
  const p = createEmptyProject(name);
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 5, name: 'Wohnzimmer', ...walls });
  addRectRoom(p, { x: 4.1, y: 0, width: 2, depth: 2, name: 'Bad', ...walls });
  p.furniture.push(item({ id: 'sofa', x: 2, y: 1, width: 2, depth: 1, price: { amount: 500, currency: 'EUR', status: 'user' } }));
  return p;
}

const store = () => useProjectStore.getState();

describe('saved states in IndexedDB (#66)', () => {
  it('saves, lists (newest first), loads and deletes states', async () => {
    const p = apartment();
    const first = await saveVersion(p, '  Sofa   links ');
    expect(first.name).toBe('Sofa links');
    expect(first.auto).toBe(false);
    p.furniture[0].x = 3;
    const second = await saveVersion(p, '');
    expect(second.name).toMatch(/^Stand \d\d\.\d\d\.\d{4}/);
    const list = await listVersions(p.id);
    expect(list.map((m) => m.id)).toEqual([second.id, first.id]);
    expect((await loadVersion(first.id))?.furniture[0].x).toBe(2);
    expect((await loadVersion(second.id))?.furniture[0].x).toBe(3);
    await deleteVersion(p.id, first.id);
    expect((await listVersions(p.id)).map((m) => m.id)).toEqual([second.id]);
    expect(await loadVersion(first.id)).toBeNull();
    // other projects are not affected
    expect(await listVersions('proj_other')).toEqual([]);
  });

  it('stores only asset references, never copies of the blobs', async () => {
    const p = apartment();
    p.furniture.push(item({ id: 'glb', model: { type: 'gltf', assetId: 'asset_model', fallbackShape: 'box' } }));
    const meta = await saveVersion(p, 'mit Modell');
    expect(meta.assetIds).toEqual(['asset_model']);
    const raw = await loadVersion(meta.id);
    expect(raw?.furniture[1].model).toEqual({ type: 'gltf', assetId: 'asset_model', fallbackShape: 'box' });
  });

  it(`enforces the limit of ${VERSION_LIMIT} states with a clear message`, async () => {
    const p = apartment();
    await Promise.all(Array.from({ length: VERSION_LIMIT }, (_, i) => saveVersion(p, `S${i}`)));
    expect(await listVersions(p.id)).toHaveLength(VERSION_LIMIT);
    await expect(saveVersion(p, 'zu viel')).rejects.toBeInstanceOf(VersionLimitError);
    await expect(saveVersion(p, 'zu viel')).rejects.toThrow(/Obergrenze/);
    expect(await listVersions(p.id)).toHaveLength(VERSION_LIMIT);
    await deleteAllVersions(p.id);
    expect(await listVersions(p.id)).toEqual([]);
  });
});

describe('opening a state (#66)', () => {
  beforeEach(() => {
    store().load(apartment());
    useUiStore.setState({ toasts: [] });
  });

  it('restores the content in ONE undo step and keeps the current state as automatic state', async () => {
    const original = store().project;
    const saved = await saveVersion(original, 'Sofa links');
    store().apply((d) => void (d.furniture[0].x = 3.2));
    store().apply((d) => void (d.name = 'Umbenannt'));
    const pastBefore = store().past.length;

    const res = await openVersion(saved);
    expect(res?.backup?.name).toBe(autoVersionName('Sofa links'));
    expect(res?.backup?.auto).toBe(true);
    expect(store().project.furniture[0].x).toBe(2);
    expect(store().project.name).toBe('Umbenannt'); // identity stays with the project
    expect(store().project.id).toBe(original.id);
    expect(store().past.length).toBe(pastBefore + 1);

    // the state before opening is reachable as automatic state
    const backup = await loadVersion(res!.backup!.id);
    expect(backup?.furniture[0].x).toBe(3.2);

    // one undo returns to the state before opening
    store().undo();
    expect(store().project.furniture[0].x).toBe(3.2);
    store().redo();
    expect(store().project.furniture[0].x).toBe(2);
  });

  it('does not create a duplicate automatic state when the current state is already saved', async () => {
    const a = await saveVersion(store().project, 'A');
    store().apply((d) => void (d.furniture[0].x = 1.5));
    const b = await saveVersion(store().project, 'B');
    const res = await openVersion(a); // current == B → no backup needed
    expect(res?.backup).toBeNull();
    expect((await listVersions(store().project.id)).map((m) => m.name)).toEqual(['B', 'A']);
    await openVersion(b);
    expect(store().project.furniture[0].x).toBe(1.5);
    expect(await listVersions(store().project.id)).toHaveLength(2);
  });

  it('refuses to open (and changes nothing) when the current state cannot be backed up at the limit', async () => {
    const p = store().project;
    const metas = [];
    for (let i = 0; i < VERSION_LIMIT; i++) metas.push(await saveVersion(p, `S${i}`));
    store().apply((d) => void (d.furniture[0].x = 1));
    const before = store().project;
    expect(await openVersion(metas[0])).toBeNull();
    expect(store().project).toBe(before);
    expect(useUiStore.getState().toasts.at(-1)?.text).toMatch(/Obergrenze/);
  });

  it('restoreVersionContent keeps id, name and creation date', () => {
    const a = apartment('A');
    const b = apartment('B');
    b.furniture = [];
    const draft = structuredClone(a);
    restoreVersionContent(draft, b);
    expect(draft.furniture).toEqual([]);
    expect([draft.id, draft.name, draft.createdAt]).toEqual([a.id, a.name, a.createdAt]);
    expect(contentHash(draft)).toBe(contentHash(b));
  });

  it('content hash ignores key order and filled-in defaults, but sees real changes', () => {
    const a = apartment();
    const reordered = structuredClone(a);
    const { id, name, ...rest } = reordered.furniture[0];
    const partial = { ...rest, name, id } as Record<string, unknown>;
    delete partial.locked; // default, filled in again when a stored state is parsed
    reordered.furniture[0] = partial as unknown as Furniture;
    expect(contentHash(reordered)).toBe(contentHash(a));
    expect(contentHash(parseProjectJson(serializeProject(a)).project)).toBe(contentHash(a));
    reordered.furniture[0].x += 0.01;
    expect(contentHash(reordered)).not.toBe(contentHash(a));
  });
});

describe('compatibility and project package', () => {
  it('old projects load unchanged – no schema change, no states', async () => {
    const p = apartment();
    const json = serializeProject(p);
    expect(JSON.parse(json).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(parseProjectJson(json).project).toEqual(p);
    expect('versions' in parseProjectJson(json).project).toBe(false);
    expect(await listVersions(p.id)).toEqual([]);
    // an older package without a versions field
    const { pkg } = await buildPackage(p, async () => undefined);
    delete pkg.versions;
    const parsed = parsePackageOrProject(JSON.stringify(pkg));
    expect(parsed.project).toEqual(p);
    expect(parsed.versions).toEqual([]);
  });

  it('exports states in the package (assets once) and imports them for the project', async () => {
    const p = apartment();
    const blobs: Record<string, Blob> = { asset_v: new Blob([new Uint8Array([7, 8])], { type: 'model/gltf-binary' }) };
    const withModel = structuredClone(p);
    withModel.furniture.push(item({ id: 'glb', model: { type: 'gltf', assetId: 'asset_v', fallbackShape: 'box' } }));
    await saveVersion(withModel, 'Mit Modell');
    await saveVersion(withModel, 'Mit Modell 2');
    await saveVersion(p, 'Ohne', { auto: true });

    const versions = await exportVersions(p.id);
    expect(versions.map((v) => v.name)).toEqual(['Ohne', 'Mit Modell 2', 'Mit Modell']);
    const { pkg, missing } = await buildPackage(p, async (id) => blobs[id], versions);
    expect(missing).toEqual([]);
    expect(Object.keys(pkg.assets)).toEqual(['asset_v']); // only referenced by states, included once

    const parsed = parsePackageOrProject(JSON.stringify(pkg));
    expect(parsed.versions).toHaveLength(3);
    expect(parsed.versions[0]).toMatchObject({ name: 'Ohne', auto: true });
    expect(parsed.assets.asset_v).toBeDefined();

    const imported = await replaceVersions('proj_copy', parsed.versions);
    expect(imported.map((m) => m.name)).toEqual(['Ohne', 'Mit Modell 2', 'Mit Modell']);
    expect(imported.every((m) => m.projectId === 'proj_copy')).toBe(true);
    expect((await loadVersion(imported[1].id))?.furniture).toHaveLength(2);
  });

  it('skips invalid states in a package with a warning', async () => {
    const p = apartment();
    const { pkg } = await buildPackage(p, async () => undefined, [{ name: 'gut', createdAt: new Date().toISOString(), auto: false, project: p }]);
    const raw = JSON.parse(JSON.stringify(pkg));
    raw.versions.push({ name: 'kaputt', createdAt: 'x', auto: false, project: { format: 'nope' } });
    const parsed = parsePackageOrProject(JSON.stringify(raw));
    expect(parsed.versions.map((v) => v.name)).toEqual(['gut']);
    expect(parsed.warnings.join(' ')).toMatch(/„kaputt“/);
  });

  it('deleting a project removes its states; assets used by states of other projects survive', async () => {
    const a = apartment('A');
    const b = apartment('B');
    await db.putAsset('asset_shared', new Blob(['x']));
    await db.putAsset('asset_only_a', new Blob(['y']));
    const bState = structuredClone(b);
    bState.furniture.push(item({ id: 'g', model: { type: 'gltf', assetId: 'asset_shared', fallbackShape: 'box' } }));
    const aState = structuredClone(a);
    aState.furniture.push(item({ id: 'g1', model: { type: 'gltf', assetId: 'asset_shared', fallbackShape: 'box' } }));
    aState.furniture.push(item({ id: 'g2', model: { type: 'gltf', assetId: 'asset_only_a', fallbackShape: 'box' } }));
    await saveProject(a);
    await saveProject(b);
    await saveVersion(aState, 'A mit Modellen');
    await saveVersion(bState, 'B mit Modell');
    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeNull();
    expect(await listVersions(a.id)).toEqual([]);
    expect(await db.getAsset('asset_shared')).toBeDefined();
    expect(await db.getAsset('asset_only_a')).toBeUndefined();
    expect(await listVersions(b.id)).toHaveLength(1);
  });
});

describe('comparing variants (#58)', () => {
  it('uses budget prices, counts pieces and measures occupied/free floor per room', () => {
    const p = apartment();
    p.furniture.push(
      item({ id: 'chairs', category: 'chair', x: 1, y: 4, width: 0.5, depth: 0.5, quantity: 4, price: { amount: 50, currency: 'EUR', status: 'estimate' } }),
      item({ id: 'rug', category: 'textile', x: 2, y: 3, width: 2, depth: 2, height: 0.01 }), // rug: not occupied, no price
      item({ id: 'shelf', category: 'storage', x: 0.3, y: 2.5, width: 0.6, depth: 0.3, elevation: 1.5 }), // wall shelf
      item({ id: 'bath', category: 'bath', x: 5.1, y: 1, width: 1, depth: 1.6 }),
    );
    const s = summarizeVariant(p);
    expect(s.totalPrice).toBe(700);
    expect(s.missingPrices).toBe(3);
    expect(s.pieces).toBe(1 + 4 + 1 + 1 + 1);
    expect(s.objects).toBe(5);
    const derived = derivePlan(p);
    const living = s.rooms.find((r) => r.name === 'Wohnzimmer')!;
    expect(living.area).toBeCloseTo(derived.rooms.get(living.roomId)!.area, 2);
    expect(living.area).toBeCloseTo(20, 2);
    expect(living.occupied).toBeCloseTo(2 + 0.25, 1); // sofa + one chair footprint (quantity is not geometry)
    expect(living.free).toBeCloseTo(living.area - living.occupied, 5);
    const bath = s.rooms.find((r) => r.name === 'Bad')!;
    expect(bath.area).toBeCloseTo(4, 2);
    expect(bath.occupied).toBeCloseTo(1.6, 1);
    expect(s.area).toBeCloseTo(24, 2);
    expect(s.occupied).toBeCloseTo(living.occupied + bath.occupied, 5);
  });

  it('counts overlaps once and clips furniture to the room outline', () => {
    const room = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const table = item({ id: 't', x: 2, y: 2, width: 2, depth: 1 });
    const chairUnder = item({ id: 'c', x: 2, y: 2, width: 0.5, depth: 0.5 });
    expect(occupiedFraction(room, [table, chairUnder]) * 16).toBeCloseTo(2, 1);
    const halfOutside = item({ id: 'h', x: 0, y: 2, width: 2, depth: 2 }); // half of it lies outside
    expect(occupiedFraction(room, [halfOutside]) * 16).toBeCloseTo(2, 1);
    const rotated = item({ id: 'r', x: 2, y: 2, width: 2, depth: 1, rotation: Math.PI / 4 });
    expect(occupiedFraction(room, [rotated]) * 16).toBeCloseTo(2, 1);
    expect(occupiedFraction(room, [])).toBe(0);
  });

  it('pairs rooms of two variants by id, then by name', () => {
    const a = summarizeVariant(apartment());
    const other = apartment();
    other.furniture = [];
    const b = summarizeVariant(other); // different room ids, same names
    const rows = pairRooms(a, b);
    expect(rows.map((r) => [r.name, !!r.a, !!r.b])).toEqual([
      ['Wohnzimmer', true, true],
      ['Bad', true, true],
    ]);
    expect(rows[0].a!.occupied).toBeGreaterThan(rows[0].b!.occupied);
    const same = pairRooms(a, a);
    expect(same.every((r) => r.a?.roomId === r.b?.roomId)).toBe(true);
    const onlyB = pairRooms({ ...a, rooms: [] }, b);
    expect(onlyB.every((r) => r.a === null && r.b)).toBe(true);
  });
});

describe('Varianten: umbenennen, duplizieren, Grundrisse nebeneinander (#58)', () => {
  it('renames and duplicates a saved state', async () => {
    const p = apartment('Varianten');
    const a = await saveVersion(p, 'Layout A');
    const renamed = await renameVersion(p.id, a.id, '  Layout   A2 ');
    expect(renamed?.name).toBe('Layout A2');
    const copy = await duplicateVersion(p.id, a.id, 'Layout B');
    expect(copy?.name).toBe('Layout B');
    expect(copy?.id).not.toBe(a.id);
    expect(contentHash((await loadVersion(copy!.id))!)).toBe(contentHash((await loadVersion(a.id))!));
    expect((await listVersions(p.id)).map((m) => m.name)).toEqual(['Layout B', 'Layout A2']);
    expect(await renameVersion(p.id, 'nope', 'x')).toBeNull();
    await deleteAllVersions(p.id);
  });

  it('draws both plans on one frame and lists the differences', () => {
    const a = apartment();
    const b = structuredClone(a);
    b.furniture[0].x += 1;
    b.furniture.push(item({ id: 'lamp', name: 'Stehlampe', x: 1, y: 3, width: 0.3, depth: 0.3 }));
    const plans = buildVariantPlans(a, b);
    expect(plans.diff.counts).toMatchObject({ moved: 1, added: 1, removed: 0 });
    expect(plans.changes).toEqual(['sofa: 1 m verschoben', 'neu in B: Stehlampe']);
    expect(plans.svgA).toContain('data-status="moved"');
    expect(plans.svgB).toContain('data-status="added"');
    expect(plans.svgA).not.toContain('Stehlampe');
    expect(plans.svgA.match(/viewBox="[^"]+"/)![0]).toBe(plans.svgB.match(/viewBox="[^"]+"/)![0]);
  });
});
