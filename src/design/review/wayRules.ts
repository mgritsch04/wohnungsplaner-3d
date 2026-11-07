/** B Wege und Zugang (#441): can one get through, to the doors, to the pieces and around them? */
import type { Vec2 } from '../../model/vec';
import { checkWalkways } from '../analysis';
import type { RoomMetrics } from '../types';
import type { Clear, RoomCtx, Win } from './context';
import { cm, localRect, overlaps, pointPolyDist, segmentHitsConvex } from './geom';
import { isDiningTable, isKitchenModule, type RItem } from './items';

/** B1 (S), B2 (M), B3 (L) between the doors (the ways of stage 0); returns the walk lengths for the metrics. */
export function checkWays(ctx: RoomCtx): Pick<RoomMetrics, 'walkEmpty' | 'walkFurnished'> {
  let walkEmpty = 0;
  let walkFurnished = 0;
  const checks = checkWalkways(
    ctx.an,
    ctx.items.filter((i) => i.obstacle).map((i) => i.poly),
  );
  for (const w of checks) {
    const names = `${w.from} und ${w.to}`;
    const mid = w.path.length ? w.path[Math.floor(w.path.length / 2)] : (ctx.doors.find((d) => d.label === w.from)?.entry ?? ctx.an.polygon[0]);
    walkEmpty += w.emptyLength;
    if (w.fits === 0) {
      ctx.add('B1', 'S', `Zwischen den Türen ${names} kommt man nicht mehr durch.`, [], mid);
      continue;
    }
    walkFurnished += w.length;
    if (w.fits < w.width - 1e-6) ctx.add('B2', 'M', `Der Weg zwischen den Türen ${names} ist nur ${cm(w.fits)} cm breit, gebraucht werden ${cm(w.width)} cm.`, [], mid);
    else if (w.length > w.emptyLength * 1.25 + 0.5) ctx.add('B3', 'L', `Der Weg zwischen den Türen ${names} wird durch die Möbel von ${w.emptyLength.toFixed(1)} m auf ${w.length.toFixed(1)} m länger.`, [], mid);
  }
  return { walkEmpty, walkFurnished };
}

/** B4 (S) in the door swing, B5 (M) right behind the door. */
export function checkDoors(ctx: RoomCtx): void {
  for (const d of ctx.doors) {
    const swing = d.swing;
    const hitSwing = new Set<string>();
    if (swing) {
      for (const i of ctx.items) {
        // Bestand in the swing was there before: the proposal cannot move it
        if (i.existing || !(i.elevation < 0.05 && i.height >= 0.1) || i.role === 'rug' || i.role === 'curtain' || i.role === 'mattress' || i.category === 'textile') continue;
        if (overlaps(swing, localRect(i, -i.width / 2 + 0.02, i.width / 2 - 0.02, -i.depth / 2 + 0.02, i.depth / 2 - 0.02), 1e-4)) {
          hitSwing.add(i.id);
          ctx.add('B4', 'S', `${ctx.label(i)} steht im Aufschwung der Tür ${d.label}, die Tür lässt sich nicht ganz öffnen.`, [i], i);
        }
      }
    }
    // the strip right behind every door: nothing solid within 50 cm
    const strip: Vec2[] = [
      { x: d.mid.x - d.wall.dir.x * d.width / 2, y: d.mid.y - d.wall.dir.y * d.width / 2 },
      { x: d.mid.x + d.wall.dir.x * d.width / 2, y: d.mid.y + d.wall.dir.y * d.width / 2 },
    ];
    const rect = [strip[0], strip[1], { x: strip[1].x + d.wall.inward.x * 0.5, y: strip[1].y + d.wall.inward.y * 0.5 }, { x: strip[0].x + d.wall.inward.x * 0.5, y: strip[0].y + d.wall.inward.y * 0.5 }];
    for (const i of ctx.items) {
      if (!i.obstacle || i.existing || hitSwing.has(i.id)) continue;
      if (overlaps(rect, localRect(i, -i.width / 2 + 0.02, i.width / 2 - 0.02, -i.depth / 2 + 0.02, i.depth / 2 - 0.02), 1e-4))
        ctx.add('B5', 'M', `${ctx.label(i)} steht keine 50 cm hinter der Tür ${d.label}, man stößt gleich daran.`, [i], i);
    }
  }
}

/**
 * Bestand that only meets the wall or other Bestand (the fitted WC opposite the fitted shower):
 * nothing the proposal could change, so no finding.
 */
