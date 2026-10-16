import type { ResolvedOpening, WallFootprint } from './walls';
import { add, dot, perp, pointInPolygon, scale, sub, type Vec2 } from '../vec';

/**
 * Door leaves and window sashes (#21): where they hang, which way they turn and
 * how much space they take when opened. Derived from the opening data (hinge,
 * swing, open) – shared by the 3D view, the placement collision and the walkthrough.
 */

/** Opening angle of an opened leaf: 90°, the position drawn in the plan. */
export const LEAF_OPEN_ANGLE = Math.PI / 2;
/** Door leaf thickness (also used as obstacle thickness). */
export const DOOR_LEAF_THICKNESS = 0.045;
/** Floor clearance under a door leaf (undercut) – rugs may lie below it. */
export const DOOR_LEAF_UNDERCUT = 0.015;
/** Window: outer frame profile width (Blendrahmen) and sash profile width (Flügel). */
export const WINDOW_FRAME = 0.07;
export const WINDOW_SASH_PROFILE = 0.055;
/** Windows wider than this get two sashes, hinged at the outer sides. */
export const WINDOW_TWO_SASH_WIDTH = 1.3;
/** Depth of the window frame in the wall (centred in the wall thickness). */
export const windowFrameDepth = (wallThickness: number) => Math.min(0.08, wallThickness);
/** Sash depth relative to the frame depth. */
export const WINDOW_SASH_DEPTH_FACTOR = 0.85;

export interface OpeningLeaf {
  openingId: string;
  kind: 'door' | 'window';
  /** Hinge axis in plan coordinates, on the face of the leaf towards the swing side. */
  hinge: Vec2;
  /** Unit direction hinge → free edge with the leaf closed (along the wall). */
  closedDir: Vec2;
  /** Unit wall normal pointing to the side the leaf opens to. */
  swingDir: Vec2;
  /** Hinge → free edge (m). */
  width: number;
  thickness: number;
  /** Vertical extent of the leaf (m above the floor). */
  z0: number;
  z1: number;
  open: boolean;
}

/** Unit direction hinge → free edge at opening angle `angle` (0 = closed, LEAF_OPEN_ANGLE = open). */
export function leafDirection(l: Pick<OpeningLeaf, 'closedDir' | 'swingDir'>, angle: number): Vec2 {
  return add(scale(l.closedDir, Math.cos(angle)), scale(l.swingDir, Math.sin(angle)));
}

/** Free edge of the leaf at `angle`. */
export function leafTip(l: OpeningLeaf, angle: number): Vec2 {
  return add(l.hinge, scale(leafDirection(l, angle), l.width));
}

/** Plan footprint of the leaf at `angle`: a strip of its thickness along the hinge → tip line. */
export function leafPolygon(l: OpeningLeaf, angle: number): Vec2[] {
  const along = leafDirection(l, angle);
  const side = scale(perp(along), l.thickness / 2);
  const a = l.hinge;
  const b = leafTip(l, angle);
  return [add(a, side), add(b, side), sub(b, side), sub(a, side)];
}

/** +1 / −1: the side of the wall normal the leaf turns to, seen from its closed direction (for 3D yaw). */
export function leafTurnSign(l: Pick<OpeningLeaf, 'closedDir' | 'swingDir'>): 1 | -1 {
  return dot(l.swingDir, perp(l.closedDir)) >= 0 ? 1 : -1;
}

/** Side of the wall (+1 = +normal) with a room in front of the opening, or null if both/none. */
function roomSide(fp: WallFootprint, r: ResolvedOpening, rooms: Vec2[][]): 1 | -1 | null {
  const mid = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
  const inside = (s: 1 | -1) => {
    const probe = add(mid, scale(fp.normal, s * (fp.thickness / 2 + 0.1)));
    return rooms.some((poly) => pointInPolygon(probe, poly));
  };
  const left = inside(1);
  const right = inside(-1);
  if (left === right) return null;
  return left ? 1 : -1;
}

/**
 * Leaves of one opening: one door leaf (hinge and swing side from the opening data),
 * or one/two window sashes opening into the room (single sash: hinge from the data;
 * two sashes: hinged at the outer sides). Passages have none.
 */
export function computeOpeningLeaves(fp: WallFootprint, r: ResolvedOpening, rooms: Vec2[][]): OpeningLeaf[] {
  const o = r.opening;
  const width = r.s1 - r.s0;
  const back = scale(fp.dir, -1);
  if (o.kind === 'door') {
    const swingDir = scale(fp.normal, o.swing === 'left' ? 1 : -1);
    const hingeS = o.hinge === 'start' ? r.s0 : r.s1;
    const hinge = add(add(fp.a, scale(fp.dir, hingeS)), scale(swingDir, fp.thickness / 2));
    return [
      {
        openingId: o.id,
        kind: 'door',
        hinge,
        closedDir: o.hinge === 'start' ? fp.dir : back,
        swingDir,
        width,
        thickness: DOOR_LEAF_THICKNESS,
        z0: r.bottom + DOOR_LEAF_UNDERCUT,
        z1: r.top,
        open: o.open,
      },
    ];
  }
  if (o.kind === 'window') {
    // sashes open into the room; between two rooms (or outside any) the swing field decides
    const swingDir = scale(fp.normal, roomSide(fp, r, rooms) ?? (o.swing === 'left' ? 1 : -1));
    const sashes = width > WINDOW_TWO_SASH_WIDTH ? 2 : 1;
    const sashW = (width - 2 * WINDOW_FRAME) / sashes;
    const z0 = r.bottom + WINDOW_FRAME;
    const z1 = r.top - WINDOW_FRAME;
    if (sashW < 0.05 || z1 - z0 < 0.05) return [];
    const depth = windowFrameDepth(fp.thickness) * WINDOW_SASH_DEPTH_FACTOR;
    const leaves: OpeningLeaf[] = [];
    for (let k = 0; k < sashes; k++) {
      const atStart = sashes === 2 ? k === 0 : o.hinge === 'start';
      const s = r.s0 + WINDOW_FRAME + (atStart ? k : k + 1) * sashW;
      leaves.push({
        openingId: o.id,
        kind: 'window',
        // the hinge axis lies on the room-side face of the sash
        hinge: add(add(fp.a, scale(fp.dir, s)), scale(swingDir, depth / 2)),
        closedDir: atStart ? fp.dir : back,
        swingDir,
        width: sashW,
        thickness: depth,
        z0,
        z1,
        open: o.open,
      });
    }
    return leaves;
  }
  return [];
}
