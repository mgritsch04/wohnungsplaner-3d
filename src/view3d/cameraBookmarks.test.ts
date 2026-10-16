import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { createEmptyProject } from '../model/factory';
import { createSampleProject } from '../model/sample';
import { parseProjectJson, serializeProject } from '../formats/project/projectFile';
import { usePerformanceStore } from './performanceStore';
import {
  addCameraBookmark,
  anglesOf,
  bookmarkFromView,
  deleteCameraBookmark,
  easeInOut,
  interpolateView,
  jumpToBookmark,
  jumpToBookmarkIndex,
  lerpAngle,
  orbitFitSuppressed,
  pointAhead,
  registerOrbitRig,
  registerWalkRig,
  renameCameraBookmark,
  saveCurrentView,
  suggestBookmarkName,
  takePendingJump,
  useCameraRig,
  viewFromWalk,
  walkPoseOf,
  type CameraView,
} from './cameraBookmarks';

const orbitView: CameraView = { mode: 'orbit', position: { x: 4, y: 9, z: 12 }, target: { x: 4, y: 0.8, z: 2 } };
const walkView: CameraView = viewFromWalk({ x: 1.5, z: 2.25, eye: 1.6, yaw: 0.5, pitch: -0.2 });
const s = useProjectStore.getState;

beforeEach(() => {
  s().load(createEmptyProject());
  useUiStore.setState({ cameraMode: 'orbit', viewMode: 'split' });
  usePerformanceStore.setState({ cutaway: false });
  useCameraRig.setState({ orbit: null, walk: null, pending: null, suppressFitUntil: 0 });
});

describe('camera bookmarks: schema (#55)', () => {
  it('defaults to an empty list; projects saved before load unchanged', () => {
    expect(createEmptyProject().cameraBookmarks).toEqual([]);
    const old = JSON.parse(serializeProject(createSampleProject()));
    delete old.cameraBookmarks;
    const { project } = parseProjectJson(JSON.stringify(old));
    expect(project.cameraBookmarks).toEqual([]);
    expect(project.rooms.length).toBe(old.rooms.length);
    expect(project.furniture.length).toBe(old.furniture.length);
  });

  it('saves and loads bookmarks with the project (orbit with section view, walk with eye height)', () => {
    addCameraBookmark('Eingang', orbitView, true);
    addCameraBookmark('Küche von der Tür', walkView);
    const { project } = parseProjectJson(serializeProject(s().project));
    expect(project.cameraBookmarks).toEqual(s().project.cameraBookmarks);
    const [a, b] = project.cameraBookmarks;
    expect(a).toMatchObject({ name: 'Eingang', mode: 'orbit', position: orbitView.position, target: orbitView.target, cutaway: true });
    expect(a.eyeHeight).toBeUndefined();
    expect(b).toMatchObject({ name: 'Küche von der Tür', mode: 'walk', eyeHeight: 1.6 });
    expect(b.cutaway).toBeUndefined();
  });

  it('rejects invalid bookmarks when loading', () => {
    const p = JSON.parse(serializeProject(createEmptyProject()));
    p.cameraBookmarks = [{ id: 'v1', name: '', mode: 'orbit', position: { x: 0, y: 1, z: 0 }, target: { x: 0, y: 0, z: 0 } }];
    expect(() => parseProjectJson(JSON.stringify(p))).toThrow();
    p.cameraBookmarks = [{ id: 'v1', name: 'A', mode: 'fly', position: { x: 0, y: 1, z: 0 }, target: { x: 0, y: 0, z: 0 } }];
    expect(() => parseProjectJson(JSON.stringify(p))).toThrow();
  });
});

