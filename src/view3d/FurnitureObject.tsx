import { Component, memo, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Furniture, QualityMode } from '../model/schema';
import { planRotationToWorldY, roundMm } from '../model/units';
import { ProceduralModel } from './ProceduralModel';
import { useAssetUrl } from '../persistence/useAssetUrl';
import { DRACO_PATH } from '../import/gltf';
import { CLICK_THRESHOLD_PX, isClippedHit } from './pointer';
import { useUiStore } from '../store/uiStore';

interface Props {
  item: Furniture;
  quality: QualityMode;
  selected: boolean;
  onSelect: (id: string) => void;
  onDragStart: () => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
  /** Drag aborted by the browser: restore the position from before the drag. */
  onDragCancel: () => void;
}

/** One furniture object in 3D. Can be dragged on the floor plane. */
export const FurnitureObject = memo(
  function FurnitureObject({ item, quality, selected, onSelect, onDragStart, onDrag, onDragEnd, onDragCancel }: Props) {
    const dragging = useRef<{ grab: THREE.Vector3; plane: THREE.Plane; started: boolean; sx: number; sy: number; onBlur: () => void } | null>(null);
    // never leave an open transaction behind if the item disappears mid-drag
    useEffect(
      () => () => {
        const dr = dragging.current;
        if (dr) window.removeEventListener('blur', dr.onBlur);
        if (dr?.started) onDragEndRef.current();
        dragging.current = null;
      },
      [],
    );
    const onDragEndRef = useRef(onDragEnd);
    useEffect(() => {
      onDragEndRef.current = onDragEnd;
    });
    const shape = item.model.type === 'procedural' ? item.model.shape : item.model.fallbackShape;
    const accent = item.kitchen?.frontColor;
    const castShadow = quality === 'realism' && item.height > 0.05;

    const fallback = (
      <ProceduralModel shape={shape} width={item.width} depth={item.depth} height={item.height} color={item.color} accent={accent} quality={quality} castShadow={castShadow} />
    );

    /** End the current gesture; `commit` keeps the moved position, otherwise it is reverted. */
    const endDrag = (commit: boolean) => {
      const dr = dragging.current;
      if (!dr) return;
      dragging.current = null;
      window.removeEventListener('blur', dr.onBlur);
      if (dr.started) (commit ? onDragEnd : onDragCancel)();
    };

    const onDown = (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || isClippedHit(e)) return;
      e.stopPropagation();
      onSelect(item.id);
      if (item.locked) return;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -item.elevation);
      const hit = new THREE.Vector3();
      if (!e.ray.intersectPlane(plane, hit)) return;
      endDrag(true);
      // focus loss (Alt+Tab, dialog) never delivers a pointerup: finish the drag there
      const onBlur = () => endDrag(true);
      window.addEventListener('blur', onBlur);
      dragging.current = {
        // offset between the grabbed point and the item origin – kept during the whole drag
        grab: hit.sub(new THREE.Vector3(item.x, item.elevation, item.y)),
        plane,
        started: false,
        sx: e.nativeEvent.clientX,
        sy: e.nativeEvent.clientY,
        onBlur,
      };
      (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: ThreeEvent<PointerEvent>) => {
      const dr = dragging.current;
      if (!dr) return;
      e.stopPropagation();
      // only start moving after a small threshold so a click never nudges the object
      // (R3F's e.delta is only set for click events, so measure the travel ourselves)
      if (!dr.started) {
        if (Math.hypot(e.nativeEvent.clientX - dr.sx, e.nativeEvent.clientY - dr.sy) <= CLICK_THRESHOLD_PX) return;
        dr.started = true;
        onDragStart();
      }
      const hit = new THREE.Vector3();
      if (!e.ray.intersectPlane(dr.plane, hit)) return;
      onDrag(item.id, roundMm(hit.x - dr.grab.x), roundMm(hit.z - dr.grab.z));
    };
    const onUp = (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      endDrag(true);
      (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    };
    // the browser aborted the gesture (touch interrupted, capture lost): revert the move
    const onCancel = () => endDrag(false);
    // The click that follows pointerup must stop here; otherwise R3F hands it to the
    // next object behind (e.g. a wall), which would steal the selection.
    const onClick = (e: ThreeEvent<MouseEvent>) => {
      if (isClippedHit(e)) return;
      e.stopPropagation();
    };

    return (
      <group
        position={[item.x, item.elevation, item.y]}
        rotation={[0, planRotationToWorldY(item.rotation), 0]}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onClick={onClick}
        onPointerOver={(e) => {
          if (isClippedHit(e)) return;
          e.stopPropagation();
          useUiStore.getState().setHover({ type: 'furniture', id: item.id });
        }}
        onPointerOut={() => {
          const h = useUiStore.getState().hover;
          if (h?.type === 'furniture' && h.id === item.id) useUiStore.getState().setHover(null);
        }}
      >
        {item.model.type === 'gltf' ? (
          <ModelErrorBoundary fallback={fallback}>
            <Suspense fallback={fallback}>
              <GltfModel item={item} fallback={fallback} castShadow={castShadow} />
            </Suspense>
          </ModelErrorBoundary>
        ) : (
          fallback
        )}
        {selected && <SelectionBox w={item.width} d={item.depth} h={item.height} />}
      </group>
    );
  },
  (a, b) => a.quality === b.quality && a.selected === b.selected && JSON.stringify(a.item) === JSON.stringify(b.item),
);

function SelectionBox({ w, d, h }: { w: number; d: number; h: number }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.02, h + 0.02, d + 0.02)), [w, d, h]);
  return (
    <lineSegments geometry={geo} position={[0, h / 2, 0]} raycast={() => null}>
      <lineBasicMaterial color="#2563eb" />
    </lineSegments>
  );
}

function GltfModel({ item, fallback, castShadow }: { item: Furniture; fallback: ReactNode; castShadow: boolean }) {
  const model = item.model.type === 'gltf' ? item.model : null;
  const { url: assetUrl, missing } = useAssetUrl(model?.assetId);
  const url = model?.url ?? assetUrl;
  if (!url || missing) return <>{fallback}</>;
  return <LoadedGltf url={url} item={item} castShadow={castShadow} />;
}

function LoadedGltf({ url, item, castShadow }: { url: string; item: Furniture; castShadow: boolean }) {
  const gltf = useGLTF(url, DRACO_PATH);
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = box.getSize(new THREE.Vector3());
    // scale the model to the stored real-world dimensions
    s.scale.set(item.width / (size.x || 1), item.height / (size.y || 1), item.depth / (size.z || 1));
    const box2 = new THREE.Box3().setFromObject(s);
    const c = box2.getCenter(new THREE.Vector3());
    s.position.set(-c.x, -box2.min.y, -c.z);
    s.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = castShadow;
        o.receiveShadow = castShadow;
      }
    });
    return s;
  }, [gltf, item.width, item.height, item.depth, castShadow]);
  return <primitive object={scene} />;
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('3D-Modell konnte nicht geladen werden, verwende Ersatzmodell', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
