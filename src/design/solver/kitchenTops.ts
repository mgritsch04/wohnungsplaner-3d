/**
 * Cooktop and hood of a kitchen run (#440). The programme lists only the floor modules
 * (`KitchenRun.modules`), the app adds the rest: the cooktop goes on the oven, else on a base
 * module, where it keeps 60 cm of worktop to the sink, 30 cm beside it free of tall units and
 * walls, and stays out from under a window (A4). The hood hangs above it unless a window is there.
 */
import { add, pointInPolygon, scale } from '../../model/vec';
import type { PlacedItem } from '../types';
import { wrapAngle } from './geom';
import { specOf } from './items';
import type { Model, Node, Unit } from './model';
import { alongWall, boxOnWall } from './room';

const COOKTOP = 'generic-k-cooktop';
const HOOD = 'generic-k-hood-60';

const typeOf = (n: Node) => n.spec.item.kitchen?.type ?? '';

/** Cooktop and hood for one kitchen unit (none when no module can carry the cooktop). */
export function kitchenTops(m: Model, u: Unit): PlacedItem[] {
  const k = u.kitchen;
  if (!k || !u.active) return [];
  const ctx = m.ctx;
  const w = ctx.walls[k.wall];
  const mods = u.nodes.filter((n) => n.run !== undefined).sort((a, b) => alongWall(w, a.box) - alongWall(w, b.box));
  if (mods.some((n) => typeOf(n) === 'cooktop')) return [];
  const span = (n: Node) => {
    const t = alongWall(w, n.box);
    return { t, lo: t - n.spec.width / 2, hi: t + n.spec.width / 2 };
  };
  const gap = (a: Node, b: Node) => {
    const p = span(a);
    const q = span(b);
    return Math.max(q.lo - p.hi, p.lo - q.hi, 0);
  };
  const sink = mods.find((n) => typeOf(n) === 'sink');
  const windows = w.openings.filter((o) => o.kind === 'window');
  const score = (h: Node): number => {
    const s = span(h);
    let sc = typeOf(h) === 'oven' ? 0 : 1;
    if (sink && gap(h, sink) < 0.59) sc += 2;
    const tall = mods.some((x) => x !== h && (typeOf(x) === 'tall' || typeOf(x) === 'fridge') && gap(h, x) < 0.29);
    const side = [-1, 1].some((d) => !pointInPolygon(add(h.box, scale(w.dir, d * (h.spec.width / 2 + 0.29))), ctx.poly));
    if (tall || side) sc += 1;
    if (windows.some((o) => o.t0 < s.hi - 0.05 && o.t1 > s.lo + 0.05 && (o.sill ?? 0.9) < 1.4)) sc += 1.5;
    return sc;
  };
  const hosts = mods.filter((n) => typeOf(n) === 'oven' || (typeOf(n) === 'base' && n.spec.width >= 0.59));
  if (!hosts.length) return [];
  const host = hosts.reduce((a, b) => (score(b) < score(a) - 1e-9 ? b : a));
  const cook = specOf(COOKTOP, ctx.catalog)!;
  const t = alongWall(w, host.box);
  const out: PlacedItem[] = [
    {
      id: `${u.id}-cooktop`,
      catalogId: COOKTOP,
      zone: host.zone,
      x: host.box.x,
      y: host.box.y,
      rotation: wrapAngle(host.box.rotation),
      elevation: cook.elevation,
      width: cook.width,
      depth: cook.depth,
      height: cook.height,
      parent: host.id,
      kitchenRun: k.index,
    },
  ];
  const hood = specOf(HOOD, ctx.catalog)!;
  const lo = t - hood.width / 2;
  const hi = t + hood.width / 2;
  const blocked = w.openings.some((o) => o.t0 < hi && o.t1 > lo && (o.kind !== 'window' || ((o.sill ?? 0.9) < hood.elevation + hood.height && (o.top ?? 2.1) > hood.elevation)));
  if (!blocked) {
    const b = boxOnWall(w, t, hood.width, hood.depth, 0.002);
    out.push({
      id: `${u.id}-hood`,
      catalogId: HOOD,
      zone: host.zone,
      x: b.x,
      y: b.y,
      rotation: wrapAngle(b.rotation),
      elevation: hood.elevation,
      width: hood.width,
      depth: hood.depth,
      height: hood.height,
      parent: `${u.id}-cooktop`,
      kitchenRun: k.index,
    });
  }
  return out;
}
