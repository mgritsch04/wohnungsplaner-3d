import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { tourPoseAt } from '../model/tour';
import { useTourStore } from '../store/tourStore';
import { useUiStore } from '../store/uiStore';
import { prefersReducedMotion, useCameraRig } from './cameraBookmarks';

/** Keys that end the tour (the visitor takes over). */
const TAKE_OVER_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape']);

/**
 * Moves the walkthrough camera along the planned tour (Rundgang). Inside the canvas, per frame.
 * Walking keys or Esc end the tour; leaving the walkthrough does too.
 */
export function TourDriver() {
  const playing = useTourStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (TAKE_OVER_KEYS.has(e.code)) useTourStore.getState().end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  useFrame((_, dtRaw) => {
    const st = useTourStore.getState();
    if (!st.playing || !st.plan) return;
    if (useUiStore.getState().cameraMode !== 'walk') {
      st.end();
      return;
    }
    const rig = useCameraRig.getState().walk;
    if (!rig) return; // walkthrough camera not mounted yet
    const t = st.time + Math.min(dtRaw, 0.05) * (prefersReducedMotion() ? 3 : 1);
    if (t >= st.plan.duration) {
      st.end();
      return;
    }
    const pose = tourPoseAt(st.plan, t);
    if (!pose) return;
    const cur = rig.get();
    rig.set({ x: pose.x, z: pose.z, eye: cur.eye, yaw: pose.yaw, pitch: 0 });
    st.setProgress(t, pose.stop);
  });
  return null;
}
