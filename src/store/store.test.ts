import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { saveProject, loadProject, listProjects, deleteProject, lastProjectId } from '../persistence/projects';
import { db } from '../persistence/db';

const props = { thickness: 0.1, height: 2.5 };

describe('project store history', () => {
  beforeEach(() => useProjectStore.getState().load(createEmptyProject()));

  it('undoes and redoes changes', () => {
    const s = useProjectStore.getState;
    s().apply((d) => void addRectRoom(d, { x: 0, y: 0, width: 3, depth: 3, name: 'A', ...props }));
    s().apply((d) => void (d.rooms[0].name = 'B'));
    expect(s().project.rooms[0].name).toBe('B');
    s().undo();
    expect(s().project.rooms[0].name).toBe('A');
    s().undo();
    expect(s().project.rooms).toHaveLength(0);
    s().redo();
    s().redo();
    expect(s().project.rooms[0].name).toBe('B');
  });

  it('collapses a drag transaction into a single undo step', () => {
    const s = useProjectStore.getState;
    s().apply((d) => void addRectRoom(d, { x: 0, y: 0, width: 3, depth: 3, name: 'A', ...props }));
    const before = s().past.length;
    s().beginTransaction();
    for (let i = 1; i <= 10; i++) s().updateTransient((d) => void (d.nodes[0].x = -0.05 - i * 0.01));
    s().commitTransaction();
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect(s().project.nodes[0].x).toBeCloseTo(-0.05, 9);
  });

  it('cancelling a transaction restores the snapshot', () => {
    const s = useProjectStore.getState;
    const start = s().project;
    s().beginTransaction();
    s().updateTransient((d) => void (d.name = 'temp'));
    s().cancelTransaction();
    expect(s().project).toBe(start);
  });
});

describe('local persistence (IndexedDB)', () => {
  it('saves, lists, loads and deletes projects with their assets', async () => {
    const p = createEmptyProject('Persistenztest');
    addRectRoom(p, { x: 0, y: 0, width: 3, depth: 2, name: 'Bad', ...props });
    await db.putAsset('asset_test', new Blob(['x']));
    p.underlay = { imageAssetId: 'asset_test', fileName: 'a.png', sourceKind: 'png', pixelWidth: 1, pixelHeight: 1, metersPerPixel: 1, calibrated: false, scaleSource: 'none', checks: [], x: 0, y: 0, rotation: 0, opacity: 0.5, visible: true, locked: false };
    await saveProject(p);
    expect(await lastProjectId()).toBe(p.id);
    expect((await listProjects()).some((m) => m.id === p.id && m.rooms === 1)).toBe(true);
    const loaded = await loadProject(p.id);
    expect(loaded?.project).toEqual(p);
    await deleteProject(p.id);
    expect(await loadProject(p.id)).toBeNull();
    expect(await db.getAsset('asset_test')).toBeUndefined();
  });
});
