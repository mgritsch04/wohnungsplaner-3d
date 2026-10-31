/**
 * Moving plan (#487)
 * ------------------
 * `buildMovePlan(project)` answers two questions for moving day:
 *  1. In which ORDER do the pieces go in / get set up?
 *  2. Does each piece (or each of its packages, when sizes are entered) get through the stairwell
 *     (or lift) and the doors of the flat to its place?
 *
 * Order: pieces for "moving in" first (later purchases are listed after), storeys far from the
 * entrance first, rooms far from the entrance first (so nothing blocks the way), inside a room
 * built-ins and big pieces first, rugs before the furniture standing on them, small things last.
 *
 * Fit: the door/corridor route is `checkDelivery` (#358). The building access comes from the
 * measurements in `Project.moveAccess` (stairwell width/headroom, turn length, lift); without them the
 * stairwell is reported as "not measured", never as fine. Inside the flat, stairs between storeys
 * are checked by their width only. Everything is an ESTIMATE; turning around corners is not simulated.
 */
import { checkPieceDelivery, CARRY_MARGIN, findEntrance, type DeliveryResult } from './deliveryCheck';
import { derivePlan } from './derived';
import { projectOnLevel, sortedLevels } from './levels';
import type { BuyPhase, Furniture, MoveAccess, Project } from './schema';
import { isStair } from './stairs';
import { parseStairShape } from './stairLayout';
import { pointInPolygon, type Vec2 } from './vec';
import { shortestWalkPath } from './walkPath';

export type FitStatus = 'ok' | 'tight' | 'no' | 'unknown';

export interface PieceCheck {
  /** "Möbel" for a piece carried in one go, else the package's name. */
  label: string;
  dims: { w: number; d: number; h: number };
  status: FitStatus;
  /** Why it is tight / does not fit, one sentence each. */
  messages: string[];
}

export interface MoveStep {
  order: number;
  furnitureId: string;
  name: string;
  quantity: number;
  levelId: string;
  levelName: string;
  roomName: string;
  phase: BuyPhase;
  /** Flat-pack or heavy piece that is assembled on site (bed, wardrobe, shelf, table, kitchen). */
  assembly: boolean;
  pieces: PieceCheck[];
  status: FitStatus;
}

