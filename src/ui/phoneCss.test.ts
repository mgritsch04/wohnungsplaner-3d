/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pinchView, screenToWorld, worldToScreen } from '../editor2d/viewTransform';
import { stickVector } from '../view3d/touchWalk';
import { isEditableTarget } from './phoneLayout';
import { selectionLabel } from './MobileBar';
import { createSampleProject } from '../model/sample';

// Safari-only properties do not survive in Chromium's CSSOM, so the E2E test cannot see them (#164)
describe('phone.css (#164)', () => {
  // via a variable: Vite would otherwise turn `new URL('…css', import.meta.url)` into an asset URL
  const here = import.meta.url;
  const css = readFileSync(new URL('./phone.css', here), 'utf8');
  it('switches off text selection and the iOS callout, but not in input fields', () => {
    expect(css).toMatch(/\.app\.phone \*[^{]*\{[^}]*-webkit-user-select:\s*none;[^}]*-webkit-touch-callout:\s*none/);
    expect(css).toMatch(/\.app input,[\s\S]*?\{[^}]*-webkit-user-select:\s*text/);
    expect(css).toMatch(/touch-action:\s*manipulation/);
  });
});

describe('pinchView', () => {
  const vp = { width: 400, height: 600 };
  const v = { cx: 3, cy: 2, zoom: 50 };
  it('keeps the world point under the finger midpoint and follows the spread', () => {
    const startMid = { x: 120, y: 300 };
    const w = screenToWorld(startMid, v, vp);
    const next = pinchView(v, vp, startMid, 100, { x: 180, y: 250 }, 250);
    expect(next.zoom).toBeCloseTo(125);
    const s = worldToScreen(w, next, vp);
    expect(s.x).toBeCloseTo(180);
    expect(s.y).toBeCloseTo(250);
  });
  it('stays within the zoom limits', () => {
    expect(pinchView(v, vp, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 1).zoom).toBe(5);
    expect(pinchView(v, vp, { x: 0, y: 0 }, 1, { x: 0, y: 0 }, 10000).zoom).toBe(2000);
  });
});

describe('stickVector', () => {
  it('is analog, clamped to the circle, with a small dead zone; up is forward', () => {
    expect(stickVector(2, -3, 48)).toEqual({ x: 0, z: 0 });
    expect(stickVector(0, -24, 48)).toEqual({ x: 0, z: 0.5 });
    const far = stickVector(300, 0, 48);
    expect(far.x).toBeCloseTo(1);
    expect(far.z).toBeCloseTo(0);
  });
});

describe('isEditableTarget', () => {
  it('allows selection only in fields', () => {
    const input = document.createElement('input');
    const div = document.createElement('div');
    div.textContent = 'Text';
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(div.firstChild)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('selectionLabel', () => {
  it('names furniture, rooms and openings', () => {
    const p = createSampleProject();
    const sofa = p.furniture.find((f) => f.catalogId === 'generic-sofa-3')!;
    expect(selectionLabel(p, { type: 'furniture', id: sofa.id }, 1)).toBe(sofa.name);
    expect(selectionLabel(p, { type: 'furniture', id: sofa.id }, 3)).toBe('3 Möbel');
    expect(selectionLabel(p, { type: 'room', id: p.rooms[0].id }, 0)).toBe('Wohnzimmer');
    const win = p.openings.find((o) => o.kind === 'window')!;
    expect(selectionLabel(p, { type: 'opening', id: win.id }, 0)).toBe('Fenster');
    expect(selectionLabel(p, { type: 'wall', id: p.walls[0].id }, 0)).toBe('Wand');
  });
});
