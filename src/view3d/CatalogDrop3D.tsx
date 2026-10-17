import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { catalogDropPreview, draggedCatalogItem, droppedCatalogItem, isCatalogDrag, useCatalogDragStore, type DropPreview } from '../catalog/catalogDrag';
import { derivePlan, type DerivedPlan } from '../model/derived';
import { buildPlacementObstacles, type Obstacle } from '../model/placement';
import type { Furniture, Project } from '../model/schema';
import { planRotationToWorldY } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { dropCatalogItemAt } from '../ui/actions';
import { ProceduralModel } from './ProceduralModel';

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const LEVEL_COLOR: Record<DropPreview['level'], string> = { ok: '#2563eb', warn: '#d97706', error: '#dc2626', outside: '#dc2626' };

/**
 * Catalog entries can be dropped into the 3D view (#131): the point under the pointer on the
 * floor plane (height 0) becomes the plan position; snapping and the room check as in 2D.
 * While dragging, the item itself is shown there as a translucent model (#217).
 */
export function CatalogDrop3D() {
  const { gl, camera } = useThree();
  const [ghost, setGhost] = useState<DropPreview | null>(null);
  // the drag ended elsewhere (Esc, released outside the view): no ghost left behind
  const dragActive = useCatalogDragStore((s) => s.item !== null);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    // plan geometry of the current project, derived only while dragging (not on every edit)
    let plan: { project: Project; derived: DerivedPlan; obstacles: Obstacle[] } | null = null;
    const currentPlan = () => {
      const project = useProjectStore.getState().project;
      if (plan?.project !== project) {
        const derived = derivePlan(project);
        plan = { project, derived, obstacles: buildPlacementObstacles(derived) };
      }
      return plan;
    };
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
      const item = draggedCatalogItem();
      const at = floorPoint(e);
      if (!item || !at) return setGhost(null);
      const { project, derived, obstacles } = currentPlan();
      setGhost(catalogDropPreview(project, derived, obstacles, item, at, e.altKey));
    };
    const onDragLeave = () => setGhost(null);
    const onDrop = (e: DragEvent) => {
      setGhost(null);
      const item = droppedCatalogItem(e.dataTransfer);
      if (!item) return;
      e.preventDefault();
      // no floor under the pointer (sky): rejected with the same hint as outside a room
      dropCatalogItemAt(item, floorPoint(e) ?? { x: NaN, y: NaN }, e.altKey);
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [gl, camera]);
  return dragActive && ghost ? <DropGhost item={ghost.item} color={LEVEL_COLOR[ghost.level]} /> : null;
}

/** The dragged item as a translucent model with a coloured outline (free / conflict / outside a room). */
function DropGhost({ item, color }: { item: Furniture; color: string }) {
  const h = Math.max(item.height, 0.02);
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(item.width + 0.02, h + 0.02, item.depth + 0.02);
    const e = new THREE.EdgesGeometry(box);
    box.dispose();
    return e;
  }, [item.width, item.depth, h]);
  useEffect(() => () => edges.dispose(), [edges]);
  const model = useRef<THREE.Group>(null);
  const clones = useRef(new Set<THREE.Material>());
  // translucent copies of the model's materials (shared materials of placed furniture stay untouched)
  useLayoutEffect(() => {
    model.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.raycast = () => null;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.every((m) => clones.current.has(m))) return;
      const next = mats.map((m) => {
        if (clones.current.has(m)) return m;
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.55;
        c.depthWrite = false;
        clones.current.add(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
  });
  useEffect(() => {
    const set = clones.current;
    return () => {
      for (const m of set) m.dispose();
      set.clear();
    };
  }, []);
  const shape = item.model.type === 'procedural' ? item.model.shape : item.model.fallbackShape;
  return (
    <group name="catalog-drop-ghost" position={[item.x, item.elevation, item.y]} rotation={[0, planRotationToWorldY(item.rotation), 0]} userData={{ catalogDropGhost: true, name: item.name }}>
      <group ref={model}>
        <ProceduralModel shape={shape} width={item.width} depth={item.depth} height={item.height} color={item.color} quality="planning" castShadow={false} />
      </group>
      <lineSegments geometry={edges} position={[0, h / 2, 0]} raycast={() => null} renderOrder={3}>
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
      </lineSegments>
    </group>
  );
}
