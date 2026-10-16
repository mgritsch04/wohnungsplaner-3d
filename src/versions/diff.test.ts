import { beforeEach, describe, expect, it } from 'vitest';
import { FurnitureSchema, type Furniture } from '../model/schema';
import { createSampleProject } from '../model/sample';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { MOVE_THRESHOLD_M, ROTATE_THRESHOLD_DEG, diffFurniture, diffSummary, rotationDeltaDeg } from './diff';
import { isComparing, notifyCompareLocked, showCompareSide, startCompare, stopCompare, toggleCompareSide, useCompareStore } from './compareStore';
import { marksFor } from '../view3d/CompareMarkers';

function item(over: Partial<Furniture> & { id: string }): Furniture {
  return FurnitureSchema.parse({ name: over.id, category: 'sofa', x: 0, y: 0, width: 1, depth: 1, height: 0.8, model: { type: 'procedural', shape: 'box' }, ...over });
}

const deg = (d: number) => (d * Math.PI) / 180;

describe('furniture diff of two states (#76)', () => {
  it('detects new, removed, moved, turned and unchanged items by id', () => {
    const a = [item({ id: 'sofa', x: 1, y: 1 }), item({ id: 'tisch', x: 2, y: 2 }), item({ id: 'regal', x: 3, y: 0 }), item({ id: 'lampe', x: 0, y: 3 })];
    const b = [
      item({ id: 'sofa', x: 1, y: 1 }), // unchanged
      item({ id: 'tisch', x: 2.5, y: 2 }), // moved 50 cm
      item({ id: 'regal', x: 3, y: 0, rotation: deg(90) }), // turned
      item({ id: 'bett', x: 5, y: 5 }), // new
      // lampe removed
    ];
    const d = diffFurniture(a, b);
    const status = Object.fromEntries(d.entries.map((e) => [(e.b ?? e.a)!.id, e.status]));
    expect(status).toEqual({ sofa: 'unchanged', tisch: 'moved', regal: 'moved', bett: 'added', lampe: 'removed' });
    expect(d.counts).toEqual({ added: 1, removed: 1, moved: 2, unchanged: 1 });
    const tisch = d.entries.find((e) => e.b?.id === 'tisch')!;
    expect(tisch).toMatchObject({ match: 'id', moved: true, rotated: false });
    expect(tisch.distance).toBeCloseTo(0.5, 9);
    const regal = d.entries.find((e) => e.b?.id === 'regal')!;
    expect(regal).toMatchObject({ moved: false, rotated: true });
    expect(regal.turn).toBeCloseTo(90, 9);
    expect(diffSummary(d.counts)).toBe('2 verschoben, 1 neu, 1 entfernt');
  });

  it('uses the thresholds: below 2 cm / 1° is unchanged, from 2 cm / 1° on it is moved', () => {
    expect(MOVE_THRESHOLD_M).toBe(0.02);
    expect(ROTATE_THRESHOLD_DEG).toBe(1);
    const a = [item({ id: 'x', x: 1, y: 1 })];
    const st = (b: Partial<Furniture>) => diffFurniture(a, [item({ id: 'x', x: 1, y: 1, ...b })]).entries[0].status;
    expect(st({ x: 1.019 })).toBe('unchanged');
    expect(st({ x: 1.02 })).toBe('moved');
    expect(st({ x: 1.012, y: 1.012 })).toBe('unchanged'); // 1.7 cm diagonal
    expect(st({ x: 1.015, y: 1.015 })).toBe('moved'); // 2.1 cm diagonal
    expect(st({ elevation: 0.03 })).toBe('moved'); // lifted onto something
    expect(st({ rotation: deg(0.9) })).toBe('unchanged');
    expect(st({ rotation: deg(1) })).toBe('moved');
    expect(st({ rotation: deg(360) })).toBe('unchanged'); // a full turn is the same pose
    expect(st({ width: 2, color: '#000000' })).toBe('unchanged'); // size/colour are no position change
    // custom thresholds
    expect(diffFurniture(a, [item({ id: 'x', x: 1.05, y: 1 })], { moveThreshold: 0.1 }).entries[0].status).toBe('unchanged');
  });

  it('measures the rotation along the shorter way round', () => {
    expect(rotationDeltaDeg(deg(359.5), deg(0.2))).toBeCloseTo(0.7, 6);
    expect(rotationDeltaDeg(deg(-170), deg(170))).toBeCloseTo(20, 6);
    expect(rotationDeltaDeg(0, Math.PI)).toBeCloseTo(180, 6);
  });

  it('falls back to name + category when the id changed (nearest pairs first)', () => {
    const a = [item({ id: 'a1', name: 'Stuhl', category: 'chair', x: 0, y: 0 }), item({ id: 'a2', name: 'Stuhl', category: 'chair', x: 3, y: 0 })];
    // both chairs deleted and placed again: one at the old spot, one 1 m away from the other
    const b = [item({ id: 'b1', name: 'stuhl ', category: 'chair', x: 4, y: 0 }), item({ id: 'b2', name: 'Stuhl', category: 'chair', x: 0.005, y: 0 })];
    const d = diffFurniture(a, b);
    expect(d.counts).toEqual({ added: 0, removed: 0, moved: 1, unchanged: 1 });
    const b2 = d.entries.find((e) => e.b?.id === 'b2')!;
    expect(b2).toMatchObject({ status: 'unchanged', match: 'name' });
    expect(b2.a?.id).toBe('a1');
    expect(d.entries.find((e) => e.b?.id === 'b1')!.a?.id).toBe('a2');
    // same name but another category is not the same item
    const other = diffFurniture([item({ id: 'a1', name: 'Stuhl', category: 'chair' })], [item({ id: 'b1', name: 'Stuhl', category: 'sofa' })]);
    expect(other.counts).toMatchObject({ added: 1, removed: 1 });
  });

  it('prefers the id over a name match', () => {
    const a = [item({ id: 'x', name: 'Regal', x: 0, y: 0 }), item({ id: 'y', name: 'Regal', x: 5, y: 0 })];
    const b = [item({ id: 'y', name: 'Regal', x: 0, y: 0 })];
    const d = diffFurniture(a, b);
    expect(d.entries.find((e) => e.b?.id === 'y')).toMatchObject({ status: 'moved', match: 'id' });
    expect(d.entries.find((e) => e.status === 'removed')?.a?.id).toBe('x');
  });

  it('summarises only what changed', () => {
    expect(diffSummary({ added: 0, removed: 1, moved: 1, unchanged: 7 })).toBe('1 verschoben, 1 entfernt');
    expect(diffSummary({ added: 0, removed: 0, moved: 0, unchanged: 7 })).toBe('Keine Unterschiede bei den Möbeln');
  });

  it('marks new and moved items in B (removed ones as ghosts) and moved/removed ones in A', () => {
    const d = diffFurniture([item({ id: 'm', x: 0 }), item({ id: 'r' }), item({ id: 'u' })], [item({ id: 'm', x: 1 }), item({ id: 'n' }), item({ id: 'u' })]);
    const short = (side: 'a' | 'b') => marksFor(d, side).map((m) => `${m.kind}:${m.item.id}:${m.ghost ? 'ghost' : 'item'}:${m.item.x}`);
    expect(short('b').sort()).toEqual(['added:n:item:0', 'moved:m:item:1', 'removed:r:ghost:0']);
    expect(short('a').sort()).toEqual(['moved:m:item:0', 'removed:r:item:0']);
  });
});