const fixed = (i: RItem, ...cs: Clear[]): boolean => i.existing && cs.every((c) => c.blocker === 'wall' || (c.blocker !== undefined && c.blocker.existing));

/** A wardrobe for clothes with swing doors: not a broom or kitchen cupboard, not sliding doors (they need no swing). */
const isClothesWardrobe = (i: RItem, label: string): boolean => i.shape === 'wardrobe' && /kleider|garderobe|ankleide|wardrobe/i.test(label) && !/schiebe|sliding/i.test(label);

/** The kinds of pieces that need free floor in front or beside them, and how much. */
function clearances(ctx: RoomCtx): void {
  const skipSeats = (x: RItem) => x.role === 'seat';
  for (const i of ctx.items) {
    if (!i.floor) continue;
    if (i.shape === 'wardrobe' || (i.category === 'storage' && i.height >= 1.2 && i.role !== 'box' && !isKitchenModule(i) && i.shape !== 'shelf' && i.tags.includes('schrank'))) {
      const c = ctx.freeDepth(i, 'front', 0.9, { ignore: skipSeats });
      if (c.depth < 0.7 - 1e-6 && !fixed(i, c)) ctx.add('B6', 'M', `Vor ${ctx.label(i)} sind nur ${cm(c.depth)} cm frei, zum Öffnen und Ausräumen braucht man 70 cm.`, [i], i);
      // 70 to 90 cm: the doors open, but cramped; planners count 90 cm in front of a wardrobe with swing doors (DIN 18011, ST1); sliding doors need no swing
      else if (c.depth < 0.9 - 1e-6 && isClothesWardrobe(i, ctx.label(i)) && !fixed(i, c)) ctx.add('B6', 'L', `Vor ${ctx.label(i)} sind ${cm(c.depth)} cm frei, eng zum Öffnen der Drehtüren: Profis planen 90 cm (DIN 18011).`, [i], i);
    } else if (i.shape === 'bed') {
      const left = ctx.freeDepth(i, 'left', 0.5, { ignore: skipSeats, skip: 0.5 });
      const right = ctx.freeDepth(i, 'right', 0.5, { ignore: skipSeats, skip: 0.5 });
      if (Math.max(left.depth, right.depth) < 0.5 - 1e-6 && !fixed(i, left, right)) ctx.add('B6', 'M', `Neben ${ctx.label(i)} ist keine Seite 50 cm frei, man kommt kaum ins Bett.`, [i], i);
    } else if (i.category === 'desk') {
      const c = ctx.freeDepth(i, 'front', 0.75, { ignore: skipSeats });
      if (c.depth < 0.75 - 1e-6 && !fixed(i, c)) ctx.add('B6', 'M', `Am Schreibtisch ist für den Stuhl nicht genug Platz, es sind ${cm(c.depth)} statt 75 cm.`, [i], i);
    } else if (i.shape === 'toilet' || i.shape === 'washbasin') {
      const c = ctx.freeDepth(i, 'front', 0.55, { ignore: skipSeats });
      if (c.depth < 0.55 - 1e-6 && !fixed(i, c)) ctx.add('B6', 'M', `Vor ${ctx.label(i)} sind nur ${cm(c.depth)} cm frei, nötig sind 55 cm.`, [i], i);
    }
  }
  // kitchen run: 1.00 m between the modules and whatever is opposite; below 1.20 m is cramped for an L-shaped kitchen
  const reported = new Set<number>();
  const mods = ctx.items.filter((i) => i.floor && isKitchenModule(i) && i.kitchen !== 'tall' && i.kitchen !== 'fridge');
  for (const m of mods) {
    const c = ctx.freeDepth(m, 'front', 1.2, { ignore: (x) => x.floor && isKitchenModule(x) });
    if (c.depth >= 1.2 - 1e-6 || fixed(m, c)) continue;
    const blocker = c.blocker;
    if (blocker && blocker !== 'wall' && isDiningTable(blocker)) {
      if (!reported.has(-1)) {
        reported.add(-1);
        ctx.add('C4', 'M', `${ctx.label(blocker)} steht im Arbeitsgang der Küche, vor der Zeile bleiben ${cm(c.depth)} cm.`, [blocker], blocker);
      }
      continue;
    }
    const key = Math.round(m.rotation * 100);
    if (reported.has(key)) continue;
    reported.add(key);
    if (c.depth < 1.0 - 1e-6) ctx.add('B6', 'M', `Vor der Küchenzeile sind nur ${cm(c.depth)} cm frei, nötig sind 100 cm.`, [m], m);
    else ctx.add('B6', 'L', `Vor der Küchenzeile sind ${cm(c.depth)} cm frei, bequem wären 120 cm.`, [m], m);
  }
}

