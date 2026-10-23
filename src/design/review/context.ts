/**
 * Everything the rules of the walk-through (#441) share for one room: the pieces with their
 * roles, the doors and windows with their positions, the walking grid and clear-space probes.
 */
import type { CatalogItem } from '../../catalog/types';
import { pointInPolygon, type Vec2 } from '../../model/vec';
import type { RoomType } from '../../suggest/furnishing';
import type { Finding, Layout, PlacedItem, RoomAnalysis, RoomProgram, Severity, WallInfo } from '../types';
import { boundaryDist, localRect, overlaps, type Pose } from './geom';
import { WalkGrid } from './grid';
import { toRItem, type RItem } from './items';

export interface ReviewOptions {
  /** The user asked for new sanitary pieces (A3 does not apply). */
  allowNewSanitary?: boolean;
  /** A dark bedroom is wanted (D7). */
  darkening?: boolean;
  /** Functions that may appear twice in the flat on purpose (A2): `dining`, `guest`, `kitchen`, `tv`. */
  allowDouble?: string[];
}

export interface ReviewInput {
  analysis: RoomAnalysis;
  /** Room type of the concept. */
  type: RoomType;
  layout: Layout;
  /** Pieces already in the room before the proposal (fitted bath, existing kitchen); they count and block. */
  existing?: PlacedItem[];
  program?: RoomProgram;
  /** Colours of the style plan (#rrggbb) for E4. */
  palette?: string[];
  /** Products of the user, besides the generic catalogue. */
  catalog?: CatalogItem[];
  options?: ReviewOptions;
}

export interface Door {
  label: string;
  openingId: string;
  kind: 'door' | 'passage';
  wall: WallInfo;
  /** Centre in the wall, and 0.5 m inside the room in front of it. */
  mid: Vec2;
  entry: Vec2;
  width: number;
  swing?: Vec2[];
  toRoomId: string | null;
}

export interface Win {
  label: string;
  wall: WallInfo;
  mid: Vec2;
  width: number;
  sill: number;
  /** The stretch of the window and 0.4 m into the room. */
  strip: Vec2[];
  t0: number;
  t1: number;
}

export interface Clear {
  depth: number;
  blocker?: RItem | 'wall';
}

const point = (a: Vec2, d: Vec2, t: number): Vec2 => ({ x: a.x + d.x * t, y: a.y + d.y * t });

export class RoomCtx {
  readonly an: RoomAnalysis;
  readonly type: RoomType;
  readonly program?: RoomProgram;
  readonly options: ReviewOptions;
  readonly palette: string[];
  readonly layout: Layout;
  /** Pieces of the proposal and existing pieces. */
  readonly items: RItem[];
  readonly placed: RItem[];
  readonly doors: Door[] = [];
  readonly windows: Win[] = [];
  readonly findings: Finding[] = [];
  private gridCache?: WalkGrid;
  private reachCache?: Uint8Array;

  constructor(input: ReviewInput) {
    this.an = input.analysis;
    this.type = input.type;
    this.program = input.program;
    this.options = input.options ?? {};
    this.palette = input.palette ?? [];
    this.layout = input.layout;
    const extra = input.catalog ?? [];
    this.placed = input.layout.items.map((i) => toRItem(i, false, extra));
    this.items = [...(input.existing ?? []).map((i) => toRItem(i, true, extra)), ...this.placed];
    for (const wall of this.an.walls)
      for (const o of wall.openings) {
        const mid = point(wall.a, wall.dir, (o.t0 + o.t1) / 2);
        if (o.kind === 'window') {
          const w = o.t1 - o.t0;
          this.windows.push({
            label: o.id,
            wall,
            mid,
            width: w,
            sill: o.sill ?? 0.9,
            strip: [point(wall.a, wall.dir, o.t0), point(wall.a, wall.dir, o.t1), point(point(wall.a, wall.dir, o.t1), wall.inward, 0.4), point(point(wall.a, wall.dir, o.t0), wall.inward, 0.4)],
            t0: o.t0,
            t1: o.t1,
          });
        }
        if (o.passable)
          this.doors.push({ label: o.id, openingId: o.openingId, kind: o.kind === 'passage' ? 'passage' : 'door', wall, mid, entry: point(mid, wall.inward, 0.5), width: o.t1 - o.t0, swing: o.swingsIn ? o.swing : undefined, toRoomId: o.toRoomId });
      }
  }

