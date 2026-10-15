import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Furniture } from '../model/schema';
import { buildColliders, EYE_HEIGHT, resolveCollisions } from './collision';
import type { Vec2 } from '../model/vec';

interface Props {
  derived: DerivedPlan;
  furniture: Furniture[];
  start: Vec2;
  speed?: number;
  sensitivity?: number;
  onLockChange: (locked: boolean) => void;
}

/**
 * First-person walkthrough: WASD/arrow keys to move, mouse to look (pointer lock),
 * Shift to walk faster, Escape releases the mouse. Collides with walls (door
 * openings stay passable) and solid furniture; height is fixed at eye level.
 */
export function WalkControls({ derived, furniture, start, speed = 1.6, sensitivity = 0.0022, onLockChange }: Props) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragLook = useRef<{ x: number; y: number } | null>(null);
  const colliders = useMemo(() => buildColliders(derived, furniture), [derived, furniture]);
  const collidersRef = useRef(colliders);
  useEffect(() => {
    collidersRef.current = colliders;
  }, [colliders]);

  // initial placement (only when the start point changes)
  const startX = start.x;
  const startY = start.y;
  useEffect(() => {
    const p = resolveCollisions({ x: startX, y: startY }, collidersRef.current);
    camera.position.set(p.x, EYE_HEIGHT, p.y);
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
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      keys.current.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    const look = (dx: number, dy: number) => {
      yaw.current -= dx * sensitivity;
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current - dy * sensitivity));
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el) look(e.movementX, e.movementY);
      else if (dragLook.current) {
        look(e.clientX - dragLook.current.x, e.clientY - dragLook.current.y);
        dragLook.current = { x: e.clientX, y: e.clientY };
      }
    };
    const onDown = (e: MouseEvent) => {
      if (document.pointerLockElement === el) return;
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
    };
  }, [gl, sensitivity, onLockChange]);

  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
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
    const v = (speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : 1) * dt) / len;
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
    camera.position.set(p.x, EYE_HEIGHT, p.y);
  });

  return null;
}
