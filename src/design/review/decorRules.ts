/** D Deko, Licht, Textil (#441): plants, lamps, rugs, pictures, curtains. */
import { findCatalogItem } from '../../catalog/generic';
import { dist, dot, sub, type Vec2 } from '../../model/vec';
import type { RoomCtx } from './context';
import { boundaryDist, cm, overlaps, pointPolyDist, polyDist, segmentDist, toLocal } from './geom';
import { isDiningTable, isLamp, isPlant, type RItem } from './items';

/** D1, D2: plants and small things on the floor. */
export function checkPlants(ctx: RoomCtx): void {
  const walkLines = ctx.an.walkways;
  for (const p of ctx.items.filter((i) => isPlant(i) && !i.existing)) {
    if (p.elevation >= 0.05) continue;
    if (p.height <= 0.6) {
      ctx.add('D2', 'M', `${ctx.label(p)} steht auf dem Boden, kleine Pflanzen gehören auf Fensterbank, Regal oder Arbeitsplatte.`, [p], p);
      continue;
    }
    const inCorner = ctx.an.corners.some((c) => !c.reflex && dist(c.p, p) < 0.7);
    const beside = ctx.items.some((o) => o !== p && o.floor && !isPlant(o) && !isLamp(o) && o.role !== 'seat' && polyDist(o.poly, p.poly) < 0.35);
    const atWindow = ctx.windows.some((w) => dist(w.mid, p) < 1.0 || pointPolyDist(p, w.strip) < 0.5);
    if (!inCorner && !beside && !atWindow) ctx.add('D1', 'M', `${ctx.label(p)} steht frei im Raum, Pflanzen gehören in eine Ecke, neben ein Möbel oder ans Fenster.`, [p], p);
    const onWay = walkLines.find((w) => w.path.length > 1 && Math.min(...w.path.slice(1).map((q, k) => segmentDist(p, w.path[k], q))) < p.width / 2 + 0.25);
    if (onWay) ctx.add('D1', 'S', `${ctx.label(p)} steht im Weg zwischen den Türen ${onWay.from} und ${onWay.to}.`, [p], p);
    if (!ctx.windows.length && p.height >= 1.0) ctx.add('D1', 'L', `${ctx.label(p)} bekommt hier kein Tageslicht, besser eine Schattenpflanze oder eine Kunstpflanze.`, [p], p);
  }
  for (const b of ctx.placed.filter((i) => i.role === 'box' && i.elevation < 0.05 && !i.parent))
    if (!ctx.items.some((o) => o !== b && o.floor && o.height > 0.45 && overlaps(b.poly, o.poly, -0.2)))
      ctx.add('D2', 'M', `${ctx.label(b)} steht lose auf dem Boden, besser ins Regal oder unter den Tisch.`, [b], b);
}

/** D3, D4: lamps and light. */
export function checkLight(ctx: RoomCtx): void {
  for (const l of ctx.items.filter((i) => i.role === 'table-lamp')) {
    const base = ctx.supportOf(l);
    const ok = base && (base.role === 'nightstand' || base.role === 'side-table' || base.category === 'desk' || (base.category === 'storage' && base.role !== 'box') || base.role === 'tv-board');
    if (!ok) ctx.add('D3', 'M', base ? `${ctx.label(l)} steht auf ${ctx.label(base)}, dort stört sie. Eine Tischlampe gehört auf Nachttisch, Sideboard, Kommode, Schreibtisch oder Regal.` : `${ctx.label(l)} steht frei, ohne Ablage darunter.`, [l], l);
  }
  const lights = ctx.items.filter(isLamp);
  const nearLight = (p: Vec2, r: number) => lights.some((l) => dist(l, p) < r);
  for (const d of ctx.items.filter((i) => i.category === 'desk' && i.floor))
    if (!nearLight(d, 1.6)) ctx.add('D4', 'L', 'Am Schreibtisch fehlt eine Lampe.', [d], d);
  // outside there is daylight and no ceiling for a pendant
  if (ctx.type === 'balcony') return;
  if (!ctx.items.some((i) => i.role === 'pendant'))
    for (const t of ctx.items.filter((i) => isDiningTable(i) && i.floor)) if (ctx.items.filter((s) => s.role === 'seat' && dist(s, t) < 1.5).length >= 2) ctx.add('D4', 'L', 'Über dem Esstisch fehlt eine Pendelleuchte.', [t], t);
  // reading light where one sits in the evening: floor or table lamp beside the sofa (#443)
  for (const s of ctx.items.filter((i) => i.role === 'sofa' && i.floor && !i.existing))
    if (!lights.some((l) => l.role !== 'pendant' && polyDist(l.poly, s.poly) < 0.8)) ctx.add('D4', 'L', `Neben ${ctx.label(s)} fehlt eine Steh- oder Tischlampe zum Lesen.`, [s], s);
  for (const z of ctx.program?.zones ?? []) {
    if (!/lese|lesen/i.test(z.function)) continue;
    const c = { x: (z.rect.x0 + z.rect.x1) / 2, y: (z.rect.y0 + z.rect.y1) / 2 };
    if (!nearLight(c, 1.8)) ctx.add('D4', 'L', `Die ${z.function} hat keine Lampe zum Lesen.`, [], c);
  }
  if (ctx.an.area > 10 && !['hall', 'bath', 'utility', 'balcony'].includes(ctx.type) && lights.length < 2)
    ctx.add('D4', 'L', `Der Raum hat ${ctx.an.area.toFixed(0)} m² und ${lights.length === 1 ? 'nur eine Lichtquelle' : 'keine Lichtquelle'}, abends wird er ungemütlich.`, [], ctx.an.polygon[0]);
}

