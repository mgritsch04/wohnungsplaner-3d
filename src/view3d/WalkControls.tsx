import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Furniture } from '../model/schema';
import { buildColliders, EYE_HEIGHT, resolveCollisions } from './collision';
import { buildPlacementObstacles, moveFurnitureTo } from '../model/placement';
import { carryGoal } from './carryTarget';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useWalkPose } from '../store/walkPoseStore';
import type { Vec2 } from '../model/vec';
import { toggleOpening } from '../ui/actions';
import { registerWalkRig } from './cameraBookmarks';
import { goalEyeHeight, walkSpeedFactor } from './walkPosture';
import { createLookFilter } from './lookFilter';
import { TOUCH_LOOK_FACTOR, touchWalk, walkCommands } from './touchWalk';
import { BUTTON, createGamepadSource, LOOK_RATE } from './input/gamepad';
import { CLICK_THRESHOLD_PX, isClippedHit } from './pointer';
import { nextWalkFov, WALK_FOV, wheelPixels, zoomLookFactor } from './walkZoom';

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
 * A gamepad works alongside keyboard and mouse (#29, see input/gamepad.ts). The mouse wheel
 * zooms by narrowing the field of view; Z or the middle mouse button resets it (#228).
 */
/** Look speed at sensitivity factor 1 (radians per pixel). */
export const BASE_LOOK_SENSITIVITY = 0.0022;

/** Furniture under the crosshair can be picked up to this distance (m). */
const PICK_RANGE = 6;
/** A carried item stays this far in front of the eyes (m, horizontal). */
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
  const obstacles = useMemo(() => buildPlacementObstacles(derived, { closedOpenings: true }), [derived]);
  const placement = useRef({ derived, obstacles });
  useEffect(() => {
    placement.current = { derived, obstacles };
  }, [derived, obstacles]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragLook = useRef<{ x: number; y: number } | null>(null);
  // field of view of the wheel zoom (#228); every walkthrough starts at the normal view
  const fov = useRef(WALK_FOV);
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
  // the carried item must not push the walker around. While carrying, only the carried item moves,
  // so the colliders of the rest are built once when it is picked up, not every frame (#231)
  const collidersFurniture = carryId ? null : furniture;
  const colliders = useMemo(
    () => buildColliders(derived, carryId ? furniture.filter((f) => f.id !== carryId) : furniture),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, collidersFurniture, carryId],
  );
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
    fov.current = WALK_FOV;
    cam.fov = WALK_FOV;
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
    /**
     * First visible object under the crosshair – or under `at` (normalized device coordinates,
     * the mouse without pointer lock); walls and floor in front of it block the view.
     */
    const aimed = (at: THREE.Vector2 = CENTER): THREE.Object3D | null => {
      raycaster.setFromCamera(at, camera);
      raycaster.far = PICK_RANGE;
      for (const h of raycaster.intersectObjects(scene.children, true)) {
        if (!(h.object as THREE.Mesh).isMesh || !h.object.visible || isClippedHit(h)) continue;
        return h.object;
      }
      return null;
    };
    /** Furniture under the crosshair. */
    const target = (at?: THREE.Vector2): string | null => furnitureIdOf(aimed(at));
    /** Door/window under the crosshair (#21). */
    const targetOpening = (at?: THREE.Vector2): string | null => {
      const o = aimed(at);
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
    // the walkthrough selects only here, at the crosshair (#185): the scene's own click handlers
    // are off while walking – under pointer lock they would pick at the stale mouse position
    // (usually the wall or floor behind the furniture) and overwrite this selection
    const pickOrDrop = (at?: THREE.Vector2) => {
      if (carry.current) return dropCarry(true);
      const id = target(at);
      if (id) return useUiStore.getState().setSelection({ type: 'furniture', id });
      // a door or window in sight is opened or closed (#21)
      const opening = targetOpening(at);
      if (opening) toggleOpening(opening);
    };
    walkApi.current = { toggleCarry, pickOrDrop: () => pickOrDrop(), target: () => target(), targetOpening: () => targetOpening(), toggleOpening: toggleAimedOpening };
    walkCommands.toggleCarry = toggleCarry;
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
      if (e.code === 'KeyZ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // back to the normal view after zooming with the wheel (#228)
        setFov(WALK_FOV);
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
    const setFov = (f: number) => {
      fov.current = f;
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.fov === f) return;
      cam.fov = f;
      cam.updateProjectionMatrix();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setFov(nextWalkFov(fov.current, wheelPixels(e.deltaY, e.deltaMode)));
    };
    const clear = () => {
      keys.current.clear();
      dragLook.current = null;
    };
    const look = (dx: number, dy: number) => {
      // zoomed in, the view turns slower so aiming stays calm (#228)
      const k = sensitivityRef.current * zoomLookFactor(fov.current);
      yaw.current -= dx * k;
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current - dy * k));
    };
    // drops the occasional huge pointer-lock delta that turned the view by ~180° (#142)
    const lookFilter = createLookFilter();
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el) {
        const d = lookFilter.next(e.movementX, e.movementY);
        if (d) look(d[0], d[1]);
      } else if (dragLook.current) {
        // the button was released outside the window: stop instead of jumping on return
        if (e.buttons === 0) {
          dragLook.current = null;
          return;
        }
        look(e.clientX - dragLook.current.x, e.clientY - dragLook.current.y);
        dragLook.current = { x: e.clientX, y: e.clientY };
      }
    };
    // touch (#164): the finger that turns the view; the mouse events a phone fires after a tap
    // (lastTouch) must not ask for pointer lock
    let touchLook: { id: number; x: number; y: number; sx: number; sy: number; t: number } | null = null;
    let lastTouch = 0;
    // without pointer lock (refused, e.g. in an embedded page): a short click picks under the mouse
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent) => {
      if (performance.now() - lastTouch < 1000) return;
      if (e.button === 1) {
        // middle button: reset the wheel zoom (#228); no autoscroll
        e.preventDefault();
        setFov(WALK_FOV);
        return;
      }
      downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
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
    const onUp = (e: MouseEvent) => {
      const d = downAt;
      downAt = null;
      const fallback = dragLook.current !== null && document.pointerLockElement !== el;
      dragLook.current = null;
      if (!fallback || !d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_THRESHOLD_PX) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      pickOrDrop(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
    };
    // a finger drag turns the view, a short tap selects / opens like a click
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      lastTouch = performance.now();
      if (touchLook) return;
      touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
      el.setPointerCapture?.(e.pointerId);
    };
    const onTouchMove = (e: PointerEvent) => {
      if (!touchLook || e.pointerId !== touchLook.id) return;
      const k = TOUCH_LOOK_FACTOR;
      look((e.clientX - touchLook.x) * k, (e.clientY - touchLook.y) * k);
      touchLook.x = e.clientX;
      touchLook.y = e.clientY;
    };
    const onTouchUp = (e: PointerEvent) => {
      if (!touchLook || e.pointerId !== touchLook.id) return;
      const tap = Math.hypot(e.clientX - touchLook.sx, e.clientY - touchLook.sy) < 10 && performance.now() - touchLook.t < 600;
      touchLook = null;
      lastTouch = performance.now();
      if (tap && e.type === 'pointerup') pickOrDrop();
    };
    const onLock = () => {
      if (document.pointerLockElement === el) lookFilter.reset();
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
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mouseup', onUp);
    el.addEventListener('pointerdown', onTouchDown);
    el.addEventListener('pointermove', onTouchMove);
    el.addEventListener('pointerup', onTouchUp);
    el.addEventListener('pointercancel', onTouchUp);
    return () => {
      el.removeEventListener('pointerdown', onTouchDown);
      el.removeEventListener('pointermove', onTouchMove);
      el.removeEventListener('pointerup', onTouchUp);
      el.removeEventListener('pointercancel', onTouchUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLock);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('mouseup', onUp);
      if (document.pointerLockElement === el) document.exitPointerLock();
      pressed.clear();
      walkCommands.toggleCarry = null;
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
      fov: () => fov.current,
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

  // gamepad (#29): polled per frame, the browser does not push stick changes
  const gamepad = useMemo(() => createGamepadSource(), []);
  useEffect(() => () => gamepad.reset(), [gamepad]);

  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const pad = gamepad.poll();
    if (pad) {
      const rate = LOOK_RATE * zoomLookFactor(fov.current) * dt;
      yaw.current -= pad.look.x * rate;
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current - pad.look.y * rate));
      const api = walkApi.current;
      const ui = useUiStore.getState();
      if (pad.pressed.has(BUTTON.A)) api?.pickOrDrop();
      if (pad.pressed.has(BUTTON.X)) api?.toggleOpening();
      if (pad.pressed.has(BUTTON.Y)) api?.toggleCarry();
      if (pad.pressed.has(BUTTON.B)) ui.toggleWalkDuck();
      if (pad.pressed.has(BUTTON.LB)) ui.setWalkSit(!ui.walkSit);
    }
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
      // carried item: where the gaze meets the floor (1.1–4 m ahead) or a table top
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const goal = carryGoal(camera.position, dir, useProjectStore.getState().project.furniture, c.id);
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
    // keys give full speed in their direction; the left stick adds an analog share (total ≤ 1)
    const keyLen = Math.hypot(fx, fz);
    if (keyLen > 0) {
      fx /= keyLen;
      fz /= keyLen;
    }
    if (pad) {
      fx += pad.move.x;
      fz += pad.move.z;
    }
    // on-screen stick on phones (#164): analog as well, a half-pushed stick walks at half speed
    fx += touchWalk.x;
    fz += touchWalk.z;
    const len = Math.hypot(fx, fz);
    if (len === 0) return;
    if (len > 1) {
      fx /= len;
      fz /= len;
    }
    forward.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const run = k.has('ShiftLeft') || k.has('ShiftRight') || !!pad?.run;
    const v = speed * (run ? 2 : 1) * walkSpeedFactor({ sitting: seated, ducking }) * dt;
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
