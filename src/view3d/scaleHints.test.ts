import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { createSampleProject } from '../model/sample';
import { describeAim, doorSpots, metres } from './ScaleHints';
import { FEEL_FOV, windowFov } from './walkZoom';

describe('"Gefühlt echt" scale hints (#263)', () => {
  it('the real-size angle of a 27" screen from 60 cm is about 31°, so the mode uses a wider 62°', () => {
    expect(windowFov(27, 0.6, 1920, 1080)).toBeCloseTo(31.3, 1);
    expect(windowFov(24, 0.6, 1920, 1080)).toBeCloseTo(28, 1);
    expect(FEEL_FOV).toBeGreaterThan(windowFov(27, 0.6, 1920, 1080) * 1.5);
    expect(createEmptyProject().settings.screenDiagonal).toBe(27);
  });

  it('describes furniture, doors, windows and plain surfaces at the crosshair', () => {
    const p = createSampleProject();
    const f = p.furniture[0];
    const obj = new THREE.Object3D();
    obj.userData.furnitureId = f.id;
    expect(describeAim(p, { object: obj, distance: 2.345, pointY: 0.4 })).toBe(`${f.name} · ${metres(f.height)} hoch · 2,35 m entfernt`);
    const door = p.openings.find((o) => o.kind === 'door')!;
    const d = new THREE.Object3D();
    d.userData.openingId = door.id;
    expect(describeAim(p, { object: d, distance: 1, pointY: 1 })).toBe(`Tür · ${metres(door.height)} hoch, ${metres(door.width)} breit · 1,00 m entfernt`);
    expect(describeAim(p, { object: new THREE.Object3D(), distance: 3, pointY: 1.2 })).toBe('3,00 m entfernt · Punkt 1,20 m über dem Boden');
  });

  it('labels every door and passage with its clear height, no window', () => {
    const p = createSampleProject();
    const spots = doorSpots(derivePlan(p));
    expect(spots.length).toBe(p.openings.filter((o) => o.kind !== 'window').length);
    for (const s of spots) expect(s.height).toBeGreaterThan(1.5);
  });
});
