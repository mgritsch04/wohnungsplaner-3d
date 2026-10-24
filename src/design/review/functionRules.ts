/** A Funktion (#441): does the room do what its type promises, and nothing twice? */
import { dist } from '../../model/vec';
import type { RoomCtx } from './context';
import { isDiningTable, isKitchenModule, isSanitary, seatsOf, type RItem } from './items';
import { polyDist, toPlan } from './geom';

const has = (ctx: RoomCtx, pred: (i: RItem) => boolean): boolean => ctx.items.some(pred);
const isStorageFurniture = (i: RItem) => i.category === 'storage' && i.role !== 'box' && i.role !== 'tv-board' && i.height >= 0.7 && i.elevation < 0.5;
/** Chairs standing at a dining table of the room. */
const tableChairs = (ctx: RoomCtx): number => {
  const tables = ctx.items.filter((i) => isDiningTable(i) && i.floor);
  return ctx.items.filter((s) => s.role === 'seat' && tables.some((t) => dist(s, t) < 1.5)).length;
};

/** A1 (S): required pieces of the room type; fitted pieces count. */
export function checkRequired(ctx: RoomCtx): void {
  const miss = (what: string, sev: 'S' | 'M' = 'S') => ctx.add('A1', sev, what, []);
  const area = ctx.an.area;
  const toilet = has(ctx, (i) => i.shape === 'toilet');
  const washbasin = has(ctx, (i) => i.shape === 'washbasin');
  switch (ctx.type) {
    case 'bedroom':
      if (!has(ctx, (i) => i.role === 'bed')) miss('Im Schlafzimmer fehlt das Bett.');
      else if (area >= 8 && !has(ctx, isStorageFurniture)) miss('Im Schlafzimmer fehlt ein Schrank oder eine Kommode für die Kleidung.', 'M');
      break;
    case 'living': {
      const lounge = ctx.items.reduce((n, i) => n + seatsOf(i), 0);
      // a table with chairs in the same room (Garçonnière, Wohn-Ess-Zimmer) seats guests too, once there is a sofa or armchair
      if (!lounge) miss('Im Wohnzimmer fehlt ein Sofa oder Sessel zum Sitzen.');
      else if (lounge + tableChairs(ctx) < 3) miss('Im Wohnzimmer gibt es weniger als drei Sitzplätze.');
      break;
    }
    case 'kitchen':
      break;
    case 'dining':
      if (!has(ctx, isDiningTable)) miss('Im Esszimmer fehlt der Esstisch.');
      else if (ctx.items.filter((i) => i.role === 'seat').length < 2) miss('Im Esszimmer fehlen die Stühle am Tisch.');
      break;
    case 'office':
      if (!has(ctx, (i) => i.category === 'desk')) miss('Im Arbeitszimmer fehlt der Schreibtisch.');
      if (!has(ctx, (i) => i.role === 'seat')) miss('Im Arbeitszimmer fehlt der Stuhl am Schreibtisch.');
      break;
    case 'hall':
      if (area >= 2 && !has(ctx, (i) => i.role === 'coat-rack' || i.shape === 'wardrobe' || i.tags?.includes('garderobe'))) miss('Im Vorraum fehlt eine Garderobe.');
      break;
    case 'bath': {
      const wc = toilet && !has(ctx, (i) => i.shape === 'shower' || i.shape === 'bathtub') && area < 3.5;
      if (wc) {
        if (!washbasin) miss('Im WC fehlt ein Handwaschbecken.', 'M');
      } else {
        if (!washbasin) miss('Im Bad fehlt der Waschtisch.');
        if (!toilet && !has(ctx, (i) => i.shape === 'shower' || i.shape === 'bathtub')) miss('Im Bad fehlt WC, Dusche oder Wanne.');
      }
      break;
    }
    case 'kids':
      if (!has(ctx, (i) => i.role === 'bed')) miss('Im Kinderzimmer fehlt das Bett.');
      if (!has(ctx, isStorageFurniture)) miss('Im Kinderzimmer fehlt Stauraum.', 'M');
      if (!has(ctx, (i) => i.category === 'desk' || (i.role === 'table' && i.category === 'table'))) miss('Im Kinderzimmer fehlt ein Tisch zum Spielen und Lernen.', 'M');
      break;
    case 'balcony':
      if (area >= 2 && !has(ctx, (i) => i.role === 'seat' || seatsOf(i) > 0)) miss('Auf dem Balkon fehlt ein Sitzplatz.');
      break;
    default:
  }
  // a kitchen, or another room with a kitchen run (Wohnküche); a wall cabinet over the washer is none
  if (ctx.type === 'kitchen' || has(ctx, (i) => ['sink', 'cooktop', 'oven', 'dishwasher'].includes(i.kitchen ?? ''))) {
    if (!has(ctx, (i) => i.kitchen === 'sink')) miss('In der Küche fehlt die Spüle.');
    if (!has(ctx, (i) => i.kitchen === 'cooktop')) miss('In der Küche fehlt das Kochfeld.');
    if (!has(ctx, (i) => i.kitchen === 'fridge')) miss('In der Küche fehlt der Kühlschrank.');
    // the worktop runs over base cabinets and the dishwasher
    if (!has(ctx, (i) => i.kitchen === 'base' || i.kitchen === 'dishwasher')) miss('In der Küche fehlt eine Arbeitsfläche.');
  }
  // a required piece of the programme that was left out: never silent
  for (const d of ctx.layout.dropped) {
    const prog = ctx.program?.items.find((p) => p.id === d.id);
    if (prog?.required) ctx.add('A1', 'S', `${prog.label ?? d.catalogId} fehlt: ${d.reason}`, [d.id]);
  }
}

