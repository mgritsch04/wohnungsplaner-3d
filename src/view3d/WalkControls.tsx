import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Furniture } from '../model/schema';
import { buildColliders, EYE_HEIGHT, resolveCollisions } from './collision';
import { buildPlacementObstacles, moveFurnitureTo } from '../model/placement';
import { roundMm } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useWalkPose } from '../store/walkPoseStore';
import type { Vec2 } from '../model/vec';
import { toggleOpening } from '../ui/actions';
import { registerWalkRig } from './cameraBookmarks';
import { goalEyeHeight, walkSpeedFactor } from './walkPosture';

interface Props {
  derived: DerivedPlan;
  furniture: Furniture[];
  start: Vec2;
  speed?: number;
  /** Radians per pixel of mouse movement. */
  sensitivity?: number;
  /** Camera height above the floor (m). */
  eyeHeight?: number;
  onLockChange: (locked: boolean) => void;
}

/**
 * First-person walkthrough: WASD/arrow keys to move, mouse to look (pointer lock),
 * Shift to walk faster, Escape releases the mouse. Collides with walls (open door
 * openings stay passable, closed doors not) and solid furniture; height is fixed at
 * eye level. Click/E/O at the crosshair opens or closes a door or window (#21, #107).
 */
/** Look speed at sensitivity factor 1 (radians per pixel). */
export const BASE_LOOK_SENSITIVITY = 0.0022;

/** Furniture under the crosshair can be picked up to this distance (m). */
const PICK_RANGE = 6;
/** A carried item stays this far in front of the eyes (m, horizontal). */
const CARRY_MIN = 1.1;
const CARRY_MAX = 4;
const CENTER = new THREE.Vector2(0, 0);

/** Id of the furniture whose 3D object contains `o` (FurnitureObject sets userData.furnitureId). */
function furnitureIdOf(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.furnitureId === 'string') return p.userData.furnitureId;
  return null;
}

/** Id of the door/window whose 3D object contains `o` (Architecture sets userData.openingId). */
function openingIdOf(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.openingId === 'string') return p.userData.openingId;
  return null;
}

