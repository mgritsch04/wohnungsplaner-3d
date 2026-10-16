import type { Bounds, Vec2 } from '../model/vec';
import type { View2D } from '../store/uiStore';

export interface Viewport {
  width: number;
  height: number;
}

export function worldToScreen(p: Vec2, v: View2D, vp: Viewport): Vec2 {
  return { x: (p.x - v.cx) * v.zoom + vp.width / 2, y: (p.y - v.cy) * v.zoom + vp.height / 2 };
}

export function screenToWorld(s: Vec2, v: View2D, vp: Viewport): Vec2 {
  return { x: (s.x - vp.width / 2) / v.zoom + v.cx, y: (s.y - vp.height / 2) / v.zoom + v.cy };
}

export const MIN_ZOOM = 5;
export const MAX_ZOOM = 2000;

/** Zoom by factor keeping the world point under the screen point fixed. */
export function zoomAt(v: View2D, vp: Viewport, screen: Vec2, factor: number): View2D {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
  const before = screenToWorld(screen, v, vp);
  const next = { ...v, zoom };
  const after = screenToWorld(screen, next, vp);
  return { cx: next.cx + (before.x - after.x), cy: next.cy + (before.y - after.y), zoom };
}

export function fitView(b: Bounds | null, vp: Viewport, margin = 0.15): View2D {
  if (!b || vp.width < 10 || vp.height < 10) return { cx: 0, cy: 0, zoom: 60 };
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const zoom = Math.max(MIN_ZOOM, Math.min(400, Math.min(vp.width / w, vp.height / h) * (1 - 2 * margin)));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom };
}

/** A "nice" grid step for the current zoom so minor lines are at least ~minPx apart. */
export function niceGridStep(base: number, zoom: number, minPx = 8): number {
  let step = base;
  while (step * zoom < minPx) step *= step === base && base < 0.5 ? 5 : 2;
  return step;
}
