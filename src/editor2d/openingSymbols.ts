import type { ResolvedOpening, WallFootprint } from '../model/geometry/walls';
import { add, scale, type Vec2 } from '../model/vec';

export interface DoorSymbol {
  hinge: Vec2;
  closedTip: Vec2;
  openTip: Vec2;
  radius: number;
  /** SVG sweep flag for the arc from closedTip to openTip. */
  sweep: 0 | 1;
}

/** Door leaf (opened 90°) and swing arc in plan coordinates. */
export function doorSymbol(fp: WallFootprint, r: ResolvedOpening): DoorSymbol {
  const o = r.opening;
  const sign = o.swing === 'left' ? 1 : -1;
  const hingeS = o.hinge === 'start' ? r.s0 : r.s1;
  const otherS = o.hinge === 'start' ? r.s1 : r.s0;
  const face = scale(fp.normal, (sign * fp.thickness) / 2);
  const hinge = add(add(fp.a, scale(fp.dir, hingeS)), face);
  const closedTip = add(add(fp.a, scale(fp.dir, otherS)), face);
  const width = r.s1 - r.s0;
  const openTip = add(hinge, scale(fp.normal, sign * width));
  const c1 = { x: closedTip.x - hinge.x, y: closedTip.y - hinge.y };
  const c2 = { x: openTip.x - hinge.x, y: openTip.y - hinge.y };
  const cross = c1.x * c2.y - c1.y * c2.x;
  return { hinge, closedTip, openTip, radius: width, sweep: cross > 0 ? 1 : 0 };
}

/** The rectangle of the opening within the wall (4 corners). */
export function openingRect(fp: WallFootprint, r: ResolvedOpening, extra = 0): Vec2[] {
  const h = fp.thickness / 2 + extra;
  const p0 = add(fp.a, scale(fp.dir, r.s0));
  const p1 = add(fp.a, scale(fp.dir, r.s1));
  return [add(p0, scale(fp.normal, h)), add(p1, scale(fp.normal, h)), add(p1, scale(fp.normal, -h)), add(p0, scale(fp.normal, -h))];
}