export function checkClearances(ctx: RoomCtx): void {
  clearances(ctx);
}

const SERVED = new Set(['side-table', 'floor-lamp']);
const SEATS = new Set(['sofa', 'armchair']);

/** B7 (M) not reachable, B8 (L) no window reachable. */
export function checkReach(ctx: RoomCtx): void {
  if (!ctx.doors.length) return;
  const g = ctx.grid;
  for (const i of ctx.placed) {
    if (!i.floor || i.category === 'decor' || isKitchenModule(i)) continue;
    // a side table or lamp at the arm of a seat is used from the seat (W4, L4)
    if (SERVED.has(i.role) && ctx.placed.some((s) => SEATS.has(s.role) && pointPolyDist({ x: i.x, y: i.y }, s.poly) < 0.25 + Math.max(i.width, i.depth) / 2)) continue;
    // to a chair one sidesteps along the table (40 cm); everything else needs the 50 cm way
    const seen = i.role === 'seat' ? ctx.reachSideways : ctx.reach;
    if (!g.touches(seen, i, Math.max(i.width, i.depth) / 2 + 0.5)) ctx.add('B7', 'M', `${ctx.label(i)} ist nicht erreichbar, der Weg dorthin ist zugestellt.`, [i], i);
  }
  if (ctx.type !== 'balcony' && ctx.windows.length && !ctx.windows.some((w) => windowReachable(ctx, w)))
    ctx.add('B8', 'L', 'Kein Fenster des Raums ist erreichbar, man kann nicht lüften.', [], ctx.windows[0].mid);
}

/** Pieces one pushes aside with one hand to get to the window: a reading chair, side table or floor lamp. */
const MOVABLE = new Set(['armchair', 'side-table', 'floor-lamp', 'seat']);

/**
 * Standing at the window anywhere along its width, or in front of a low piece under it (the worktop
 * under the kitchen window, a sideboard, the bathtub): one leans over it to open the window. A reading
 * chair at the window is pushed aside (the reading corner at the window is a designer's pattern, S7).
 * Benchmark 7.11.: all four B8 findings were a bathtub 75 cm deep or an armchair at the window.
 */
function windowReachable(ctx: RoomCtx, w: Win): boolean {
  const n = Math.max(1, Math.floor((w.t1 - w.t0 - 0.4) / 0.3) + 1);
  const along = Array.from({ length: n }, (_, k) => (n === 1 ? (w.t0 + w.t1) / 2 : w.t0 + 0.2 + (k * (w.t1 - w.t0 - 0.4)) / (n - 1)));
  return along.some((t) => {
    const base = { x: w.wall.a.x + w.wall.dir.x * t, y: w.wall.a.y + w.wall.dir.y * t };
    const at = (d: number) => ({ x: base.x + w.wall.inward.x * d, y: base.y + w.wall.inward.y * d });
    if (ctx.grid.touches(ctx.reach, at(0.3), 0.5)) return true;
    // the pieces between the window and the room, also with a narrow pocket behind them (a reading chair
    // in a bay stands up to 40 cm off the glass; benchmark 7.11.: E living room, bay of three windows)
    const under = ctx.items.filter((i) => i.obstacle && (pointPolyDist(at(0.3), i.poly) < 0.05 || segmentHitsConvex(at(0.05), at(0.6), i.poly)));
    if (!under.length) return false;
    // how far into the room the pieces reach, measured from the window
    const far = Math.max(...under.flatMap((i) => i.poly.map((v) => (v.x - base.x) * w.wall.inward.x + (v.y - base.y) * w.wall.inward.y)));
    // a chair is moved, then one stands where it was
    if (under.every((i) => MOVABLE.has(i.role))) return ctx.grid.touches(ctx.reach, at(far + 0.3), 0.5);
    if (under.some((i) => i.height > w.sill + 0.05)) return false;
    // over a bathtub (58 cm high) one leans further than over a worktop
    const lean = under.every((i) => i.height <= 0.65) ? 0.8 : 0.7;
    return far <= lean + 0.05 && ctx.grid.touches(ctx.reach, at(far + 0.3), 0.5);
  });
}
