/**
 * C/D rules from the picture review of run r4 (6.11.): what the image judge named and the walk-through
 * did not report – rug in the cook's aisle, closed-in bed side, television opposite a window,
 * armchair turned to the dining table, coffee table too small, rug barely wider than the sofa.
 */
import { dist, sub } from '../../model/vec';
import type { RoomCtx } from './context';
import { angleBetween, cm, localRect, overlaps, toLocal } from './geom';
import { isDiningTable, isKitchenModule } from './items';

const deg = (d: number) => (d * Math.PI) / 180;

/** Aisle in front of the kitchen run that stays free (K4: 100 cm). */
const COOK_AISLE = 1.0;

/**
 * D5 (L, G1): the rug of the seating group lies into the cook's aisle in front of the kitchen run.
 * A runner (narrower than 1 m) along the run is on purpose and not meant.
 */
export function checkRugInCookAisle(ctx: RoomCtx): void {
  const mods = ctx.items.filter((i) => i.floor && isKitchenModule(i) && i.kitchen !== 'tall' && i.kitchen !== 'fridge');
  if (!mods.length) return;
  for (const r of ctx.items.filter((i) => i.role === 'rug' && Math.min(i.width, i.depth) >= 1.0 && i.width * i.depth >= 1.5)) {
    const hit = mods.find((m) => overlaps(localRect(m, -m.width / 2, m.width / 2, m.depth / 2, m.depth / 2 + COOK_AISLE), r.poly, 0.03));
    if (hit) {
      ctx.add('D5', 'L', `${ctx.label(r)} reicht bis in den Arbeitsbereich vor der Küchenzeile, dort liegt nichts Loses (Stolperkante, Teppich unter den Küchenfronten).`, [r, hit], r);
      return;
    }
  }
}

/** C1 (M, G2): both long sides of a double bed can be walked to, not only be free for 50 cm (a desk at the foot end closes one). */
export function checkBedSides(ctx: RoomCtx): void {
  if (!ctx.doors.length) return;
  for (const b of ctx.items.filter((i) => i.shape === 'bed' && i.floor && i.width >= 1.3)) {
    const closed = ([-1, 1] as const).filter((s) => {
      const at = { x: b.x + b.right.x * s * (b.width / 2 + 0.3), y: b.y + b.right.y * s * (b.width / 2 + 0.3) };
      return ctx.inRoom(at) && !ctx.grid.touches(ctx.reach, at, 0.15);
    });
    if (closed.length) ctx.add('C1', 'M', `Die ${closed.length === 2 ? 'Seiten' : 'Seite'} von ${ctx.label(b)} ${closed.length === 2 ? 'sind' : 'ist'} eingeschlossen, man kommt nicht hin (Schreibtisch oder Schrank am Fußende?); bei einem Doppelbett müssen beide Seiten erreichbar sein.`, [b], b);
  }
}

/** C3 (L, G3): the television faces a window across the room: the screen mirrors the daylight. */
export function checkTvGlare(ctx: RoomCtx): void {
  for (const tv of ctx.items.filter((i) => i.role === 'tv')) {
    const board = ctx.supportOf(tv);
    for (const w of ctx.windows) {
      if (w.sill > 1.5) continue;
      const to = sub(w.mid, tv);
      const d = Math.hypot(to.x, to.y);
      if (d < 1 || d > 6 || angleBetween(tv.front, to) > deg(30)) continue;
      // the window in the wall behind the television is not looked at by it
      if (board && overlaps(w.strip, board.poly)) continue;
      ctx.add('C3', 'L', `${ctx.label(tv)} steht dem Fenster ${w.label} gegenüber, bei Tageslicht spiegelt sich das Fenster im Bild (Vorhang oder anderer Platz).`, [tv], tv);
      return;
    }
  }
}

