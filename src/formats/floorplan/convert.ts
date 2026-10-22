import { derivePlan } from '../../model/derived';
import { newId } from '../../model/ids';
import { addOpening, closestWall, insertWall } from '../../model/operations';
import { faceAtPoint, sameCycle } from '../../model/roomDetection';
import type { Project } from '../../model/schema';
import { degToRad, radToDeg, roundMm } from '../../model/units';
import { add, closestPointOnSegment, dist, normalize, polygonCentroid, scale, sub, type Vec2 } from '../../model/vec';

const distToSeg = (p: Vec2, a: Vec2, b: Vec2) => closestPointOnSegment(p, a, b).distance;
import type { DraftOpening, DraftRoom, DraftWall, ReconstructionDraft } from '../../import/draft';
import { FileFormatError, formatZodError } from '../zodErrors';
import { FLOORPLAN_FORMAT, FLOORPLAN_VERSION, FloorPlanSchema, type FloorPlanFile } from './schema';
import { createFurnitureFromCatalog } from '../../catalog/instantiate';
import { findCatalogItem } from '../../catalog/generic';
import { DEFAULT_FLOOR_MATERIAL_ID } from '../../model/materials';
import { buildIndex } from '../../model/graph';

const DEFAULT_THICKNESS = 0.12;
const DEFAULT_HEIGHT = 2.6;

/** Parse an apartment-plan.json text into a validated object (throws FileFormatError). */
export function parseFloorPlanJson(text: string): FloorPlanFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FileFormatError('Die Datei ist kein gültiges JSON.', [e instanceof Error ? e.message : String(e)]);
  }
  return parseFloorPlan(raw);
}

export function parseFloorPlan(raw: unknown): FloorPlanFile {
  if (!raw || typeof raw !== 'object') throw new FileFormatError('Kein Grundriss-Objekt gefunden.');
  const obj = raw as Record<string, unknown>;
  if (obj.format === 'wohnungsplaner-project' || obj.format === 'wohnungsplaner-package') {
    throw new FileFormatError('Dies ist eine Projektdatei. Bitte über „Projekt importieren“ laden.');
  }
  if (obj.format !== FLOORPLAN_FORMAT) throw new FileFormatError(`Unbekanntes Format – erwartet "format": "${FLOORPLAN_FORMAT}".`);
  if (typeof obj.version === 'number' && obj.version > FLOORPLAN_VERSION) {
    throw new FileFormatError(`Grundriss-Version ${obj.version} wird nicht unterstützt (maximal ${FLOORPLAN_VERSION}).`);
  }
  const res = FloorPlanSchema.safeParse(raw);
  if (!res.success) throw new FileFormatError('Die Grundriss-Datei ist ungültig.', formatZodError(res.error));
  return res.data;
}

