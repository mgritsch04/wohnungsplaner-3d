/** C Anordnung (#441): do the pieces stand the way people set them up? */
import { dist, dot, sub, type Vec2 } from '../../model/vec';
import type { RoomCtx } from './context';
import { angleBetween, boundaryDist, cm, overlaps, pointPolyDist, polyDist, toLocal } from './geom';
import { isDiningTable, isKitchenModule, isLamp, isPlant, type RItem } from './items';

const deg = (d: number) => (d * Math.PI) / 180;
const seat = (x: RItem) => x.role === 'seat';

/** C1: beds. */
export function checkBeds(ctx: RoomCtx): void {
  for (const b of ctx.items.filter((i) => i.shape === 'bed' && i.floor)) {
    const head = { x: b.x - b.front.x * b.depth / 2, y: b.y - b.front.y * b.depth / 2 };
    if (boundaryDist(head, ctx.an.polygon) > 0.15) ctx.add('C1', 'M', `Das Kopfteil von ${ctx.label(b)} steht nicht an der Wand, der Rücken hat keinen Halt.`, [b], b);
    const win = ctx.windows.find((w) => w.sill < 1.2 && pointPolyDist(head, w.strip) < 0.2);
    if (win) ctx.add('C1', 'L', `Das Kopfteil von ${ctx.label(b)} steht unter dem Fenster ${win.label}, es zieht und blendet.`, [b], b);
    if (b.width >= 1.3) {
      const sides = (['left', 'right'] as const).filter((s) => ctx.freeDepth(b, s, 0.5, { ignore: seat, skip: 0.5 }).depth >= 0.5 - 1e-6).length;
      if (sides === 1) ctx.add('C1', 'M', `Zu ${ctx.label(b)} kommt man nur von einer Seite, für zwei Personen sollten beide Seiten frei sein.`, [b], b);
    }
  }
}

/** C2: seating group. */
export function checkSeating(ctx: RoomCtx): void {
  const tables = ctx.items.filter((i) => i.role === 'coffee-table');
  const sofas = ctx.items.filter((i) => i.role === 'sofa' && i.floor);
  for (const s of sofas) {
    if (tables.length) {
      const front = tables
        .map((t) => ({ t, lv: toLocal(s, t) }))
        .filter(({ lv }) => lv.v > 0 && Math.abs(lv.u) < s.width / 2 + 0.3)
        .map(({ t, lv }) => ({ t, gap: lv.v - s.depth / 2 - t.depth / 2 }))
        .sort((a, b) => a.gap - b.gap)[0];
      if (!front) ctx.add('C2', 'M', `Der Couchtisch steht nicht vor ${ctx.label(s)}.`, [s, ...tables], s);
      else if (front.gap < 0.3 - 0.01 || front.gap > 0.6 + 0.01)
        ctx.add('C2', 'M', `Der Couchtisch steht ${cm(front.gap)} cm vor ${ctx.label(s)}, bequem sind 30 bis 60 cm.`, [s, front.t], front.t);
    } else if (ctx.type === 'living' && ctx.an.area >= 12) {
      // a sofa alone looks parked, not furnished (#443): the coffee table makes it a group
      ctx.add('C2', 'L', `Vor ${ctx.label(s)} fehlt ein Couchtisch, ohne ihn wirkt das Sofa abgestellt.`, [s], s);
    }
    for (const d of ctx.doors) {
      const l = toLocal(s, d.entry);
      if (l.v < -0.1 && Math.abs(l.u) < s.width / 2 + 0.45 && -l.v - s.depth / 2 < 1.0) {
        ctx.add('C2', 'L', `${ctx.label(s)} steht mit dem Rücken direkt vor der Tür ${d.label}.`, [s], s);
        break;
      }
    }
  }
  // armchairs face the group
  const centre = (() => {
    const base = sofas[0] ?? tables[0];
    if (!base) return undefined;
    const t = tables[0] ?? base;
    return { x: (base.x + t.x) / 2, y: (base.y + t.y) / 2 };
  })();
  if (centre)
    for (const a of ctx.items.filter((i) => i.role === 'armchair' && i.floor)) {
      const to = sub(centre, a);
      if (Math.hypot(to.x, to.y) > 0.4 && angleBetween(a.front, to) > deg(70)) ctx.add('C2', 'M', `${ctx.label(a)} schaut nicht zur Sitzgruppe, man sitzt mit dem Rücken zu den anderen.`, [a], a);
    }
}