  get roomId(): string {
    return this.an.roomId;
  }

  /** Walking grid with everything that blocks as obstacles. */
  get grid(): WalkGrid {
    return (this.gridCache ??= new WalkGrid(
      this.an.polygon,
      this.items.filter((i) => i.obstacle),
      this.doors.map((d) => d.mid),
    ));
  }

  /** Cells reachable from any door at 50 cm width. */
  get reach(): Uint8Array {
    return (this.reachCache ??= this.grid.reachable(
      this.doors.map((d) => d.entry),
      0.25,
    ));
  }

  byId(id: string): RItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  parentOf(i: RItem): RItem | undefined {
    return i.parent ? this.byId(i.parent) : undefined;
  }

  /** The piece a thing lies or stands on: its parent, else the highest floor piece below its centre. */
  supportOf(i: RItem): RItem | undefined {
    const parent = this.parentOf(i);
    if (parent) return parent;
    let best: RItem | undefined;
    for (const o of this.items) {
      if (o === i || !o.floor || !pointInPolygon(i, o.poly)) continue;
      if (Math.abs(o.height - i.elevation) < 0.12 && (!best || o.height > best.height)) best = o;
    }
    return best;
  }

  of(...roles: string[]): RItem[] {
    return this.items.filter((i) => roles.includes(i.role));
  }

  find(pred: (i: RItem) => boolean): RItem[] {
    return this.items.filter(pred);
  }

  add(rule: string, severity: Severity, text: string, items: (RItem | string)[] = [], where?: Vec2): void {
    this.findings.push({ rule, severity, roomId: this.roomId, items: items.map((i) => (typeof i === 'string' ? i : i.id)), text, where });
  }

  inRoom(p: Vec2): boolean {
    return pointInPolygon(p, this.an.polygon) || boundaryDist(p, this.an.polygon) < 0.005;
  }

  /**
   * How far the floor in front of (or beside, behind) a piece stays free: obstacles are floor
   * pieces and the room's walls. Looks in 5 cm steps up to `max`. `from` skips the first
   * metres along the piece's side for strips beside it (the head end of a bed).
   */
  freeDepth(it: RItem, side: 'front' | 'back' | 'left' | 'right', max: number, o: { ignore?: (x: RItem) => boolean; skip?: number } = {}): Clear {
    const inset = 0.02;
    const pose: Pose = it;
    const hw = it.width / 2;
    const hd = it.depth / 2;
    const step = 0.05;
    const others = this.items.filter((x) => x !== it && x.obstacle && !o.ignore?.(x));
    for (let k = 1; k * step <= max + 1e-9; k++) {
      const a = (k - 1) * step;
      const b = k * step;
      let slab: Vec2[];
      if (side === 'front') slab = localRect(pose, -hw + inset, hw - inset, hd + a, hd + b);
      else if (side === 'back') slab = localRect(pose, -hw + inset, hw - inset, -hd - b, -hd - a);
      else if (side === 'right') slab = localRect(pose, hw + a, hw + b, -hd + inset + (o.skip ?? 0), hd - inset);
      else slab = localRect(pose, -hw - b, -hw - a, -hd + inset + (o.skip ?? 0), hd - inset);
      if (slab.some((p) => !this.inRoom(p))) return { depth: a, blocker: 'wall' };
      const hit = others.find((x) => overlaps(slab, x.poly));
      if (hit) return { depth: a, blocker: hit };
    }
    return { depth: max };
  }

  label(i: RItem): string {
    const prog = this.program?.items.find((p) => p.id === i.id)?.label;
    return prog ? prog.replace(/ \(Platzhalter\)$/, '') : i.name;
  }

  nearestWindow(p: Vec2): Win | undefined {
    let best: Win | undefined;
    let bd = Infinity;
    for (const w of this.windows) {
      const d = Math.hypot(w.mid.x - p.x, w.mid.y - p.y);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }
}