/** Convert a parsed floor plan into a review draft (meters, y-down). */
export function floorPlanToDraft(fp: FloorPlanFile, sourceName: string): ReconstructionDraft {
  const k = fp.units === 'cm' ? 0.01 : fp.units === 'mm' ? 0.001 : 1;
  const flip = fp.coordinateSystem.y === 'up' ? -1 : 1;
  const P = (p: Vec2): Vec2 => ({ x: roundMm(p.x * k), y: roundMm(p.y * k * flip) });
  const L = (v: number) => roundMm(v * k);
  const warnings: string[] = [];
  const defT = fp.defaults?.wallThickness ? L(fp.defaults.wallThickness) : DEFAULT_THICKNESS;
  const defH = fp.defaults?.wallHeight ? L(fp.defaults.wallHeight) : DEFAULT_HEIGHT;

  const idMap = new Map<string, string>();
  const walls: DraftWall[] = [];
  fp.walls.forEach((w, i) => {
    const a = P(w.start);
    const b = P(w.end);
    if (dist(a, b) < 0.01) {
      warnings.push(`Wand ${w.id ?? i + 1} hat keine Länge und wurde übersprungen.`);
      return;
    }
    const id = newId('dw');
    if (w.id) idMap.set(w.id, id);
    const thickness = w.thickness ? L(w.thickness) : defT;
    const height = w.height ? L(w.height) : defH;
    if (thickness > 1) warnings.push(`Wand ${w.id ?? i + 1}: Dicke ${thickness} m ist ungewöhnlich – Einheiten prüfen.`);
    walls.push({ id, a, b, thickness, height, status: w.status ?? (w.thickness ? 'confirmed' : 'estimated'), confidence: w.confidence, note: w.note, accepted: true });
  });

  const openings: DraftOpening[] = [];
  fp.openings.forEach((o, i) => {
    let center: Vec2 | null = null;
    let wallId: string | undefined;
    let wallDir: Vec2 | null = null;
    if (o.wall !== undefined && o.offset !== undefined) {
      wallId = idMap.get(o.wall);
      const w = walls.find((x) => x.id === wallId);
      if (!w) {
        warnings.push(`Öffnung ${o.id ?? i + 1} verweist auf unbekannte Wand "${o.wall}".`);
        if (!o.at) return;
      } else {
        wallDir = normalize(sub(w.b, w.a));
        center = add(w.a, scale(wallDir, L(o.offset)));
      }
    }
    if (!center && o.at) center = P(o.at);
    if (!center) return;
    if (!wallDir && walls.length) {
      // hinge/swing refer to the direction of the nearest wall in the file
      const c = center;
      const nearest = walls.reduce((best, w) => (distToSeg(c, w.a, w.b) < distToSeg(c, best.a, best.b) ? w : best), walls[0]);
      wallDir = normalize(sub(nearest.b, nearest.a));
    }
    const dir = wallDir ?? { x: 1, y: 0 };
    const leftNormal = { x: -dir.y, y: dir.x };
    const kind = o.type;
    openings.push({
      id: newId('dop'),
      kind,
      wallId,
      center,
      width: L(o.width),
      height: o.height ? L(o.height) : kind === 'window' ? 1.4 : 2.1,
      sillHeight: o.sillHeight !== undefined ? L(o.sillHeight) : kind === 'window' ? 0.9 : 0,
      hingeSide: scale(dir, (o.hinge ?? 'start') === 'start' ? -1 : 1),
      swingSide: scale(leftNormal, (o.swing ?? 'left') === 'left' ? 1 : -1),
      status: o.status ?? (o.height ? 'confirmed' : 'estimated'),
      confidence: o.confidence,
      note: o.note,
      accepted: true,
    });
  });

  const rooms: DraftRoom[] = fp.rooms.map((r) => {
    const label = r.labelPoint ? P(r.labelPoint) : r.polygon ? polygonCentroid(r.polygon.map(P)) : null;
    if (!label) warnings.push(`Raum „${r.name}“ hat weder labelPoint noch polygon und kann nicht zugeordnet werden.`);
    return {
      id: newId('dr'),
      name: r.name,
      labelPoint: label ?? { x: 0, y: 0 },
      statedArea: r.statedArea !== undefined ? r.statedArea * k * k : undefined,
      floorMaterialId: r.floorMaterial,
      status: r.status ?? 'confirmed',
      accepted: !!label,
    };
  });

  const furniture = fp.furniture.map((f) => ({
    id: newId('item'),
    catalogId: f.catalogId,
    name: f.name,
    category: f.category,
    x: P(f.position).x,
    y: P(f.position).y,
    elevation: L(f.elevation),
    rotation: degToRad(f.rotation) * flip,
    width: L(f.width),
    depth: L(f.depth),
    height: L(f.height),
    color: f.color ?? '#b0a898',
    model: { type: 'procedural' as const, shape: 'box' },
    quantity: 1,
    price: f.price ? { amount: f.price.amount, currency: 'EUR' as const, status: f.price.status } : undefined,
    productUrl: f.productUrl,
    retailer: f.retailer,
    brand: f.brand,
    approximate: true,
    solid: true,
    locked: false,
    existing: false,
  }));

  return {
    source: 'json',
    sourceName,
    scaleConfirmed: true,
    walls,
    openings,
    rooms,
    furniture,
    warnings,
    name: fp.name,
    mode: 'replace',
  };
}

export interface ApplyResult {
  warnings: string[];
  wallsAdded: number;
  openingsAdded: number;
  roomsAdded: number;
  fixturesAdded: number;
}

