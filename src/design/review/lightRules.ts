/**
 * L Licht (mgritsch04/wohnungsplaner-3d#436, research of 6.11.2026, docs/EINRICHTUNG_REGELWERK.md):
 * enough light for the room (L6) and lamps spread over the room instead of heaped in one corner
 * (L7). Light hints only (severity L): the room is usable without them, a designer would still
 * change it. The lumen of a lamp is the typical value of its type (`model/lux.ts`), an estimate.
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';
import { LUMEN_PER_M2, isLightStrip, lumenOf } from '../lightPlan';
import type { RoomCtx } from './context';
import { isLamp } from './items';

/** Share of the recommended lumen below which the room counts as too dark (L6). */
const ENOUGH = 0.7;
/** Steh- and table lamps closer than this (m) stand in a heap (L7, Infinigen IG5). */
const LAMP_GAP = 1.0;
/** No place of a living or sleeping room farther than this (m) from the nearest lamp (L7). */
const DARK_REACH = 3.5;
const SPREAD_ROOMS = ['living', 'bedroom', 'kids', 'office', 'dining', 'other'];
const CELL = 0.5;

export function checkLightPlan(ctx: RoomCtx): void {
  if (ctx.type === 'balcony' || ctx.type === 'utility') return;
  const lamps = ctx.items.filter(isLamp);
  const strips = ctx.items.filter((i) => isLightStrip(i.catalogId, i.tags));
  const area = ctx.an.area;
  // L6: light from all lamps against the recommendation of the room type
  // bath and hall: the app has no mirror or wall lights to add, the sheet names them instead
  const need = ctx.type === 'bath' || ctx.type === 'hall' ? undefined : LUMEN_PER_M2[ctx.type];
  if (need && area >= 4 && lamps.length) {
    const lumen = [...lamps, ...strips].reduce((s, l) => s + lumenOf(l.shape), 0);
    if (lumen < need * area * ENOUGH) {
      const want = Math.round((need * area) / 100) * 100;
      ctx.add('L6', 'L', `Alle Leuchten zusammen geben etwa ${Math.round(lumen / 100) * 100} lm, für ${area.toFixed(0)} m² ${ctx.type === 'kitchen' ? 'Küche' : ctx.type === 'bath' ? 'Bad' : 'Raum'} sind etwa ${want} lm üblich: eine hellere Deckenleuchte oder eine Lampe mehr.`, lamps, lamps[0]);
    }
  }
  // L7: two standing or table lamps side by side light the same spot twice
  const low = lamps.filter((l) => l.role !== 'pendant');
  for (const [k, a] of low.entries())
    for (const b of low.slice(k + 1))
      if (Math.hypot(a.x - b.x, a.y - b.y) < LAMP_GAP) {
        ctx.add('L7', 'L', `${ctx.label(a)} und ${ctx.label(b)} stehen keinen Meter auseinander; eine davon leuchtet an anderer Stelle mehr.`, [a, b], a);
        return;
      }
  // L7: no dark half in a room one lives or sleeps in
  if (!SPREAD_ROOMS.includes(ctx.type) || area < 12 || !lamps.length) return;
  const far = darkestPoint(ctx.an.polygon, lamps);
  if (far && far.d > DARK_REACH) ctx.add('L7', 'L', `Ein Teil des Raums liegt ${far.d.toFixed(1)} m von der nächsten Leuchte entfernt und bleibt abends dunkel: dort eine Steh- oder Tischlampe als Stimmungslicht.`, [], far.p);
}

/** The place of the room farthest from every lamp, on a 50 cm grid. */
export function darkestPoint(poly: Vec2[], lamps: Vec2[]): { p: Vec2; d: number } | null {
  if (poly.length < 3 || !lamps.length) return null;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  let best: { p: Vec2; d: number } | null = null;
  // cell centres on a fixed lattice of the plan, not on the corner of this room: mirrored or turned,
  // the same room gets the same points (Q5, as the walking grid)
  const start = (v: number) => (Math.floor(v / CELL + 1e-9) + 0.5) * CELL;
  for (let x = start(Math.min(...xs)); x < Math.max(...xs); x += CELL)
    for (let y = start(Math.min(...ys)); y < Math.max(...ys); y += CELL) {
      const p = { x, y };
      if (!pointInPolygon(p, poly)) continue;
      const d = Math.min(...lamps.map((l) => Math.hypot(l.x - x, l.y - y)));
      if (!best || d > best.d) best = { p, d };
    }
  return best;
}
