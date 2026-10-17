import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { droppedCatalogItem, isCatalogDrag } from '../catalog/catalogDrag';
import { dropCatalogItemAt } from '../ui/actions';

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Catalog entries can be dropped into the 3D view (#131): the point under the pointer on the
 * floor plane (height 0) becomes the plan position; snapping and the room check as in 2D.
 */
export function CatalogDrop3D() {
  const { gl, camera } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const floorPoint = (e: DragEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(FLOOR, hit) ? { x: hit.x, y: hit.z } : null;
    };
    const onDragOver = (e: DragEvent) => {
      if (!isCatalogDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      const item = droppedCatalogItem(e.dataTransfer);
      if (!item) return;
      e.preventDefault();
      // no floor under the pointer (sky): rejected with the same hint as outside a room
      dropCatalogItemAt(item, floorPoint(e) ?? { x: NaN, y: NaN }, e.altKey);
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, [gl, camera]);
  return null;
}