/** C3: television. */
export function checkTv(ctx: RoomCtx): void {
  for (const tv of ctx.items.filter((i) => i.role === 'tv')) {
    const diag = tv.width / 0.872;
    const sofa = ctx.items.filter((i) => i.role === 'sofa' && i.floor).sort((a, b) => dist(a, tv) - dist(b, tv))[0];
    if (sofa) {
      const to = sub(tv, sofa);
      const d = Math.hypot(to.x, to.y) - sofa.depth / 2;
      const angle = angleBetween(sofa.front, to);
      if (angle > deg(80)) ctx.add('C3', 'S', `${ctx.label(tv)} hängt seitlich oder hinter ${ctx.label(sofa)}, vom Sofa aus sieht man nicht hin.`, [tv, sofa], tv);
      else if (angle > deg(30)) ctx.add('C3', 'M', `${ctx.label(tv)} hängt nicht gegenüber von ${ctx.label(sofa)}, man müsste den Kopf drehen.`, [tv, sofa], tv);
      else if (d < 1.5 * diag - 0.01 || d > 2.5 * diag + 0.01)
        ctx.add('C3', 'M', `Zwischen Sofa und Fernseher liegen ${d.toFixed(1)} m, bei diesem Gerät sind ${(1.5 * diag).toFixed(1)} bis ${(2.5 * diag).toFixed(1)} m angenehm.`, [tv, sofa], tv);
    }
    const board = ctx.supportOf(tv);
    for (const w of ctx.windows) if (overlaps(w.strip, (board ?? tv).poly)) ctx.add('C3', 'M', `${ctx.label(tv)} steht vor dem Fenster ${w.label}, bei Tageslicht spiegelt es.`, [tv], tv);
  }
}

/** C4: dining table. */
export function checkDining(ctx: RoomCtx): void {
  const tables = ctx.items.filter((i) => isDiningTable(i) && i.floor && !ctx.an.userZones.some((z) => z.keepFree));
  const chairs = ctx.items.filter((i) => i.role === 'seat' && i.category === 'chair' && i.shape === 'chair');
  if (!tables.length) return;
  const loose = chairs.filter((c) => Math.min(...tables.map((t) => polyDist(c.poly, t.poly))) > 0.4);
  if (loose.length) ctx.add('C4', 'M', `${loose.length === 1 ? 'Ein Stuhl steht' : `${loose.length} Stühle stehen`} nicht am Tisch.`, loose, loose[0]);
  const pendants = ctx.items.filter((i) => i.role === 'pendant');
  for (const t of tables) {
    if (chairs.filter((c) => polyDist(c.poly, t.poly) < 0.4).length < 2) continue;
    // sides with chairs: room behind the chairs
    let tight = 0;
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const sideChairs = chairs.filter((c) => {
        const l = toLocal(t, c);
        const along = side === 'front' ? l.v : side === 'back' ? -l.v : side === 'right' ? l.u : -l.u;
        const half = side === 'front' || side === 'back' ? t.depth / 2 : t.width / 2;
        return along > half - 0.1 && polyDist(c.poly, t.poly) < 0.4;
      });
      if (!sideChairs.length) continue;
      if (ctx.freeDepth(t, side, 0.75, { ignore: seat }).depth < 0.75 - 1e-6) tight++;
    }
    if (tight > 1) ctx.add('C4', 'L', `Hinter den Stühlen am Tisch ist auf ${tight} Seiten weniger als 75 cm Platz zum Aufstehen.`, [t], t);
    if (pendants.length && !pendants.some((p) => dist(p, t) < 0.5)) ctx.add('C4', 'L', 'Die Pendelleuchte hängt nicht über dem Esstisch.', [t, pendants[0]], pendants[0]);
  }
}

/** C5: desk and daylight. */
export function checkDesk(ctx: RoomCtx): void {
  for (const d of ctx.items.filter((i) => i.category === 'desk' && i.floor)) {
    const eye: Vec2 = { x: d.x + d.front.x * (d.depth / 2 + 0.4), y: d.y + d.front.y * (d.depth / 2 + 0.4) };
    for (const w of ctx.windows) {
      if (w.sill > 1.5) continue;
      const to = sub(w.mid, eye);
      if (Math.hypot(to.x, to.y) > 5) continue;
      const ahead = angleBetween({ x: -d.front.x, y: -d.front.y }, to) < deg(35);
      const behind = angleBetween(d.front, to) < deg(35);
      if (ahead) ctx.add('C5', 'L', `Das Fenster ${w.label} liegt hinter dem Bildschirm, man blickt beim Arbeiten ins Licht.`, [d], d);
      else if (behind) ctx.add('C5', 'L', `Das Fenster ${w.label} liegt im Rücken des Schreibtischs und spiegelt sich im Bildschirm.`, [d], d);
    }
  }
}