/** C2 (M, G5): an armchair of the seating group looks at the dining table instead of the group. */
export function checkArmchairToTable(ctx: RoomCtx): void {
  const tables = ctx.items.filter((i) => isDiningTable(i) && i.floor);
  const sofas = ctx.items.filter((i) => i.role === 'sofa' && i.floor);
  if (!tables.length || !sofas.length) return;
  for (const a of ctx.items.filter((i) => i.role === 'armchair' && i.floor)) {
    const t = tables.sort((p, q) => dist(a, p) - dist(a, q))[0];
    const s = sofas.sort((p, q) => dist(a, p) - dist(a, q))[0];
    if (dist(a, t) > 3.5 || dist(a, s) > 3.5) continue;
    const toT = angleBetween(a.front, sub(t, a));
    const toS = angleBetween(a.front, sub(s, a));
    if (toT < deg(30) && toS > deg(45)) ctx.add('C2', 'M', `${ctx.label(a)} schaut zum Esstisch statt zur Sitzgruppe, wer dort sitzt, gehört zu keiner Gruppe.`, [a, t], a);
  }
}

/** Share of the sofa length a coffee table should have at least (W3: ½ to ⅔). */
const TABLE_SHARE = 0.4;

/** C2 (L, G6, W3): the coffee table is much smaller than the sofa in front of which it stands. */
export function checkCoffeeTableSize(ctx: RoomCtx): void {
  for (const s of ctx.items.filter((i) => i.role === 'sofa' && i.floor && i.width >= 1.4)) {
    const t = ctx.items
      .filter((x) => x.role === 'coffee-table')
      .map((x) => ({ x, lv: toLocal(s, x) }))
      .filter(({ lv }) => lv.v > 0 && Math.abs(lv.u) < s.width / 2)
      .sort((p, q) => p.lv.v - q.lv.v)[0];
    if (!t) continue;
    const along = Math.max(...t.x.poly.map((p) => toLocal(s, p).u)) - Math.min(...t.x.poly.map((p) => toLocal(s, p).u));
    if (along < TABLE_SHARE * s.width - 1e-6) ctx.add('C2', 'L', `${ctx.label(t.x)} ist mit ${cm(along)} cm viel kleiner als ${ctx.label(s)} (${cm(s.width)} cm), gut sind ½ bis ⅔ der Sofalänge (W3).`, [t.x, s], t.x);
  }
}

/** Least overhang (m) of the rug beyond the ends of the sofa; below it the rug looks like an accident (W6: 15–45 cm). */
const RUG_OVERHANG = 0.1;

/** D5 (L, G7, W6): the rug under the front of the sofa is barely wider than the sofa. */
export function checkRugOverhang(ctx: RoomCtx): void {
  for (const r of ctx.items.filter((i) => i.role === 'rug' && i.width * i.depth >= 1.5)) {
    const s = ctx.items.filter((x) => x.role === 'sofa' && x.floor && overlaps(r.poly, x.poly, 0.15)).sort((p, q) => dist(p, r) - dist(q, r))[0];
    const group = ctx.items.some((t) => t.role === 'coffee-table' && overlaps(r.poly, t.poly, -0.05));
    if (!s || !group) continue;
    const us = r.poly.map((p) => toLocal(s, p).u);
    const left = -Math.min(...us) - s.width / 2;
    const right = Math.max(...us) - s.width / 2;
    // against a wall the rug cannot reach further on that side
    const wallSide = (side: 1 | -1) => !ctx.inRoom({ x: s.x + s.right.x * side * (s.width / 2 + RUG_OVERHANG + 0.05), y: s.y + s.right.y * side * (s.width / 2 + RUG_OVERHANG + 0.05) });
    const little = Math.min(wallSide(-1) ? Infinity : left, wallSide(1) ? Infinity : right);
    // a rug narrower than the sofa is a different matter (too small), not „barely wider“
    if (little >= -0.02 && little < RUG_OVERHANG - 0.005) ctx.add('D5', 'L', `${ctx.label(r)} ragt nur ${cm(Math.max(0, little))} cm über ${ctx.label(s)} hinaus, schön sind 15 bis 45 cm je Seite (W6).`, [r, s], r);
  }
}

