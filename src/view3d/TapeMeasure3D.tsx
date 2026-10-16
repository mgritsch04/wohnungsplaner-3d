import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';
import { CLICK_THRESHOLD_PX, isClippedHit } from './pointer';
import { formatTape, measureBetween, type V3 } from './tapeMeasure';
import { useTapeStore } from './tapeStore';

// 3D rendering keeps its own fixed colours (theme.css: not part of the UI scheme)
const LINE = '#f97316';
const POINT = '#c2410c';
const noRaycast = () => null;
const TAPE_GROUP = 'tape-measure';

function insideTape(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (x.name === TAPE_GROUP) return true;
  return false;
}
function visibleChain(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/**
 * 3D tape measure (#88): while active, a click (overview) or a crosshair click (walkthrough)
 * picks a point on the visible surface under it (floor, wall, furniture); two points make a
 * measurement. Selecting and dragging is switched off meanwhile (R3F events disabled),
 * orbiting keeps working. Measurements are display state only.
 */
export function TapeMeasure3D() {
  const active = useTapeStore((s) => s.active);
  const items = useTapeStore((s) => s.items);
  const pending = useTapeStore((s) => s.pending);
  const { gl, camera, scene, raycaster, setEvents } = useThree();
  const cameraMode = useUiStore((s) => s.cameraMode);

  useEffect(() => {
    if (!active) return;
    setEvents({ enabled: false }); // nothing can be selected or moved while measuring
    const el = gl.domElement;
    const pick = (ndc: THREE.Vector2): V3 | null => {
      raycaster.setFromCamera(ndc, camera);
      raycaster.far = Infinity;
      for (const h of raycaster.intersectObjects(scene.children, true)) {
        const o = h.object as THREE.Mesh;
        if (!(o.isMesh || (o as unknown as THREE.InstancedMesh).isInstancedMesh) || insideTape(o) || !visibleChain(o)) continue;
        if (isClippedHit(h)) continue; // removed by the section cut – look further
        return [h.point.x, h.point.y, h.point.z];
      }
      return null;
    };
    const add = (p: V3 | null) => {
      if (p) useTapeStore.getState().addPoint(p);
      else useUiStore.getState().toast('Maßband: dort ist keine Fläche', 'info');
    };
    // overview: a click (not a drag) on the canvas
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      // in the walkthrough only the crosshair counts (the first click there captures the mouse)
      down = e.button === 0 && useUiStore.getState().cameraMode === 'orbit' ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.button !== 0 || document.pointerLockElement === el) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_THRESHOLD_PX) return; // orbit drag
      const r = el.getBoundingClientRect();
      add(pick(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)));
    };
    // walkthrough: the crosshair click is taken before the walk controls see it
    const onWalkDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== el || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      add(pick(new THREE.Vector2(0, 0)));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('mousedown', onWalkDown, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('mousedown', onWalkDown, true);
      setEvents({ enabled: true });
    };
  }, [active, gl, camera, scene, raycaster, setEvents, cameraMode]);

  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: LINE, depthTest: false, transparent: true }), []);
  const pointMat = useMemo(() => new THREE.MeshBasicMaterial({ color: POINT, depthTest: false, transparent: true }), []);
  const dot = useMemo(() => new THREE.SphereGeometry(0.035, 16, 12), []);
  useEffect(
    () => () => {
      lineMat.dispose();
      pointMat.dispose();
      dot.dispose();
    },
    [lineMat, pointMat, dot],
  );

  if (!items.length && !pending) return null;
  return (
    <group name={TAPE_GROUP}>
      {items.map((m) => {
        const r = measureBetween(m.a, m.b);
        const mid: V3 = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2];
        return (
          <group key={m.id}>
            <TapeLine a={m.a} b={m.b} material={lineMat} />
            {[m.a, m.b].map((p, i) => (
              <mesh key={i} position={p} geometry={dot} material={pointMat} renderOrder={11} raycast={noRaycast} />
            ))}
            <Html position={mid} center zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
              <div className="tape-label" data-testid="tape-label" data-length={r.length.toFixed(2)}>
                <strong>{formatTape(r.length)}</strong>
                <span>
                  ↔ {formatTape(r.horizontal)} · ↕ {formatTape(r.vertical)}
                </span>
              </div>
            </Html>
          </group>
        );
      })}
      {pending && <mesh position={pending} geometry={dot} material={pointMat} renderOrder={11} raycast={noRaycast} />}
    </group>
  );
}

/** One measurement line (geometry kept per segment, disposed on removal). */
function TapeLine({ a, b, material }: { a: V3; b: V3; material: THREE.Material }) {
  const line = useMemo(() => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), material);
    l.renderOrder = 10;
    l.raycast = noRaycast;
    return l;
  }, [a, b, material]);
  useEffect(() => () => line.geometry.dispose(), [line]);
  return <primitive object={line} />;
}