/** A3 (S): sanitary pieces are never planned anew (a hand basin in the WC may be). */
export function checkSanitary(ctx: RoomCtx): void {
  if (ctx.options.allowNewSanitary) return;
  const wc = ctx.items.some((i) => i.shape === 'toilet') && !ctx.items.some((i) => i.shape === 'shower' || i.shape === 'bathtub');
  for (const i of ctx.placed) {
    if (!isSanitary(i)) continue;
    if (i.shape === 'washbasin' && wc && ctx.an.area < 3.5) continue;
    ctx.add('A3', 'S', `${ctx.label(i)} ist neu geplant, Sanitärobjekte bleiben aber, wo sie sind.`, [i], i);
  }
}

/** A4 (M): the working triangle and worktop of a kitchen. */
export function checkKitchen(ctx: RoomCtx): void {
  const mods = ctx.items.filter(isKitchenModule);
  // the existing kitchen stays as it is: nothing to plan there
  if (!mods.some((i) => !i.existing)) return;
  const sink = mods.find((i) => i.kitchen === 'sink');
  const cook = mods.find((i) => i.kitchen === 'cooktop');
  const fridge = mods.find((i) => i.kitchen === 'fridge');
  if (sink && cook) {
    const gap = Math.max(0, polyDist(sink.poly, cook.poly) - 0);
    // the cooktop sits on a base module: the distance counts along the run from the sink's edge
    if (gap < 0.6 - 0.01) ctx.add('A4', 'M', `Zwischen Spüle und Kochfeld sind nur ${Math.round(gap * 100)} cm Arbeitsfläche, gebraucht werden mindestens 60 cm.`, [sink, cook], cook);
  }
  if (cook) {
    const tall = mods.find((i) => (i.kitchen === 'tall' || i.kitchen === 'fridge') && i !== cook && polyDist(i.poly, cook.poly) < 0.3);
    const wallNear = [-1, 1].some((s) => !ctx.inRoom(toPlan(cook, (s * (cook.width / 2 + 0.29)), 0)));
    if (tall || wallNear) ctx.add('A4', 'M', 'Das Kochfeld steht direkt neben einem Hochschrank oder einer Wand, daneben bleibt weniger als 30 cm Platz zum Abstellen.', [cook], cook);
  }
  if (sink && cook && fridge) {
    const total = dist(sink, cook) + dist(cook, fridge) + dist(fridge, sink);
    if (total < 3.6) ctx.add('A4', 'M', `Das Arbeitsdreieck aus Kühlschrank, Spüle und Kochfeld ist mit ${total.toFixed(1)} m sehr eng.`, [sink, cook, fridge], sink);
    else if (total > 7) ctx.add('A4', 'M', `Das Arbeitsdreieck aus Kühlschrank, Spüle und Kochfeld ist mit ${total.toFixed(1)} m zu weitläufig.`, [sink, cook, fridge], sink);
  }
}