describe('3D comparison mode leaves the project alone (#76)', () => {
  beforeEach(() => {
    stopCompare();
    useProjectStore.getState().load(createSampleProject());
    useUiStore.setState({ cameraMode: 'orbit', selection: null, multi: [] });
  });

  it('start, switch and end: same project object, no undo entry, no revision', () => {
    const ps = useProjectStore.getState();
    ps.apply((d) => void (d.name = 'Vorher'));
    const before = useProjectStore.getState();
    const snapshot = JSON.stringify(before.project);
    const a = structuredClone(before.project);
    const b = structuredClone(before.project);
    b.furniture[0].x += 0.5;
    b.furniture.pop();

    startCompare({ label: 'A', project: a }, { label: 'B', project: b });
    expect(isComparing()).toBe(true);
    expect(useCompareStore.getState().showing).toBe('a');
    expect(useCompareStore.getState().session!.diff.counts).toMatchObject({ moved: 1, removed: 1, added: 0 });
    toggleCompareSide();
    expect(useCompareStore.getState().showing).toBe('b');
    showCompareSide('a');
    toggleCompareSide();
    notifyCompareLocked(Date.now() + 10_000);
    stopCompare();
    expect(isComparing()).toBe(false);

    const after = useProjectStore.getState();
    expect(after.project).toBe(before.project);
    expect(JSON.stringify(after.project)).toBe(snapshot);
    expect(after.past).toBe(before.past);
    expect(after.past).toHaveLength(1);
    expect(after.future).toEqual([]);
    expect(after.revision).toBe(before.revision);
    expect(after.txBase).toBeNull();
  });

  it('keeps its own copies: changing the passed objects does not change the preview, and vice versa', () => {
    const current = useProjectStore.getState().project;
    startCompare({ label: 'Aktueller Stand', project: current }, { label: 'B', project: structuredClone(current) });
    const shown = useCompareStore.getState().session!.a.project;
    expect(shown).not.toBe(current);
    shown.furniture[0].x += 3;
    expect(useProjectStore.getState().project.furniture[0].x).toBe(current.furniture[0].x);
    stopCompare();
  });

  it('clears the selection, compares from the overview and restores the walkthrough afterwards', () => {
    const p = useProjectStore.getState().project;
    useUiStore.setState({ cameraMode: 'walk', selection: { type: 'furniture', id: p.furniture[0].id } });
    startCompare({ label: 'A', project: p }, { label: 'B', project: p });
    expect(useUiStore.getState().selection).toBeNull();
    expect(useUiStore.getState().cameraMode).toBe('orbit');
    stopCompare();
    expect(useUiStore.getState().cameraMode).toBe('walk');
    expect(useProjectStore.getState().past).toHaveLength(0);
  });
});
