/**
 * IKEA planner designs (PAX & other "StorageOne" planners) → planner project.
 *
 * Observed 2026-10-16 (IKEA Austria, PAX planner, anonymous design): when the user
 * opens the summary, the planner stores the design under a short code ("Planungscode",
 * e.g. 343J5TD) via IKEA's DEXF service. The stored JSON contains
 *   - `itemList.item[]`            sellable articles + quantities
 *   - `icf.content.articles[]`     every article with `dimensions` (mm, x = width,
 *                                  y = height, z = depth), `transform.position`
 *                                  (mm, centre of the article, y up) and
 *                                  `transform.rotation` (degrees around y);
 *                                  `parent_ids` link fittings to their frame
 *   - `configuration.content.entities[]`  scene graph incl. the room: floor corners
 *                                  (`kv-corner`, mm) referenced by the floor surface,
 *                                  ceiling corners (y = room height)
 * The app never calls that service (it needs IKEA's own application key). The user
 * provides the JSON of THEIR design themselves (see docs/PLANNER_IMPORT_RESEARCH.md).
 */
import { offsetPolygon, signedArea, type Vec2 } from '../../model/vec';
import { formatArticle, ikeaProductUrl } from './ikeaList';

type Json = Record<string, unknown>;

export interface IkeaPlannedItem {
  itemNo: string;
  itemType: string;
  category: string;
  /** metres */
  width: number;
  depth: number;
  height: number;
  /** plan position of the centre (metres) and floor clearance */
  x: number;
  y: number;
  elevation: number;
  /** plan rotation (radians, app convention) */
  rotation: number;
  /** fittings mounted in this article (shelves, rails, doors …), by category */
  fittings: Record<string, number>;
  /** the same fittings by article number (8 digits) → count; only those that carry a valid number */
  fittingArticles: Record<string, number>;
}

export interface IkeaPlan {
  code: string | null;
  application: string | null;
  room: { corners: Vec2[]; height: number } | null;
  items: IkeaPlannedItem[];
  itemList: { itemNo: string; itemType: string; quantity: number }[];
  warnings: string[];
}