export function WalkControls({ derived, furniture, start, speed = 1.6, sensitivity = BASE_LOOK_SENSITIVITY, eyeHeight = EYE_HEIGHT, onLockChange }: Props) {
  const { camera, gl, scene } = useThree();
  // furniture carried with G (#39): moves with the gaze, same collision rules as dragging
  const carryId = useUiStore((s) => s.walkCarry);
  const carry = useRef<{ id: string; last: Vec2 | null } | null>(null);
  const obstacles = useMemo(() => buildPlacementObstacles(derived), [derived]);
  const placement = useRef({ derived, obstacles });
  useEffect(() => {
    placement.current = { derived, obstacles };
  }, [derived, obstacles]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragLook = useRef<{ x: number; y: number } | null>(null);
  // read through a ref: changing the sensitivity must not re-register listeners (or drop pointer lock)
  const sensitivityRef = useRef(sensitivity);
  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);
  // eye height changes apply immediately, without restarting the walk (pointer lock stays)
  // seated eye height (#78) comes straight from the project settings
  const sitEye = useProjectStore((s) => s.project.settings.sitEyeHeight);
  const sitEyeRef = useRef(sitEye);
  useEffect(() => {
    sitEyeRef.current = sitEye;
  }, [sitEye]);
  const eyeRef = useRef(eyeHeight);
  const eyeNow = useRef<number | null>(null);
  useEffect(() => {
    eyeRef.current = eyeHeight;
  }, [eyeHeight]);
  // the carried item must not push the walker around
  const colliders = useMemo(() => buildColliders(derived, carryId ? furniture.filter((f) => f.id !== carryId) : furniture), [derived, furniture, carryId]);
  const collidersRef = useRef(colliders);
  useEffect(() => {
    collidersRef.current = colliders;
  }, [colliders]);

  // initial placement (only when the start point changes)
  const startX = start.x;
  const startY = start.y;
  useEffect(() => {
    const p = resolveCollisions({ x: startX, y: startY }, collidersRef.current);
    camera.position.set(p.x, eyeRef.current, p.y);
    yaw.current = 0;
    pitch.current = 0;
    camera.rotation.set(0, 0, 0, 'YXZ');
    const cam = camera as THREE.PerspectiveCamera;
    const oldFov = cam.fov;
    cam.fov = 70;
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    return () => {
      cam.fov = oldFov;
      cam.near = 0.1;
      cam.updateProjectionMatrix();
    };
  }, [startX, startY, camera]);

  useEffect(() => {
    const el = gl.domElement;
    const pressed = keys.current;
    /** First visible object under the crosshair (walls and floor in front of it block the view). */
    const aimed = (): THREE.Object3D | null => {
      raycaster.setFromCamera(CENTER, camera);
      raycaster.far = PICK_RANGE;
      for (const h of raycaster.intersectObjects(scene.children, true)) {
        if (!(h.object as THREE.Mesh).isMesh || !h.object.visible) continue;
        return h.object;
      }
      return null;
    };
    /** Furniture under the crosshair. */
    const target = (): string | null => furnitureIdOf(aimed());
    /** Door/window under the crosshair (#21). */
    const targetOpening = (): string | null => {
      const o = aimed();
      return furnitureIdOf(o) ? null : openingIdOf(o);
    };
    /** E/O: open/close the door/window in sight, else the selected one. */
    const toggleAimedOpening = () => {
      if (carry.current) return;
      const sel = useUiStore.getState().selection;
      const id = targetOpening() ?? (sel?.type === 'opening' ? sel.id : null);
      if (id) toggleOpening(id);
    };
    const startCarry = (id: string) => {
      const f = useProjectStore.getState().project.furniture.find((x) => x.id === id);
      if (!f || f.locked) return;
      useUiStore.getState().setSelection({ type: 'furniture', id });
      useProjectStore.getState().beginTransaction();
      carry.current = { id, last: null };
      useUiStore.getState().setWalkCarry(id);
    };
    const dropCarry = (keep: boolean) => {
      if (!carry.current) return;
      carry.current = null;
      if (keep) useProjectStore.getState().commitTransaction();
      else useProjectStore.getState().cancelTransaction();
      useUiStore.getState().setWalkCarry(null);
    };
    const toggleCarry = () => {
      if (carry.current) return dropCarry(true);
      const sel = useUiStore.getState().selection;
      const id = target() ?? (sel?.type === 'furniture' ? sel.id : null);
      if (id) startCarry(id);
    };
    const pickOrDrop = () => {
      if (carry.current) return dropCarry(true);
      const id = target();
      if (id) return useUiStore.getState().setSelection({ type: 'furniture', id });
      // a door or window in sight is opened or closed (#21)
      const opening = targetOpening();
      if (opening) toggleOpening(opening);
    };
    walkApi.current = { toggleCarry, pickOrDrop, target, targetOpening, toggleOpening: toggleAimedOpening };
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.code === 'KeyG' && !e.repeat && !e.ctrlKey && !e.metaKey) {
        toggleCarry();
        return;
      }
      if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // crouch / stand up again (#47: toggle instead of holding); ignored while seated
        useUiStore.getState().toggleWalkDuck();
        return;
      }
      if (e.code === 'KeyX' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // stand / sit (#78) – takes effect immediately, without leaving the walkthrough; ends crouching
        const ui = useUiStore.getState();
        ui.setWalkSit(!ui.walkSit);
        return;
      }
      if ((e.code === 'KeyE' || e.code === 'KeyO') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // E (#107) or O: open/close the door or window in sight
        toggleAimedOpening();
        return;
      }
      keys.current.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    const look = (dx: number, dy: number) => {
      const k = sensitivityRef.current;
      yaw.current -= dx * k;
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current - dy * k));
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el) look(e.movementX, e.movementY);
      else if (dragLook.current) {
        look(e.clientX - dragLook.current.x, e.clientY - dragLook.current.y);
        dragLook.current = { x: e.clientX, y: e.clientY };
      }
    };
    const onDown = (e: MouseEvent) => {
      if (document.pointerLockElement === el) {
        // locked: a click selects the furniture under the crosshair (or opens/closes the door or
        // window there), or drops the carried one
        if (e.button === 0) pickOrDrop();
        return;
      }
      if (el.requestPointerLock) {
        try {
          const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
          r?.catch?.(() => (dragLook.current = { x: e.clientX, y: e.clientY }));
        } catch {
          dragLook.current = { x: e.clientX, y: e.clientY };
        }
      } else dragLook.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => (dragLook.current = null);
    const onLock = () => {
      onLockChange(document.pointerLockElement === el);
      if (document.pointerLockElement !== el) keys.current.clear();
    };
    // leaving the walkthrough while carrying keeps the item where it is
    const endCarry = () => dropCarry(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLock);
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLock);
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      if (document.pointerLockElement === el) document.exitPointerLock();
      pressed.clear();
      endCarry();
      walkApi.current = null;
      useWalkPose.getState().setPose(null);
      useUiStore.getState().setWalkDuck(false);
      useUiStore.getState().setWalkSit(false);
    };
  }, [gl, onLockChange, camera, scene, raycaster]);

  // e2e/debug hook: look in a direction and use the pick/carry actions without pointer lock
  const walkApi = useRef<{
    toggleCarry: () => void;
    pickOrDrop: () => void;
    target: () => string | null;
    targetOpening: () => string | null;
    toggleOpening: () => void;
  } | null>(null);
  useEffect(() => {
    const wp = (window as unknown as { __wp?: Record<string, unknown> }).__wp;
    if (!wp) return;
    wp.walk = {
      look: (y: number, p: number) => {
        yaw.current = y;
        pitch.current = p;
      },
      toggleCarry: () => walkApi.current?.toggleCarry(),
      pickOrDrop: () => walkApi.current?.pickOrDrop(),
      target: () => walkApi.current?.target() ?? null,
      targetOpening: () => walkApi.current?.targetOpening() ?? null,
      toggleOpening: () => walkApi.current?.toggleOpening(),
    };
    return () => void delete wp.walk;
  }, []);

  // camera bookmarks (#55) read and set the pose
  useEffect(
    () =>
      registerWalkRig({
        get: () => ({ x: camera.position.x, z: camera.position.z, eye: eyeRef.current, yaw: yaw.current, pitch: pitch.current }),
        set: (p) => {
          camera.position.x = p.x;
          camera.position.z = p.z;
          eyeRef.current = eyeNow.current = p.eye;
          yaw.current = p.yaw;
          pitch.current = p.pitch;
        },
      }),
    [camera],
  );

  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    // crouch toggled with C (#47), sit with X (#78): move the eyes smoothly (frame-rate independent); seated, C is ignored
    const seated = useUiStore.getState().walkSit;
    const ducking = !seated && useUiStore.getState().walkDuck;
    const goalEye = goalEyeHeight({ eye: eyeRef.current, sitEye: sitEyeRef.current, sitting: seated, ducking });
    eyeNow.current = eyeNow.current === null ? goalEye : eyeNow.current + (goalEye - eyeNow.current) * (1 - Math.exp(-dt / 0.08));
    if (Math.abs(eyeNow.current - goalEye) < 0.001) eyeNow.current = goalEye;
    camera.position.y = eyeNow.current;
    useWalkPose.getState().setPose({ x: camera.position.x, y: camera.position.z, yaw: yaw.current });
    const c = carry.current;
    if (c) {
      // carried item: on the floor (or its surface height) where the gaze meets it, 1.1–4 m ahead
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const flat = Math.hypot(dir.x, dir.z) || 1;
      let dist = CARRY_MAX;
      if (dir.y < -0.01) dist = Math.min(CARRY_MAX, Math.max(CARRY_MIN, ((camera.position.y - 0.3) * flat) / -dir.y));
      const goal = { x: roundMm(camera.position.x + (dir.x / flat) * dist), y: roundMm(camera.position.z + (dir.z / flat) * dist) };
      if (!c.last || Math.hypot(goal.x - c.last.x, goal.y - c.last.y) > 0.01) {
        c.last = goal;
        const { derived: dv, obstacles: ob } = placement.current;
        useProjectStore.getState().updateTransient((d) => void moveFurnitureTo(d, dv, ob, c.id, goal, { snap: true, collide: true }));
      }
    }
    const k = keys.current;
    let fx = 0;
    let fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (fx === 0 && fz === 0) return;
    forward.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const len = Math.hypot(fx, fz);
    const v = (speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : 1) * walkSpeedFactor({ sitting: seated, ducking }) * dt) / len;
    // sub-steps prevent tunnelling through thin walls at high speed
    const steps = Math.max(1, Math.ceil(v / 0.05));
    let p = { x: camera.position.x, y: camera.position.z };
    for (let i = 0; i < steps; i++) {
      p = {
        x: p.x + ((forward.x * fz + right.x * fx) * v) / steps,
        y: p.y + ((forward.z * fz + right.z * fx) * v) / steps,
      };
      p = resolveCollisions(p, collidersRef.current);
    }
    camera.position.set(p.x, eyeNow.current, p.y);
  });

  return null;
}