/** A5 (M): the anchor pieces stand in their zone. */
export function checkAnchors(ctx: RoomCtx): void {
  const prog = ctx.program;
  if (!prog) return;
  for (const p of prog.items) {
    if (!p.required) continue;
    const zone = prog.zones.find((z) => z.id === p.zone);
    const it = ctx.byId(p.id);
    if (!zone || !it) continue;
    const r = zone.rect;
    const out = Math.max(r.x0 - it.x, it.x - r.x1, r.y0 - it.y, it.y - r.y1, 0);
    if (out > 0.3) ctx.add('A5', 'M', `${ctx.label(it)} steht nicht in „${zone.function}“, wo es hingehört.`, [it], it);
  }
  for (const z of prog.zones) {
    if (!/lese|lesen/i.test(z.function)) continue;
    // outside, the folding chair is the reading seat
    const inside = ctx.placed.some((i) => i.floor && (i.role === 'armchair' || i.role === 'sofa' || (ctx.type === 'balcony' && i.role === 'seat')) && i.x >= z.rect.x0 - 0.2 && i.x <= z.rect.x1 + 0.2 && i.y >= z.rect.y0 - 0.2 && i.y <= z.rect.y1 + 0.2);
    if (!inside) ctx.add('A5', 'M', `Die ${z.function} hat keinen Sessel oder kein Sofa zum Sitzen.`, [], { x: (z.rect.x0 + z.rect.x1) / 2, y: (z.rect.y0 + z.rect.y1) / 2 });
  }
}

/** Functions the flat should have once, counted over the rooms. */
export function flatFunctions(ctxs: RoomCtx[]): { id: string; name: string; rooms: { ctx: RoomCtx; items: RItem[] }[] }[] {
  const defs: { id: string; name: string; pick: (c: RoomCtx) => RItem[] }[] = [
    { id: 'dining', name: 'Esstisch', pick: (c) => (c.type === 'balcony' ? [] : c.placed.filter((i) => isDiningTable(i) && c.items.filter((s) => s.role === 'seat' && dist(s, i) < 1.5).length >= 2)) },
    { id: 'guest', name: 'Gästeschlafplatz', pick: (c) => (['bedroom', 'kids'].includes(c.type) ? [] : c.placed.filter((i) => i.role === 'bed' || /schlafsofa/i.test(c.label(i)))) },
    { id: 'kitchen', name: 'Küchenzeile', pick: (c) => c.items.filter((i) => i.kitchen === 'sink') },
    { id: 'tv', name: 'Fernseher', pick: (c) => c.placed.filter((i) => i.role === 'tv') },
  ];
  return defs.map((d) => ({ id: d.id, name: d.name, rooms: ctxs.map((c) => ({ ctx: c, items: d.pick(c) })).filter((r) => r.items.length) }));
}

/** A2 (M): a function twice in the flat without a reason. */
export function checkDoubles(ctxs: RoomCtx[]): import('../types').Finding[] {
  const out: import('../types').Finding[] = [];
  for (const f of flatFunctions(ctxs)) {
    const allowed = ctxs.some((c) => c.options.allowDouble?.includes(f.id));
    const count = f.rooms.reduce((n, r) => n + r.items.length, 0);
    if (count < 2 || allowed) continue;
    const names = f.rooms.map((r) => r.ctx.an.name).join(' und ');
    const first = f.rooms[0].items[0];
    out.push({
      rule: 'A2',
      severity: 'M',
      roomId: null,
      items: f.rooms.flatMap((r) => r.items.map((i) => i.id)),
      text: `${f.name} gibt es in der Wohnung doppelt (${names}), ohne dass es dafür einen Grund gibt.`,
      where: { x: first.x, y: first.y },
    });
  }
  return out;
}