/** D5: rugs. */
export function checkRugs(ctx: RoomCtx): void {
  const rugs = ctx.items.filter((i) => i.role === 'rug');
  // two rugs on top of each other: one too many (W6)
  for (const [k, r] of rugs.entries())
    for (const q of rugs.slice(k + 1))
      if (dist(r, q) < Math.min(r.width, r.depth, q.width, q.depth) / 2) ctx.add('D5', 'M', `${ctx.label(r)} und ${ctx.label(q)} liegen übereinander, ein Teppich reicht.`, [r, q], r);
  for (const r of rugs) {
    for (const d of ctx.doors) if (d.swing && overlaps(d.swing, r.poly, 1e-3) && r.height > 0.005) ctx.add('D5', 'L', `${ctx.label(r)} liegt im Aufschwung der Tür ${d.label} und bleibt hängen.`, [r], r);
    const sofa = ctx.items.filter((s) => s.role === 'sofa' && s.floor && polyDist(r.poly, s.poly) < 1.5).sort((p, q) => polyDist(r.poly, p.poly) - polyDist(r.poly, q.poly))[0];
    const groupRug = ctx.items.some((t) => t.role === 'coffee-table' && overlaps(r.poly, t.poly, -0.05));
    if (sofa && groupRug) {
      const front = { x: sofa.x + sofa.front.x * (sofa.depth / 2 - 0.1), y: sofa.y + sofa.front.y * (sofa.depth / 2 - 0.1) };
      const loc = toLocal(r, front);
      if (Math.abs(loc.u) > r.width / 2 || Math.abs(loc.v) > r.depth / 2) ctx.add('D5', 'L', `${ctx.label(sofa)} steht nicht mit den Vorderfüßen auf ${ctx.label(r)}.`, [r, sofa], r);
    }
    const bed = ctx.items.find((b) => b.shape === 'bed' && b.floor && overlaps(r.poly, b.poly, 0.15));
    if (bed) {
      const corners = r.poly.map((c) => toLocal(bed, c).u);
      const left = -Math.min(...corners) - bed.width / 2;
      const right = Math.max(...corners) - bed.width / 2;
      if (Math.min(left, right) < 0.4 - 0.01) ctx.add('D5', 'L', `${ctx.label(r)} ragt neben dem Bett nur ${cm(Math.max(0, Math.min(left, right)))} cm heraus, besser sind 40 cm auf beiden Seiten.`, [r, bed], r);
    }
    if (ctx.type === 'hall' && r.width < 1.0 && r.depth >= 1.5) {
      const reach = (dir: Vec2) => {
        let t = 0;
        while (t < 3 && ctx.inRoom({ x: r.x + dir.x * t, y: r.y + dir.y * t })) t += 0.02;
        return t;
      };
      const left = reach({ x: -r.right.x, y: -r.right.y });
      const right = reach(r.right);
      if (Math.abs(left - right) > 0.2) ctx.add('D5', 'L', `${ctx.label(r)} liegt nicht in der Mitte des Gangs.`, [r], r);
    }
  }
}