describe('camera bookmarks: save, rename, delete (#55)', () => {
  it('each change is one undo step', () => {
    const id = addCameraBookmark('  Eingang  ', orbitView)!;
    expect(s().project.cameraBookmarks.map((b) => b.name)).toEqual(['Eingang']);
    expect(s().past).toHaveLength(1);

    expect(renameCameraBookmark(id, 'Flur')).toBe(true);
    expect(s().project.cameraBookmarks[0].name).toBe('Flur');
    expect(s().past).toHaveLength(2);

    expect(deleteCameraBookmark(id)).toBe(true);
    expect(s().project.cameraBookmarks).toEqual([]);
    expect(s().past).toHaveLength(3);

    s().undo();
    expect(s().project.cameraBookmarks.map((b) => b.name)).toEqual(['Flur']);
    s().undo();
    expect(s().project.cameraBookmarks.map((b) => b.name)).toEqual(['Eingang']);
    s().undo();
    expect(s().project.cameraBookmarks).toEqual([]);
  });

  it('ignores empty names, unchanged names and unknown ids (no undo step)', () => {
    expect(addCameraBookmark('   ', orbitView)).toBeNull();
    const id = addCameraBookmark('A', orbitView)!;
    expect(renameCameraBookmark(id, ' ')).toBe(false);
    expect(renameCameraBookmark(id, 'A')).toBe(false);
    expect(renameCameraBookmark('nope', 'B')).toBe(false);
    expect(deleteCameraBookmark('nope')).toBe(false);
    expect(s().past).toHaveLength(1);
  });

  it('saves the current view of the active camera; rounds to millimetres', () => {
    expect(saveCurrentView('x')).toBeNull(); // no 3D camera mounted
    registerOrbitRig({ get: () => ({ position: { x: 1.23456, y: 5, z: 7 }, target: { x: 0, y: 0.8, z: 0 } }), set: () => {} });
    usePerformanceStore.setState({ cutaway: true });
    saveCurrentView('Oben');
    expect(s().project.cameraBookmarks[0]).toMatchObject({ mode: 'orbit', position: { x: 1.235, y: 5, z: 7 }, cutaway: true });

    registerWalkRig({ get: () => ({ x: 2, z: 3, eye: 1.7, yaw: Math.PI / 2, pitch: 0 }), set: () => {} });
    useUiStore.setState({ cameraMode: 'walk' });
    saveCurrentView('Gang');
    const w = s().project.cameraBookmarks[1];
    expect(w).toMatchObject({ mode: 'walk', position: { x: 2, y: 1.7, z: 3 }, eyeHeight: 1.7 });
    // yaw π/2 looks along −x
    expect(w.target.x).toBeCloseTo(1, 3);
    expect(w.target.z).toBeCloseTo(3, 3);
  });

  it('suggests a free default name', () => {
    expect(suggestBookmarkName([])).toBe('Ansicht 1');
    expect(suggestBookmarkName([{ name: 'Ansicht 2' }])).toBe('Ansicht 3');
    expect(suggestBookmarkName([{ name: 'x' }, { name: 'Ansicht 3' }])).toBe('Ansicht 4');
  });
});

describe('camera bookmarks: geometry', () => {
  it('converts between viewing angles and a target point', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [0.7, -0.3],
      [-2.5, 0.4],
    ]) {
      const p = { x: 1, y: 1.6, z: -2 };
      const a = anglesOf(p, pointAhead(p, yaw, pitch, 3));
      expect(a.yaw).toBeCloseTo(yaw, 6);
      expect(a.pitch).toBeCloseTo(pitch, 6);
    }
    expect(walkPoseOf(walkView)).toMatchObject({ x: 1.5, z: 2.25, eye: 1.6 });
    expect(walkPoseOf(walkView).yaw).toBeCloseTo(0.5, 6);
  });

  it('interpolates angles the short way round and eases the transition', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 2);
    expect(lerpAngle(0.2, 0.4, 0.5)).toBeCloseTo(0.3, 6);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
  });

  it('starts at the start pose and ends at the bookmark (also across modes)', () => {
    const o2 = { ...orbitView, position: { x: -3, y: 6, z: 5 } };
    expect(interpolateView(orbitView, o2, 0).position).toEqual(orbitView.position);
    expect(interpolateView(orbitView, o2, 1).position).toEqual(o2.position);
    const w = walkPoseOf(interpolateView(orbitView, walkView, 1));
    expect(w.x).toBeCloseTo(1.5, 6);
    expect(w.eye).toBeCloseTo(1.6, 6);
    expect(w.yaw).toBeCloseTo(0.5, 6);
    const back = interpolateView(walkView, orbitView, 1);
    expect(back.position).toEqual(orbitView.position);
    expect(back.target.y).toBeCloseTo(0.8, 6);
  });
});

describe('camera bookmarks: jumping', () => {
  it('switches to the bookmark mode and section view, then waits for that camera', () => {
    const b = bookmarkFromView('Gang', walkView);
    jumpToBookmark(b);
    expect(useUiStore.getState().cameraMode).toBe('walk');
    expect(orbitFitSuppressed()).toBe(true);
    expect(takePendingJump()).toBeNull(); // walk camera not mounted yet
    registerWalkRig({ get: () => ({ x: 0, z: 0, eye: 1.6, yaw: 0, pitch: 0 }), set: () => {} });
    expect(takePendingJump()?.bookmark).toBe(b);
    expect(takePendingJump()).toBeNull();

    const o = bookmarkFromView('Schnitt', orbitView, true);
    jumpToBookmark(o);
    expect(useUiStore.getState().cameraMode).toBe('orbit');
    expect(usePerformanceStore.getState().cutaway).toBe(true);
  });

  it('opens the 3D view from 2D and jumps by index (Alt+1 … Alt+9)', () => {
    useUiStore.setState({ viewMode: '2d' });
    expect(jumpToBookmarkIndex(0)).toBe(false);
    addCameraBookmark('A', orbitView);
    expect(jumpToBookmarkIndex(0)).toBe(true);
    expect(useUiStore.getState().viewMode).toBe('split');
    expect(useCameraRig.getState().pending?.bookmark.name).toBe('A');
  });

  it('unregistering only removes the own rig', () => {
    const a = registerOrbitRig({ get: () => orbitView, set: () => {} });
    const rigB = { get: () => orbitView, set: () => {} };
    registerOrbitRig(rigB);
    a();
    expect(useCameraRig.getState().orbit).toBe(rigB);
  });
});
