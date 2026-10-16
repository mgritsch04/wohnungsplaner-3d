/**
 * Room proposals for recognised floor plans: every closed area enclosed by the
 * proposed walls becomes a room candidate that the user confirms in the review.
 * Uses the same topology code as the editor (insertWall + detectFaces), so a
 * proposal corresponds to the face that `applyDraft` will find later.
 */
import { createEmptyProject } from '../model/factory';
import { computeRoomGeometry } from '../model/geometry/rooms';
import { buildIndex } from '../model/graph';
import { newId } from '../model/ids';
import { insertWall } from '../model/operations';
import { detectFaces } from '../model/roomDetection';
import type { Project } from '../model/schema';
import { closestPointOnSegment, pointInPolygon, polygonCentroid, type Vec2 } from '../model/vec';
import type { DraftRoom, DraftWall, ReconstructionDraft } from './draft';

/** A text snippet from the source with its position in plan metres. */
export interface PlacedText {
  str: string;
  x: number;
  y: number;
}

export interface RoomProposalOptions {
  /** Faces smaller than this (m²) are ignored (gaps between double walls, shafts drawn as walls). */
  minArea?: number;
  /** Faces smaller than this (m²) are proposed as uncertain and not preselected. */
  uncertainBelow?: number;
  /** Texts of the source plan (e.g. PDF text layer) to take room names/areas from. */
  texts?: PlacedText[];
}

/** Common German room names – only texts containing one of these are used as a name. */
const ROOM_WORDS =
  /(wohn|schlaf|kind|küche|kueche|koch|bad|wc|dusche|flur|diele|gang|abstell|zimmer|büro|buero|arbeit|ess|gäste|gaeste|hwr|hauswirtschaft|technik|keller|balkon|loggia|terrasse|garderobe|ankleide|speis|vorraum|windfang|treppe|lager|studio|eltern)/i;
const NAME_TEXT = /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .\-/+&]{1,39}$/;
const AREA_TEXT = /(\d{1,3}(?:[.,]\d{1,2})?)\s*m(?:²|2)(?![0-9a-z])/i;

function distanceToEdges(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]).distance);
  return d;
}

/** A point well inside a polygon (centroid if suitable, otherwise the best grid sample). */
export function interiorPoint(poly: Vec2[]): Vec2 {
  const c = polygonCentroid(poly);
  const centroidD = pointInPolygon(c, poly) ? distanceToEdges(c, poly) : -Infinity;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const N = 24;
  let gridBest: Vec2 | null = null;
  let gridD = -Infinity;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p = { x: minX + ((maxX - minX) * i) / N, y: minY + ((maxY - minY) * j) / N };
      if (!pointInPolygon(p, poly)) continue;
      const d = distanceToEdges(p, poly);
      if (d > gridD) {
        gridD = d;
        gridBest = p;
      }
    }
  }
  // prefer the centroid unless it is outside or clearly worse than the best sample
  return gridBest && gridD > centroidD * 1.25 ? gridBest : c;
}

/** Parse "12,34 m²" / "12.3 m2" → 12.34. */
export function parseAreaText(s: string): number | null {
  const m = AREA_TEXT.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return v > 0 && v < 1000 ? v : null;
}

/** Propose rooms for all closed areas of the accepted draft walls. */
export function proposeRooms(walls: DraftWall[], opts: RoomProposalOptions = {}): DraftRoom[] {
  const minArea = opts.minArea ?? 0.5;
  const uncertainBelow = opts.uncertainBelow ?? 2;
  const d = createEmptyProject();
  for (const w of walls) {
    if (!w.accepted) continue;
    insertWall(d, w.a, w.b, { thickness: w.thickness, height: w.height });
  }
  const faces = detectFaces(d);
  const index = buildIndex(d);
  const candidates = faces
    .map((f, i) => {
      const g = computeRoomGeometry({ id: `face${i}`, name: '', nodeIds: f.nodeIds }, index);
      return g ? { face: f, g } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.g.area >= minArea)
    // left-to-right, top-to-bottom numbering
    .sort((p, q) => p.g.centroid.y - q.g.centroid.y || p.g.centroid.x - q.g.centroid.x);
  const usedNames = new Map<string, number>();
  return candidates.map(({ g }, i) => {
    const inside = (opts.texts ?? []).filter((t) => pointInPolygon(t, g.interior));
    const named = inside.map((t) => t.str.trim()).find((s) => NAME_TEXT.test(s) && ROOM_WORDS.test(s));
    let name = named ?? `Raum ${i + 1}`;
    if (named) {
      const n = (usedNames.get(named) ?? 0) + 1;
      usedNames.set(named, n);
      if (n > 1) name = `${named} ${n}`;
    }
    const statedArea = inside.map((t) => parseAreaText(t.str)).find((v): v is number => v !== null);
    const uncertain = g.area < uncertainBelow;
    return {
      id: newId('drm'),
      name,
      labelPoint: interiorPoint(g.interior),
      statedArea,
      area: Math.round(g.area * 100) / 100,
      status: uncertain ? 'uncertain' : 'estimated',
      accepted: !uncertain,
    } satisfies DraftRoom;
  });
}

/**
 * Proposed rooms whose label point lies inside a room that already exists in
 * the project. Applying them in "merge" mode would rename that room, so they
 * are left out (the existing room is kept).
 */
export function roomsInsideExistingRooms(draft: ReconstructionDraft, project: Pick<Project, 'nodes' | 'walls' | 'openings' | 'rooms'>): string[] {
  if (draft.mode !== 'merge' || project.rooms.length === 0) return [];
  const index = buildIndex(project);
  const polys = project.rooms.map((r) => computeRoomGeometry(r, index)?.centerline ?? []).filter((p) => p.length >= 3);
  return draft.rooms.filter((r) => r.accepted && polys.some((p) => pointInPolygon(r.labelPoint, p))).map((r) => r.id);
}
