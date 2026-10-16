import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orbitKeyInput, orbitKeyMoves, orbitKeySpeed, orbitPlaneStep, type OrbitKeyContext } from './orbitKeys';

const ctx = (o: Partial<OrbitKeyContext> = {}): OrbitKeyContext => ({ viewMode: '3d', cameraMode: 'orbit', furnitureSelected: false, comparing: false, pointerOver: false, ...o });

describe('keyboard navigation of the 3D overview (#132)', () => {
  it('moves the camera with W A S D and the arrow keys in the 3D view', () => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft']) expect(orbitKeyMoves(k, ctx())).toBe(true);
    expect(orbitKeyMoves('KeyQ', ctx())).toBe(false);
  });

  it('leaves the keys to the plan, the walkthrough, a selected item and the comparison', () => {
    expect(orbitKeyMoves('KeyW', ctx({ viewMode: '2d' }))).toBe(false);
    expect(orbitKeyMoves('KeyW', ctx({ cameraMode: 'walk' }))).toBe(false);
    // split view: only with the mouse over the 3D side (else W = wall tool)
    expect(orbitKeyMoves('KeyW', ctx({ viewMode: 'split' }))).toBe(false);
    expect(orbitKeyMoves('KeyW', ctx({ viewMode: 'split', pointerOver: true }))).toBe(true);
    // arrows nudge a selected item; W A S D still move the view
    expect(orbitKeyMoves('ArrowUp', ctx({ furnitureSelected: true }))).toBe(false);
    expect(orbitKeyMoves('KeyW', ctx({ furnitureSelected: true }))).toBe(true);
    // comparison: A / B switch the side
    expect(orbitKeyMoves('KeyA', ctx({ comparing: true }))).toBe(false);
    expect(orbitKeyMoves('ArrowLeft', ctx({ comparing: true }))).toBe(true);
  });

  it('combines held keys and cancels opposite ones', () => {
    expect(orbitKeyInput(['KeyW', 'KeyD'])).toEqual([1, 1]);
    expect(orbitKeyInput(['KeyW', 'ArrowUp'])).toEqual([0, 1]);
    expect(orbitKeyInput(['KeyA', 'KeyD'])).toEqual([0, 0]);
  });

  it('moves in the floor plane relative to the viewing direction', () => {
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 10, 10);
    cam.lookAt(0, 0, 0); // looking towards -z, downwards
    cam.updateMatrixWorld();
    const fwd = orbitPlaneStep(cam, [0, 1], 2);
    expect(fwd.y).toBe(0);
    expect(fwd.z).toBeCloseTo(-2);
    expect(fwd.x).toBeCloseTo(0);
    const right = orbitPlaneStep(cam, [1, 0], 1);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
    // diagonal is not faster
    expect(orbitPlaneStep(cam, [1, 1], 1).length()).toBeCloseTo(1);
    // straight down: forward falls back to the camera's up direction
    cam.position.set(0, 10, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    expect(orbitPlaneStep(cam, [0, 1], 1).length()).toBeCloseTo(1);
  });

  it('scales the speed with the distance and Shift', () => {
    expect(orbitKeySpeed(1, false)).toBe(1.5);
    expect(orbitKeySpeed(20, false)).toBeCloseTo(12);
    expect(orbitKeySpeed(20, true)).toBeGreaterThan(orbitKeySpeed(20, false));
  });
});