export class IkeaPlanError extends Error {}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Accepts the stored design (GET response), the save request body, or the ICF block alone. */
export function parseIkeaPlannerJson(text: string): IkeaPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new IkeaPlanError(`Kein gültiges JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
  const root = obj(raw);
  const icf = obj(obj(root.icf).content ?? (root.articles ? root : root.content));
  const articles = arr(icf.articles).map(obj);
  if (!articles.length) throw new IkeaPlanError('Keine IKEA-Planungsdaten gefunden (erwartet: „icf.content.articles“ aus einer gespeicherten Planung).');
  const warnings: string[] = [];

  const byId = new Map(articles.map((a) => [num(a.id, NaN), a]));
  const items: IkeaPlannedItem[] = [];
  for (const a of articles) {
    if (arr(a.parent_ids).length) continue; // fittings: counted on their frame
    const dim = obj(a.dimensions);
    const t = obj(a.transform);
    const p = obj(t.position);
    const rotY = num(obj(t.rotation).y);
    const [itemType, itemNo] = String(a.product_id ?? '').split('-');
    if (!/^\d{8}$/.test(itemNo ?? '')) {
      warnings.push(`Artikel ohne gültige Nummer übersprungen (${String(a.product_id)}).`);
      continue;
    }
    const width = num(dim.x) / 1000;
    const height = num(dim.y) / 1000;
    const depth = num(dim.z) / 1000;
    if (!(width > 0 && height > 0 && depth > 0)) {
      warnings.push(`${formatArticle({ digits: itemNo, combination: false })}: keine Maße – übersprungen.`);
      continue;
    }
    const fittings: Record<string, number> = {};
    const fittingArticles: Record<string, number> = {};
    const visit = (ids: unknown[], depthLeft: number) => {
      for (const id of ids) {
        const c = byId.get(num(id, NaN));
        if (!c || depthLeft <= 0) continue;
        const cat = String(c.category ?? 'Zubehör');
        fittings[cat] = (fittings[cat] ?? 0) + 1;
        const fitNo = String(c.product_id ?? '').split('-')[1] ?? '';
        if (/^\d{8}$/.test(fitNo)) fittingArticles[fitNo] = (fittingArticles[fitNo] ?? 0) + 1;
        visit(arr(c.child_ids), depthLeft - 1);
      }
    };
    visit(arr(a.child_ids), 4);
    items.push({
      itemNo,
      itemType: itemType || 'ART',
      category: String(a.category ?? ''),
      width,
      depth,
      height,
      x: num(p.x) / 1000,
      y: num(p.z) / 1000,
      elevation: Math.max(0, Math.round((num(p.y) / 1000 - height / 2) * 1000) / 1000),
      // IKEA: degrees around +y (three.js convention); app: plan rotation = −rotation.y
      rotation: -((((rotY % 360) + 360) % 360) * Math.PI) / 180,
      fittings,
      fittingArticles,
    });
  }

  const itemList = arr(obj(root.itemList).item)
    .map(obj)
    .map((i) => ({ itemNo: String(i.itemNo ?? ''), itemType: String(i.itemType ?? 'ART'), quantity: num(i.quantity, 1) }))
    .filter((i) => /^\d{8}$/.test(i.itemNo));

  return {
    code: typeof root.configurationId === 'string' ? root.configurationId : null,
    application: String(root.application ?? icf.application_id ?? '') || null,
    room: readRoom(obj(obj(root.configuration).content), warnings),
    items,
    itemList,
    warnings,
  };
}

function readRoom(content: Json, warnings: string[]): IkeaPlan['room'] {
  const ents = arr(content.entities).map(obj);
  if (!ents.length) {
    warnings.push('Keine Raumdaten enthalten – nur die Möbel werden übernommen.');
    return null;
  }
  const comp = (e: Json) => obj(e.c);
  const byKvId = new Map(ents.map((e) => [String(obj(comp(e)['kv-id']).id ?? ''), e]));
  const floor = ents.find((e) => 'kv-floor' in comp(e));
  const ids = arr(obj(comp(floor ?? {})['kv-surface']).cornerPersistentIds).map(String);
  const pos = (e: Json | undefined) => obj(obj(comp(e ?? {}).WorldTransformComponent).p);
  const corners = ids.map((id) => byKvId.get(id)).filter((e): e is Json => !!e).map((e) => ({ x: num(pos(e).x) / 1000, y: num(pos(e).z) / 1000 }));
  if (corners.length < 3 || Math.abs(signedArea(corners)) < 0.5) {
    warnings.push('Raumform nicht lesbar – nur die Möbel werden übernommen.');
    return null;
  }
  const ceiling = ents.find((e) => String(obj(comp(e)['kv-id']).id ?? '').startsWith('ceiling-corner'));
  const height = num(pos(ceiling).y, 2500) / 1000;
  return { corners, height };
}

const CATEGORY_NAMES: [RegExp, string][] = [
  [/pax-.*frame/, 'PAX Korpus'],
  [/pax-corner/, 'PAX Eckelement'],
  [/door/, 'Tür'],
  [/frame/, 'Korpus'],
];

const label = (category: string) => CATEGORY_NAMES.find(([re]) => re.test(category))?.[1] ?? (category || 'IKEA-Artikel');

/** Readable German summary of the fittings of one item. */
const FITTING_NAMES: Record<string, string> = {
  'pax-shelf': 'Boden',
  'pax-drawer': 'Schublade',
  'pax-pull-out-tray': 'Auszugboden',
  'pax-pull-out-trouser-hanger': 'Hosenaufhängung',
  'pax-l-divider': 'Einsatz',
  'pax-corner-addon-with-shelves': 'Eckeinsatz mit Böden',
};
const fittingName = (k: string) => FITTING_NAMES[k] ?? (/cloth-rail/.test(k) ? 'Kleiderstange' : /door/.test(k) ? 'Tür' : /handle|knob/.test(k) ? 'Griff' : k.replace(/^pax-/, '').replace(/-/g, ' '));
export function describeFittings(f: Record<string, number>): string {
  return Object.entries(f)
    .map(([k, n]) => `${n}× ${fittingName(k)}`)
    .join(', ');
}

export interface PlanPlacement {
  /** wall centre-line polygon (metres, app plan coordinates) */
  centerline: Vec2[] | null;
  height: number;
  furniture: {
    name: string;
    articleNumber: string;
    productUrl: string;
    description: string;
    width: number;
    depth: number;
    height: number;
    x: number;
    y: number;
    elevation: number;
    rotation: number;
  }[];
}

/**
 * Place the plan at `origin` (top-left of the room interior). Walls get
 * `wallThickness`; the interior keeps IKEA's clear room size.
 */
export function placeIkeaPlan(plan: IkeaPlan, origin: Vec2, wallThickness: number): PlanPlacement {
  const xs = plan.room ? plan.room.corners.map((c) => c.x) : plan.items.map((i) => i.x);
  const ys = plan.room ? plan.room.corners.map((c) => c.y) : plan.items.map((i) => i.y);
  const dx = origin.x - Math.min(...xs);
  const dy = origin.y - Math.min(...ys);
  const shift = (p: Vec2) => ({ x: Math.round((p.x + dx) * 1000) / 1000, y: Math.round((p.y + dy) * 1000) / 1000 });
  return {
    centerline: plan.room ? offsetPolygon(plan.room.corners.map(shift), wallThickness / 2) : null,
    height: plan.room?.height ?? 2.5,
    furniture: plan.items.map((i) => {
      const p = shift(i);
      const art = formatArticle({ digits: i.itemNo, combination: i.itemType === 'SPR' });
      const fit = describeFittings(i.fittings);
      return {
        name: `${label(i.category)} ${art}${fit ? ` (${fit})` : ''}`,
        articleNumber: art,
        productUrl: ikeaProductUrl({ digits: i.itemNo, combination: i.itemType === 'SPR' }),
        description: `Aus IKEA-Planer${plan.code ? ` (Planungscode ${plan.code})` : ''}${fit ? ` · enthält: ${fit}` : ''}`,
        width: i.width,
        depth: i.depth,
        height: i.height,
        x: p.x,
        y: p.y,
        elevation: i.elevation,
        rotation: i.rotation,
      };
    }),
  };
}