export interface MovePlan {
  steps: MoveStep[];
  /** Pieces with status `no` or `tight`. */
  warnings: number;
  /** No entrance door found on any storey: door checks were skipped. */
  noEntrance: boolean;
  /** Stairwell/lift sizes are missing, so the building access is not checked. */
  accessMissing: boolean;
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;
/** A fit with less than this spare room (including the carry margin) counts as tight. */
const TIGHT = 0.05;

// ---------- order ----------

/** Lower = earlier. Built-ins and big pieces first, light and delicate things last. */
const CATEGORY_RANK: Record<string, number> = {
  kitchen: 0,
  appliance: 0,
  bathroom: 0,
  stairs: 99,
  textile: 1,
  storage: 2,
  bed: 3,
  sofa: 4,
  desk: 5,
  table: 5,
  chair: 6,
  lighting: 8,
  decor: 9,
};
const ASSEMBLED = new Set(['kitchen', 'storage', 'bed', 'desk', 'table']);
const PHASE_RANK: Record<BuyPhase, number> = { movein: 0, month2: 1, later: 2 };

export function categoryRank(category: string): number {
  return CATEGORY_RANK[category] ?? 7;
}

// ---------- building access (stairwell, lift) ----------

export interface AccessResult {
  status: FitStatus;
  messages: string[];
  /** A lift takes the piece, so a failing stairwell does not matter. */
  viaLift: boolean;
}

/** Stairwell and lift check of one piece (pure; sizes in m). `status` is `unknown` when nothing was measured. */
export function checkAccess(dims: { w: number; d: number; h: number }, a: MoveAccess | undefined): AccessResult {
  const [s1, s2, s3] = [dims.w, dims.d, dims.h].sort((x, y) => x - y);
  const m = 2 * CARRY_MARGIN;
  const messages: string[] = [];
  const hasStairs = a?.stairWidth !== undefined && a.stairHeadroom !== undefined;
  const hasLift = a?.liftWidth !== undefined && a.liftDepth !== undefined && a.liftHeight !== undefined;
  if (!a || (!hasStairs && !hasLift)) return { status: 'unknown', messages: [], viaLift: false };

  // lift: dims sorted against cabin sorted – the cabin may be entered in any orientation
  let liftOk = false;
  if (hasLift) {
    const [l1, l2, l3] = [a.liftWidth!, a.liftDepth!, a.liftHeight!].sort((x, y) => x - y);
    liftOk = s1 <= l1 - 0.02 && s2 <= l2 - 0.02 && s3 <= l3 - 0.02;
    if (liftOk) messages.push(`Passt in den Aufzug (${cm(l1)} × ${cm(l2)} × ${cm(l3)}).`);
  }

  let stairStatus: FitStatus = 'unknown';
  const stairMsgs: string[] = [];
  if (hasStairs) {
    const W = a.stairWidth!;
    const H = a.stairHeadroom!;
    // carried lengthwise: the two smaller sizes are the cross-section, either way round
    const a1 = s1 <= W - m && s2 <= H - CARRY_MARGIN;
    const a2 = s2 <= W - m && s1 <= H - CARRY_MARGIN;
    if (!a1 && !a2) {
      stairStatus = 'no';
      stairMsgs.push(`Treppenhaus zu eng: Querschnitt ${cm(s1)} × ${cm(s2)}, Treppenhaus ${cm(W)} breit und ${cm(H)} hoch.`);
    } else {
      const spare = Math.min(W - m - (a1 ? s1 : s2), 1);
      stairStatus = spare < TIGHT ? 'tight' : 'ok';
      if (stairStatus === 'tight') stairMsgs.push(`Treppenhaus knapp: nur ${cm(Math.max(spare, 0))} Luft neben dem Querschnitt.`);
    }
    if (stairStatus !== 'no' && a.turnLength !== undefined && s3 > a.turnLength) {
      stairStatus = 'tight';
      stairMsgs.push(`Länge ${cm(s3)} ist größer als die Kurvenlänge ${cm(a.turnLength)}: kann am Podest klemmen.`);
    }
  }
  if (liftOk) return { status: 'ok', messages, viaLift: true };
  if (hasLift && !hasStairs) return { status: 'no', messages: [`Passt nicht in den Aufzug (${cm(s1)} × ${cm(s2)} × ${cm(s3)}).`], viaLift: false };
  return { status: stairStatus, messages: stairMsgs, viaLift: false };
}

// ---------- the plan ----------

const worst = (a: FitStatus, b: FitStatus): FitStatus => {
  const rank: Record<FitStatus, number> = { ok: 0, unknown: 1, tight: 2, no: 3 };
  return rank[a] >= rank[b] ? a : b;
};

function roomNameAt(derived: ReturnType<typeof derivePlan>, p: Project, at: Vec2): string {
  for (const room of p.rooms) {
    const g = derived.rooms.get(room.id);
    if (g && pointInPolygon(at, g.interior)) return room.name || 'Raum';
  }
  return 'Ohne Raum';
}

function deliveryPiece(r: DeliveryResult): { status: FitStatus; messages: string[] } {
  if (!r.ok) return { status: 'unknown', messages: [r.reason] };
  if (!r.fits) return { status: 'no', messages: [r.message] };
  const messages: string[] = [];
  let status: FitStatus = 'ok';
  if (r.orientation === 'tilted') {
    status = 'tight';
    messages.push('Nur hochkant oder gekippt tragbar.');
  }
  const spare = r.bottleneck?.width !== undefined && r.carry ? r.bottleneck.width - r.carry.w : Infinity;
  if (spare < TIGHT) {
    status = 'tight';
    messages.push(`Knapp: ${r.bottleneck!.label}.`);
  }
  return { status, messages };
}

/** Width of the narrowest straight stair; null when there is none or only turning stairs. */
function stairClearWidth(p: Project): number | null | undefined {
  const stairs: Furniture[] = [];
  for (const l of sortedLevels(p)) stairs.push(...projectOnLevel(p, l.id).furniture.filter(isStair));
  if (!stairs.length) return undefined;
  const widths = stairs.filter((s) => parseStairShape(s.model.type === 'procedural' ? s.model.shape : s.model.fallbackShape)?.kind === 'straight').map((s) => s.width);
  return widths.length ? Math.min(...widths) : null;
}

export function buildMovePlan(project: Project): MovePlan {
  const levels = sortedLevels(project);
  const access = project.moveAccess;
  const accessMissing = !(access && ((access.stairWidth !== undefined && access.stairHeadroom !== undefined) || (access.liftWidth !== undefined && access.liftDepth !== undefined && access.liftHeight !== undefined)));
  const stairW = stairClearWidth(project);

  // entrance storey: the lowest storey with an entrance door
  const views = levels.map((l) => {
    const pj = projectOnLevel(project, l.id);
    const derived = derivePlan(pj);
    return { level: l, pj, derived, entrance: findEntrance(pj, derived) };
  });
  const entranceView = views.find((v) => v.entrance);
  const entranceElevation = entranceView?.level.elevation ?? levels[0]?.elevation ?? 0;

  const cache = new Map<string, { status: FitStatus; messages: string[] }>();
  interface Draft extends Omit<MoveStep, 'order'> {
    sortKey: [number, number, number, number, number, number];
  }
  const drafts: Draft[] = [];

  for (const v of views) {
    const roomDepth = new Map<string, number>();
    for (const f of v.pj.furniture) {
      if (f.existing || isStair(f)) continue;
      const room = roomNameAt(v.derived, v.pj, { x: f.x, y: f.y });
      let depth = roomDepth.get(room);
      if (depth === undefined) {
        depth = v.entrance ? (() => {
          const r = shortestWalkPath(v.pj, v.derived, v.entrance!.inside, { x: f.x, y: f.y }, { radius: 0.2 });
          return r.ok ? r.length : Math.hypot(f.x - v.entrance!.inside.x, f.y - v.entrance!.inside.y);
        })() : 0;
        roomDepth.set(room, depth);
      }
      const pieceDims = f.packages?.length
        ? f.packages.map((pk) => ({ label: pk.name || 'Paket', w: pk.width, d: pk.depth, h: pk.height }))
        : [{ label: f.name, w: f.width, d: f.depth, h: f.height }];
      const pieces: PieceCheck[] = pieceDims.map((pd) => {
        const dims = { w: pd.w, d: pd.d, h: pd.h };
        const msgs: string[] = [];
        let status: FitStatus = 'ok';
        // building access
        const acc = checkAccess(dims, access);
        status = worst(status, acc.status === 'unknown' ? 'ok' : acc.status);
        msgs.push(...acc.messages);
        // route inside the flat
        const key = `${v.level.id}|${roomNameAt(v.derived, v.pj, { x: f.x, y: f.y })}|${[dims.w, dims.d, dims.h].map((n) => n.toFixed(3)).join('x')}`;
        let inner = cache.get(key);
        if (!inner) {
          if (v.entrance) {
            inner = deliveryPiece(checkPieceDelivery(v.pj, v.derived, { ...f, width: dims.w, depth: dims.d, height: dims.h }));
          } else if (!entranceView) {
            inner = { status: 'unknown', messages: ['Keine Eingangstür im Plan: Türen nicht geprüft.'] };
          } else if (v.level.elevation === entranceElevation) {
            inner = { status: 'unknown', messages: [] };
          } else if (stairW === undefined) {
            inner = { status: 'no', messages: ['Keine Treppe im Plan, die in dieses Geschoss führt.'] };
          } else if (stairW === null) {
            inner = { status: 'unknown', messages: ['Treppe im Plan ist gewendelt: Laufbreite nicht geprüft.'] };
          } else {
            const small = [dims.w, dims.d, dims.h].sort((x, y) => x - y);
            const ok = small[0] <= stairW - 2 * CARRY_MARGIN;
            inner = ok
              ? { status: stairW - 2 * CARRY_MARGIN - small[0] < TIGHT ? 'tight' : 'ok', messages: stairW - 2 * CARRY_MARGIN - small[0] < TIGHT ? [`Treppe im Plan knapp (${cm(stairW)} breit).`] : [] }
              : { status: 'no', messages: [`Treppe im Plan nur ${cm(stairW)} breit, schmalste Seite ${cm(small[0])}.`] };
            inner.messages.push('Weg zur Treppe im Geschoss nicht geprüft.');
          }
          cache.set(key, inner);
        }
        status = worst(status, inner.status === 'unknown' ? 'ok' : inner.status);
        msgs.push(...inner.messages);
        if (inner.status === 'unknown' && inner.messages.length && status === 'ok') status = 'unknown';
        return { label: pd.label, dims, status, messages: msgs };
      });
      const status = pieces.reduce<FitStatus>((s, pc) => worst(s, pc.status), 'ok');
      const phase = f.buyPhase ?? 'movein';
      const levelDist = Math.abs(v.level.elevation - entranceElevation);
      drafts.push({
        furnitureId: f.id,
        name: f.name,
        quantity: f.quantity,
        levelId: v.level.id,
        levelName: v.level.name,
        roomName: room,
        phase,
        assembly: ASSEMBLED.has(f.category) || !!f.packages?.length,
        pieces,
        status,
        // phase, far storeys first, far rooms first, rank, big first
        sortKey: [PHASE_RANK[phase], -levelDist, -Math.round(depth * 10), 0, categoryRank(f.category), -(f.width * f.depth * f.height)],
      });
    }
  }
  drafts.sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) {
      if (i === 3 && a.roomName !== b.roomName) return a.roomName.localeCompare(b.roomName, 'de'); // keep a room together
      if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    }
    return a.name.localeCompare(b.name, 'de');
  });
  const steps: MoveStep[] = drafts.map(({ sortKey, ...rest }, i) => {
    void sortKey;
    return { ...rest, order: i + 1 };
  });
  return {
    steps,
    warnings: steps.filter((s) => s.status === 'no' || s.status === 'tight').length,
    noEntrance: !entranceView,
    accessMissing,
  };
}