/** D6: pictures and mirrors. */
export function checkPictures(ctx: RoomCtx): void {
  for (const p of ctx.items.filter((i) => i.role === 'wall-art' || i.role === 'mirror')) {
    if (p.shape === 'wall-shelf') continue;
    for (const w of ctx.windows) if (overlaps(w.strip, p.poly, 1e-3) && p.elevation + p.height > w.sill) ctx.add('D6', 'L', `${ctx.label(p)} hängt über dem Fenster ${w.label}.`, [p], p);
    for (const d of ctx.doors) if (Math.abs(dot(sub(p, d.mid), d.wall.dir)) < d.width / 2 && dot(sub(p, d.mid), d.wall.inward) < 0.3) ctx.add('D6', 'L', `${ctx.label(p)} hängt über der Tür ${d.label}.`, [p], p);
    const under = ctx.parentOf(p) ?? ctx.items.filter((o) => (o.role === 'sofa' || o.shape === 'bed') && o.floor && pointPolyDist(p, o.poly) < 0.25 && Math.abs(toLocal(o, p).u) < o.width / 2 + 0.1).sort((a, b) => dist(a, p) - dist(b, p))[0];
    if (under && (under.role === 'sofa' || under.shape === 'bed')) {
      const off = Math.abs(toLocal(under, p).u);
      const ratio = p.width / under.width;
      if (off > 0.1) ctx.add('D6', 'L', `${ctx.label(p)} hängt ${cm(off)} cm neben der Mitte von ${ctx.label(under)}.`, [p, under], p);
      if (ratio < 0.4 || ratio > 0.9) ctx.add('D6', 'L', `${ctx.label(p)} ist ${ratio < 0.4 ? 'zu klein' : 'zu breit'} für ${ctx.label(under)}, schön sind 40 bis 90 % der Breite.`, [p, under], p);
    }
    if (ctx.type === 'bath' && p.role === 'mirror') {
      const basin = ctx.items.filter((o) => o.shape === 'washbasin').sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (basin && Math.abs(toLocal(basin, p).u) > 0.3) ctx.add('D6', 'L', 'Der Badspiegel hängt nicht über dem Waschtisch.', [p, basin], p);
    }
  }
}

/** D7: curtains. */
export function checkCurtains(ctx: RoomCtx): void {
  const curtains = ctx.items.filter((i) => i.role === 'curtain');
  for (const w of ctx.windows) {
    const mine = curtains.filter((c) => c.elevation < 1 && boundaryDist(c, ctx.an.polygon) < 0.4 && pointPolyDist(c, w.strip) < 0.5 && ctx.nearestWindow(c) === w);
    if (!mine.length) continue;
    // open curtains hang gathered beside the frame: what counts is the fabric, as the catalogue gives it
    const total = mine.reduce((s, c) => s + (findCatalogItem(c.catalogId, ctx.catalog)?.width ?? c.width), 0);
    if (total < w.width - 0.05) ctx.add('D7', 'L', `Der Vorhang am Fenster ${w.label} ist mit ${cm(total)} cm schmaler als das Fenster (${cm(w.width)} cm).`, mine, mine[0]);
    else if (mine.length === 1 && w.width >= 0.8) ctx.add('D7', 'L', `Am Fenster ${w.label} hängt nur ein Vorhangschal auf einer Seite, ein Paar links und rechts rahmt das Fenster.`, mine, mine[0]);
  }
  if (ctx.options.darkening && ctx.type === 'bedroom' && ctx.windows.length && !curtains.length) ctx.add('D7', 'L', 'Das Schlafzimmer hat keine Verdunkelung, gewünscht ist ein dunkler Raum.', [], ctx.windows[0].mid);
}

/** D8: too much of the same. */
export function checkRepeats(ctx: RoomCtx): void {
  const pendants = ctx.items.filter((i) => i.role === 'pendant');
  if (ctx.type === 'hall' && pendants.length >= 2 && pendants.length > ctx.an.area / 6) ctx.add('D8', 'L', `Im Gang hängen ${pendants.length} Deckenleuchten, mehr als eine je 6 m² wirkt überladen.`, pendants, pendants[0]);
  const pics = ctx.items.filter((i) => i.shape === 'picture');
  const grouped = (ctx.program?.relations ?? []).some((r) => r.kind === 'align' && pics.filter((p) => r.items.includes(p.id)).length >= 3);
  if (pics.length > 3 && !grouped) ctx.add('D8', 'L', `${pics.length} Bilder verteilen sich im Raum ohne Ordnung, besser eine Bildergruppe planen.`, pics, pics[0]);
  const byId = new Map<string, RItem[]>();
  for (const i of ctx.placed) if (i.floor && ['storage', 'decor', 'lighting'].includes(i.category) && i.role !== 'box' && !isPlant(i) && !i.kitchen) byId.set(i.catalogId, [...(byId.get(i.catalogId) ?? []), i]);
  for (const list of byId.values()) {
    if (list.length < 3) continue;
    const related = (ctx.program?.relations ?? []).some((r) => (r.kind === 'align' || r.kind === 'around') && list.filter((i) => ('items' in r ? r.items : []).includes(i.id)).length >= 2);
    if (!related) ctx.add('D8', 'L', `${list.length}× ${ctx.label(list[0])} stehen ohne erkennbare Ordnung im Raum.`, list, list[0]);
  }
}
