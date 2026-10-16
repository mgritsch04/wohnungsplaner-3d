import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { easeInOut, interpolateView, JUMP_DURATION_MS, prefersReducedMotion, takePendingJump, useCameraRig, walkPoseOf, type CameraView } from './cameraBookmarks';

/**
 * Runs the transition to a camera bookmark (#55) inside the canvas: about 0.5 s with a smooth
 * start and end, immediately with `prefers-reduced-motion`. Waits until the camera of the
 * bookmark's mode (orbit / walkthrough) is mounted and registered.
 */
export function CameraBookmarkDriver() {
  const anim = useRef<{ from: CameraView; to: CameraView; t0: number; duration: number } | null>(null);
  useEffect(() => () => void (anim.current = null), []);

  useFrame(() => {
    const jump = takePendingJump();
    const rigs = useCameraRig.getState();
    if (jump) {
      const to: CameraView = jump.bookmark;
      // without a previous pose (3D was hidden) start where the target camera is now
      const from = jump.from ?? to;
      anim.current = { from, to, t0: performance.now(), duration: prefersReducedMotion() ? 0 : JUMP_DURATION_MS };
    }
    const a = anim.current;
    if (!a) return;
    const t = a.duration <= 0 ? 1 : (performance.now() - a.t0) / a.duration;
    const view = t >= 1 ? a.to : interpolateView(a.from, a.to, easeInOut(t));
    if (a.to.mode === 'walk') rigs.walk?.set(walkPoseOf(view));
    else rigs.orbit?.set(view.position, view.target);
    if (t >= 1) anim.current = null;
  });
  return null;
}