/** C6, C7: tall pieces. */
export function checkTall(ctx: RoomCtx): void {
  const dividers = new Set((ctx.program?.relations ?? []).flatMap((r) => (r.kind === 'center' ? [r.item] : [])));
  for (const i of ctx.placed) {
    if (!i.floor || isPlant(i) || isLamp(i) || isKitchenModule(i) || i.role === 'seat' || i.role === 'tv') continue;
    if (i.height > 1.2 && !dividers.has(i.id) && i.category !== 'bathroom') {
      const near = Math.min(...i.poly.map((p) => boundaryDist(p, ctx.an.polygon)));
      const touching = ctx.items.some((o) => o !== i && o.floor && o.height > 1.2 && polyDist(o.poly, i.poly) < 0.05);
      if (near > 0.3 && !touching) ctx.add('C6', 'M', `${ctx.label(i)} steht hoch und frei im Raum, ohne Wand dahinter.`, [i], i);
    }
    if (i.shape === 'bed' && ctx.windows.every((w) => w.sill >= 0.6)) continue;
    for (const w of ctx.windows) {
      if (i.height > w.sill + 0.02 && overlaps(w.strip, i.poly) && i.role !== 'curtain') {
        ctx.add('C7', 'M', `${ctx.label(i)} ist höher als die Fensterbank und steht direkt vor dem Fenster ${w.label}.`, [i], i);
        break;
      }
    }
  }
}

/** C8 (L): wall pieces crooked or with a gap to the wall. */
export function checkWallFit(ctx: RoomCtx): void {
  const dividers = new Set((ctx.program?.relations ?? []).flatMap((r) => (r.kind === 'center' ? [r.item] : [])));
  for (const i of ctx.placed) {
    if (!i.floor || dividers.has(i.id) || !['wall', 'corner', 'tv-board', 'nightstand'].includes(i.role) || isKitchenModule(i) || isPlant(i)) continue;
    const back = { x: -i.front.x, y: -i.front.y };
    let best: { gap: number; ang: number } | undefined;
    for (const w of ctx.an.walls) {
      const out = { x: -w.inward.x, y: -w.inward.y };
      const ang = angleBetween(back, out);
      if (ang > deg(25)) continue;
      const corners = [-1, 1].map((s) => ({ x: i.x + back.x * i.depth / 2 + i.right.x * s * i.width / 2, y: i.y + back.y * i.depth / 2 + i.right.y * s * i.width / 2 }));
      const gaps = corners.map((c) => dot(sub(c, w.a), w.inward));
      const gap = Math.min(...gaps);
      const along = corners.map((c) => dot(sub(c, w.a), w.dir));
      if (Math.max(...along) < -0.1 || Math.min(...along) > w.length + 0.1 || gap < -0.05 || gap > 0.3) continue;
      if (!best || gap < best.gap) best = { gap, ang };
    }
    if (!best) continue;
    if (best.ang > deg(3)) ctx.add('C8', 'L', `${ctx.label(i)} steht schief zur Wand.`, [i], i);
    else if (best.gap > 0.05) ctx.add('C8', 'L', `Zwischen ${ctx.label(i)} und der Wand klafft ein Spalt von ${cm(best.gap)} cm.`, [i], i);
  }
}

/** C9 (M): wedged in. */
export function checkWedged(ctx: RoomCtx): void {
  const list = ctx.items.filter((i) => i.floor && !isKitchenModule(i) && !isLamp(i) && !isPlant(i) && i.category !== 'decor');
  const sitting = (i: RItem) => i.role === 'seat' || i.category === 'desk' || i.role === 'table';
  for (let a = 0; a < list.length; a++)
    for (let b = a + 1; b < list.length; b++) {
      const p = list[a];
      const q = list[b];
      if (p.existing && q.existing) continue;
      if (q.parent === p.id || p.parent === q.id) continue;
      if (sitting(p) && sitting(q)) continue;
      const roles = new Set([p.role, q.role]);
      if (roles.has('bed') && roles.has('nightstand')) continue;
      if (roles.has('coffee-table')) continue;
      if (p.category === 'storage' && q.category === 'storage' && p.shape === q.shape) continue;
      const gap = polyDist(p.poly, q.poly);
      if (gap > 0.05 && gap < 0.2) ctx.add('C9', 'M', `Zwischen ${ctx.label(p)} und ${ctx.label(q)} sind nur ${cm(gap)} cm, da passt niemand durch und man kommt schlecht an beide heran.`, [p, q], { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    }
}
