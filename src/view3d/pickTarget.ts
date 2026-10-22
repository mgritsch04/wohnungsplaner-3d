import type * as THREE from 'three';
import type { Selection } from '../store/uiStore';
import { isClippedHit } from './pointer';

/**
 * The editable object a 3D mesh belongs to (#235): furniture (FurnitureObject sets
 * userData.furnitureId), a door/window (Architecture: openingId) or a smart device
 * (Devices3D: smartDevice) or an installation point (Fixtures3D: fixtureId). Before/after ghosts, furnishing previews and the catalog drop
 * ghost are not editable.
 */
export function pickTargetOf(o: THREE.Object3D | null): Selection | null {
  for (let p = o; p; p = p.parent) {
    const u = p.userData;
    if (u.compareMarker || u.furnishPreview || u.catalogDropGhost) return null;
    if (typeof u.furnitureId === 'string') return { type: 'furniture', id: u.furnitureId };
    if (typeof u.openingId === 'string') return { type: 'opening', id: u.openingId };
    if (typeof u.smartDevice === 'string') return { type: 'device', id: u.smartDevice };
    if (typeof u.fixtureId === 'string') return { type: 'fixture', id: u.fixtureId };
  }
  return null;
}

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/**
 * First visible, not section-cut hit of the ray – walls and floors in front block the view.
 * Hidden parents count too: the overview hides the walls facing the camera via their group.
 */
export function firstPickTarget(raycaster: THREE.Raycaster, scene: THREE.Object3D): Selection | null {
  for (const h of raycaster.intersectObjects(scene.children, true)) {
    if (!(h.object as THREE.Mesh).isMesh || !visibleChain(h.object) || isClippedHit(h)) continue;
    return pickTargetOf(h.object);
  }
  return null;
}
