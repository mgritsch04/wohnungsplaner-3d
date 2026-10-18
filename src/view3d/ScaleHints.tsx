import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { isClippedHit } from './pointer';
import { furnitureIdOf, openingIdOf } from './WalkControls';

/**
 * Scale hints of "Gefühlt echt" (#263): on a monitor the eye cannot judge sizes from the picture
 * angle alone, so the walkthrough tells them – distance and height of what is under the crosshair,
 * and the clear height of the doors in sight.
 */

/** Hints are worked out a few times per second, not every frame. */
const UPDATE_EVERY = 0.15;
/** Farthest point the crosshair readout measures (m). */
const AIM_RANGE = 30;
/** Door heights are shown for doors up to this distance (m). */
const DOOR_RANGE = 7;

const CENTER = new THREE.Vector2(0, 0);

/** "1,23 m" */
export const metres = (m: number): string => `${(Math.round(m * 100) / 100).toFixed(2).replace('.', ',')} m`;

interface AimInfo {
  text: string;
}
export const useAimInfo = create<{ info: AimInfo | null; set: (info: AimInfo | null) => void }>((set) => ({
  info: null,
  set: (info) => set({ info }),
}));

/** First visible, unclipped mesh along the ray. */
function firstHit(raycaster: THREE.Raycaster, scene: THREE.Scene): THREE.Intersection | null {
  for (const h of raycaster.intersectObjects(scene.children, true)) {
    if (!(h.object as THREE.Mesh).isMesh || !h.object.visible || isClippedHit(h)) continue;
    return h;
  }
  return null;
}

/** Text for what the crosshair hits (#263). */
export function describeAim(project: Pick<Project, 'furniture' | 'openings'>, hit: { object: THREE.Object3D | null; distance: number; pointY: number }): string {
  const dist = `${metres(hit.distance)} entfernt`;
  const fid = furnitureIdOf(hit.object);
  const f = fid ? project.furniture.find((x) => x.id === fid) : undefined;
  if (f) return `${f.name} · ${metres(f.height)} hoch · ${dist}`;
  const oid = openingIdOf(hit.object);
  const o = oid ? project.openings.find((x) => x.id === oid) : undefined;
  if (o) {
    if (o.kind === 'window') return `Fenster · ${metres(o.height)} hoch, Brüstung ${metres(o.sillHeight)} · ${dist}`;
    return `${o.kind === 'door' ? 'Tür' : 'Durchgang'} · ${metres(o.height)} hoch, ${metres(o.width)} breit · ${dist}`;
  }
  return `${dist} · Punkt ${metres(Math.max(0, hit.pointY))} über dem Boden`;
}

/** Inside the canvas: measures at the crosshair while walking with "Gefühlt echt". */
export function AimProbe() {
  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const since = useRef(UPDATE_EVERY);
  const last = useRef('');
  useEffect(() => () => useAimInfo.getState().set(null), []);
  useFrame((_, dt) => {
    since.current += dt;
    if (since.current < UPDATE_EVERY) return;
    since.current = 0;
    raycaster.setFromCamera(CENTER, camera);
    raycaster.far = AIM_RANGE;
    const h = firstHit(raycaster, scene);
    const text = h ? describeAim(useProjectStore.getState().project, { object: h.object, distance: h.distance, pointY: h.point.y }) : '';
    if (text === last.current) return;
    last.current = text;
    useAimInfo.getState().set(text ? { text } : null);
  });
  return null;
}

/** DOM readout under the crosshair. */
export function AimReadout() {
  const info = useAimInfo((s) => s.info);
  if (!info) return null;
  return (
    <div className="aim-readout" data-testid="aim-readout">
      {info.text}
    </div>
  );
}

interface DoorSpot {
  id: string;
  at: THREE.Vector3;
  height: number;
}

/** Doors and passages: a point in the opening just below the lintel. */
export function doorSpots(derived: Pick<DerivedPlan, 'openings' | 'footprints'>): DoorSpot[] {
  const out: DoorSpot[] = [];
  for (const [wallId, list] of derived.openings) {
    const fp = derived.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      if (r.opening.kind === 'window') continue;
      const s = (r.s0 + r.s1) / 2;
      out.push({ id: r.opening.id, at: new THREE.Vector3(fp.a.x + fp.dir.x * s, Math.max(0.2, r.top - 0.15), fp.a.y + fp.dir.y * s), height: r.top - r.bottom });
    }
  }
  return out;
}

/** Clear height labels on the doors in sight (#263). */
export function DoorHeightLabels({ derived }: { derived: DerivedPlan }) {
  const { camera, scene } = useThree();
  const spots = useMemo(() => doorSpots(derived), [derived]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const [shown, setShown] = useState<string[]>([]);
  const since = useRef(UPDATE_EVERY);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    since.current += dt;
    if (since.current < UPDATE_EVERY) return;
    since.current = 0;
    const next: string[] = [];
    for (const d of spots) {
      dir.subVectors(d.at, camera.position);
      const dist = dir.length();
      if (dist > DOOR_RANGE || dist < 0.3) continue;
      raycaster.set(camera.position, dir.normalize());
      raycaster.far = dist;
      const h = firstHit(raycaster, scene);
      // in sight: nothing in between, or the first thing hit is that door's own leaf
      if (!h || h.distance > dist - 0.3 || openingIdOf(h.object) === d.id) next.push(d.id);
    }
    if (next.join() !== shown.join()) setShown(next);
  });
  return (
    <>
      {spots
        .filter((d) => shown.includes(d.id))
        .map((d) => (
          <Html key={d.id} position={d.at} center zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
            <div className="door-height" data-testid="door-height">
              ↕ {metres(d.height)}
            </div>
          </Html>
        ))}
    </>
  );
}
