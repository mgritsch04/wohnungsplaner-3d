import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { openObjectMenu } from '../ui/objectMenu';
import { firstPickTarget } from './pickTarget';
import { CLICK_THRESHOLD_PX } from './pointer';

/**
 * Right-click in the 3D overview (#235): opens the object context menu for the furniture,
 * door/window or smart device under the pointer. A right-drag still pans the view – only a
 * click without movement opens the menu.
 */
export function OrbitContextMenu() {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 2 && e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.button !== 2 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_THRESHOLD_PX) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const target = firstPickTarget(raycaster, scene);
      if (target) openObjectMenu(target, e.clientX, e.clientY, '3d');
    };
    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [camera, gl, scene]);
  return null;
}
