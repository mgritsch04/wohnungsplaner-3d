/**
 * Checks a layout against the hard rules without the solver's own bookkeeping: ways between the
 * doors with stage 0 (`checkWalkways`), door swings, overlaps. Used by the tests; the walk-through
 * (stage 4) has its own, fuller checks.
 */
import { checkWalkways } from '../analysis';
import type { Layout, RoomAnalysis } from '../types';
import { boxCorners, overlapDepth } from './geom';
import { specOf } from './items';
import type { FixedPiece } from './room';

/** Footprints one cannot walk through: pieces on the floor (not rugs, not hanging) and the existing ones. */
export function floorObstacles(layout: Layout, existing: FixedPiece[]) {
  const placed = layout.items.filter((i) => i.elevation < 0.05 && (specOf(i.catalogId)?.base === 'floor' || (specOf(i.catalogId)?.base === 'stack' && !i.parent)));
  return [
    ...placed.map((i) => ({ id: i.id, poly: boxCorners({ x: i.x, y: i.y, hw: i.width / 2, hd: i.depth / 2, rotation: i.rotation }) })),
    ...existing.map((e) => ({ id: e.id, poly: boxCorners({ x: e.x, y: e.y, hw: e.width / 2, hd: e.depth / 2, rotation: e.rotation }) })),
  ];
}

/** Hard rules checked independently of the solver: ways (stage 0), door swings, overlaps, inside. */
export function independentCheck(room: RoomAnalysis, layout: Layout, existing: FixedPiece[]): string[] {
  const out: string[] = [];
  const obstacles = floorObstacles(layout, existing);
  for (const w of checkWalkways(room, obstacles.map((o) => o.poly))) if (w.fits < w.width - 1e-6) out.push(`Weg ${w.from}–${w.to}: ${w.fits} statt ${w.width}`);
  const swings = room.walls.flatMap((w) => w.openings.filter((o) => o.swingsIn && o.swing?.length).map((o) => ({ id: o.id, poly: o.swing! })));
  const own = obstacles.filter((o) => !existing.some((e) => e.id === o.id));
  for (const o of own) for (const s of swings) if (overlapDepth(o.poly, s.poly) > 0.01) out.push(`${o.id} im Türschwenk ${s.id}`);
  for (let i = 0; i < own.length; i++) {
    for (let j = 0; j < obstacles.length; j++) {
      const a = own[i];
      const b = obstacles[j];
      if (a.id === b.id || (j < own.length && j <= i)) continue;
      const ia = layout.items.find((x) => x.id === a.id);
      const ib = layout.items.find((x) => x.id === b.id);
      // a chair may stand partly under its own table or desk
      if (ia?.parent === b.id || ib?.parent === a.id) continue;
      if (overlapDepth(a.poly, b.poly) > 0.01) out.push(`${a.id} überschneidet ${b.id}`);
    }
  }
  return out;
}