/** Insert the ACCEPTED draft elements into the project draft (mutates `d`). */
export function applyDraft(d: Project, draft: ReconstructionDraft): ApplyResult {
  const warnings: string[] = [];
  if (draft.mode === 'replace') {
    d.nodes = [];
    d.walls = [];
    d.openings = [];
    d.rooms = [];
  }
  const provenance = (status: DraftWall['status'], confidence?: number) => ({
    source: draft.source === 'json' ? ('imported-json' as const) : ('detected' as const),
    status,
    confidence,
  });
  const before = d.walls.length;
  for (const w of draft.walls) {
    if (!w.accepted) continue;
    insertWall(d, w.a, w.b, { thickness: w.thickness, height: w.height, provenance: provenance(w.status, w.confidence) });
  }
  let openingsAdded = 0;
  for (const o of draft.openings) {
    if (!o.accepted) continue;
    const maxT = Math.max(0.3, ...d.walls.map((w) => w.thickness));
    const hit = closestWall(d, o.center, maxT);
    if (!hit) {
      warnings.push(`${o.kind === 'window' ? 'Fenster' : 'Tür'} bei (${o.center.x.toFixed(2)}, ${o.center.y.toFixed(2)}) liegt auf keiner Wand.`);
      continue;
    }
    const wa = d.nodes.find((n) => n.id === hit.wall.a)!;
    const wb = d.nodes.find((n) => n.id === hit.wall.b)!;
    const wdir = normalize(sub(wb, wa));
    const hinge = o.hingeSide && o.hingeSide.x * wdir.x + o.hingeSide.y * wdir.y > 0 ? 'end' : 'start';
    const swing = o.swingSide && o.swingSide.x * -wdir.y + o.swingSide.y * wdir.x < 0 ? 'right' : 'left';
    const id = addOpening(d, hit.wall.id, o.kind, hit.s, {
      width: o.width,
      height: o.height,
      sillHeight: o.sillHeight,
      hinge,
      swing,
      provenance: provenance(o.status, o.confidence),
    });
    if (id) openingsAdded++;
  }
  let roomsAdded = 0;
  const index = () => derivePlan(d);
  for (const r of draft.rooms) {
    if (!r.accepted) continue;
    const face = faceAtPoint(d, r.labelPoint);
    if (!face) {
      warnings.push(`Raum „${r.name}“: keine geschlossene Wandfläche am Beschriftungspunkt gefunden.`);
      continue;
    }
    const existing = d.rooms.find((x) => sameCycle(x.nodeIds, face.nodeIds));
    if (existing) {
      existing.name = r.name;
      continue;
    }
    const id = newId('room');
    d.rooms.push({
      id,
      name: r.name,
      nodeIds: face.nodeIds,
      floorMaterialId: d.materials.some((m) => m.id === r.floorMaterialId) ? r.floorMaterialId : DEFAULT_FLOOR_MATERIAL_ID,
      provenance: { source: draft.source === 'json' ? 'imported-json' : 'detected', status: r.status },
    });
    roomsAdded++;
    if (r.statedArea) {
      const g = index().rooms.get(id);
      if (g && Math.abs(g.area - r.statedArea) / r.statedArea > 0.05) {
        warnings.push(`Raum „${r.name}“: berechnete Fläche ${g.area.toFixed(2)} m² weicht von angegebener ${r.statedArea.toFixed(2)} m² ab.`);
      }
    }
  }
  for (const f of draft.furniture) d.furniture.push(structuredClone(f));
  let fixturesAdded = 0;
  for (const x of draft.fixtures ?? []) {
    const item = x.accepted ? findCatalogItem(x.catalogId) : undefined;
    if (!item) continue;
    // fitted objects: from the generic catalog (no invented products), measured size, no price
    const f = createFurnitureFromCatalog({ ...item, width: x.width, depth: x.depth, price: undefined }, { x: x.center.x, y: x.center.y, rotation: x.rotation });
    d.furniture.push({ ...f, existing: true });
    fixturesAdded++;
  }
  return { warnings, wallsAdded: d.walls.length - before, openingsAdded, roomsAdded, fixturesAdded };
}

/** Export the project's architecture (and optionally furniture) as apartment-plan.json. */
export function projectToFloorPlan(p: Project, opts: { includeFurniture?: boolean } = {}): FloorPlanFile {
  const index = buildIndex(p);
  const derived = derivePlan(p);
  const walls = p.walls.map((w) => {
    const a = index.nodes.get(w.a)!;
    const b = index.nodes.get(w.b)!;
    return {
      id: w.id,
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      thickness: w.thickness,
      height: w.height,
      status: w.provenance?.status ?? 'confirmed',
      ...(w.provenance?.confidence !== undefined ? { confidence: w.provenance.confidence } : {}),
    };
  });
  const openings = p.openings.map((o) => ({
    id: o.id,
    type: o.kind,
    wall: o.wallId,
    offset: o.offset,
    width: o.width,
    height: o.height,
    sillHeight: o.sillHeight,
    hinge: o.hinge,
    swing: o.swing,
    status: o.provenance?.status ?? 'confirmed',
  }));
  const rooms = p.rooms.map((r) => {
    const g = derived.rooms.get(r.id);
    return {
      id: r.id,
      name: r.name,
      labelPoint: g ? { x: roundMm(g.centroid.x), y: roundMm(g.centroid.y) } : undefined,
      polygon: g?.interior.map((q) => ({ x: roundMm(q.x), y: roundMm(q.y) })),
      statedArea: g ? Math.round(g.area * 100) / 100 : undefined,
      floorMaterial: r.floorMaterialId,
      status: r.provenance?.status ?? 'confirmed',
    };
  });
  const furniture = opts.includeFurniture
    ? p.furniture.map((f) => ({
        id: f.id,
        catalogId: f.catalogId,
        name: f.name,
        category: f.category,
        position: { x: f.x, y: f.y },
        rotation: Math.round(radToDeg(f.rotation) * 100) / 100,
        width: f.width,
        depth: f.depth,
        height: f.height,
        elevation: f.elevation,
        color: f.color,
        price: f.price ? { amount: f.price.amount, status: f.price.status } : undefined,
        productUrl: f.productUrl,
        retailer: f.retailer,
        brand: f.brand,
      }))
    : [];
  return {
    format: FLOORPLAN_FORMAT,
    version: FLOORPLAN_VERSION,
    units: 'm',
    coordinateSystem: { y: 'down' },
    name: p.name,
    metadata: { exportedBy: 'Wohnungsplaner 3D', exportedAt: new Date().toISOString() },
    defaults: { wallThickness: p.settings.defaultWallThickness, wallHeight: p.settings.defaultWallHeight },
    walls,
    openings,
    rooms,
    furniture,
    sourceDrawing: p.underlay
      ? { fileName: p.underlay.fileName, page: p.underlay.pdfPage, calibrated: p.underlay.calibrated }
      : undefined,
  } as FloorPlanFile;
}
