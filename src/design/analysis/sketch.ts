/**
 * The room and the flat as text for Claude (#438), in room coordinates: whole cm from the
 * north-west corner of the room, x to the east, y to the south (see coords.ts). Everything
 * Claude needs to place furniture like a designer: walls with what lies behind them, doors with
 * where they lead and how they swing, windows, free wall stretches, corners, the ways that must
 * stay walkable, existing pieces, connections and the areas the user marked.
 */
import type { Furniture, Project } from '../../model/schema';
import { dot, sub, type Vec2 } from '../../model/vec';
import { frontOf } from '../../suggest/roomGeometry';
import { sideOfVector, toRoomCm } from '../coords';
import type { FlatAnalysis, RoomAnalysis, Side, WallInfo, WallOpening } from '../types';

const SIDE_WORD: Record<Side, string> = { N: 'Nord', O: 'Ost', S: 'Süd', W: 'West' };
const SIDE_TO: Record<Side, string> = { N: 'Norden', O: 'Osten', S: 'Süden', W: 'Westen' };
const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

const cm = (m: number) => Math.round(m * 100);
const m1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Module of a fitted kitchen (units, worktop, appliances). */
const isKitchen = (f: Furniture) => !!f.kitchen;

function wallName(w: WallInfo): string {
  return w.side ? `${SIDE_WORD[w.side]}wand` : 'schräge Wand';
}

/** Stretch t0–t1 along a wall: x range on north/south walls, y range on east/west walls, else end points. */
function range(a: RoomAnalysis, w: WallInfo, t0: number, t1: number): string {
  const p0 = toRoomCm(a.origin, { x: w.a.x + w.dir.x * t0, y: w.a.y + w.dir.y * t0 });
  const p1 = toRoomCm(a.origin, { x: w.a.x + w.dir.x * t1, y: w.a.y + w.dir.y * t1 });
  if (w.side === 'N' || w.side === 'S') return `x=${Math.min(p0.x, p1.x)}–${Math.max(p0.x, p1.x)}`;
  if (w.side === 'O' || w.side === 'W') return `y=${Math.min(p0.y, p1.y)}–${Math.max(p0.y, p1.y)}`;
  return `(${p0.x},${p0.y})–(${p1.x},${p1.y})`;
}

/** Real compass direction a window looks to, when the plan is not drawn with north up. */
function compass(project: Project, outward: Vec2): string | null {
  const north = project.settings.northDirection ?? 0;
  if (!north) return null;
  const bearing = (((Math.atan2(outward.x, -outward.y) * 180) / Math.PI + north) % 360 + 360) % 360;
  return COMPASS[Math.round(bearing / 45) % 8];
}

export interface SketchContext {
  project: Project;
  flat: FlatAnalysis;
}

function roomName(ctx: SketchContext, id: string | null): string {
  return id ? `„${ctx.project.rooms.find((r) => r.id === id)?.name ?? id}“` : 'außen';
}

function openingText(ctx: SketchContext, a: RoomAnalysis, w: WallInfo, o: WallOpening): string {
  const where = `${range(a, w, o.t0, o.t1)} (${cm(o.t1 - o.t0)} cm)`;
  if (o.kind === 'window') {
    const real = compass(ctx.project, { x: -w.inward.x, y: -w.inward.y });
    const view = real ? `, schaut nach ${real}` : '';
    if ((o.sill ?? 1) < 0.05) {
      return o.passable
        ? `Fenstertür ${o.id} bis zum Boden bei ${where} zu ${roomName(ctx, o.toRoomId)}, einziger Zugang dorthin${view}`
        : `Glaselement ${o.id} bis zum Boden bei ${where}${o.toRoomId ? ` zu ${roomName(ctx, o.toRoomId)}` : ''}, Oberkante ${cm(o.top ?? 0)} cm${view}`;
    }
    return `Fenster ${o.id} bei ${where}, Brüstung ${cm(o.sill ?? 0)} cm, Oberkante ${cm(o.top ?? 0)} cm${view}`;
  }
  const entranceDoor = a.entrance && o.id === a.mainDoor;
  const target = entranceDoor ? 'Wohnungstür' : o.toRoomId ? `zu ${roomName(ctx, o.toRoomId)}` : 'nach außen';
  if (o.kind === 'passage') return `Durchgang ${o.id} ohne Tür bei ${where} ${target}`;
  let swing = 'schlägt nach außen auf';
  if (o.swingsIn && o.swing) {
    const hinge = toRoomCm(a.origin, o.swing[0]);
    swing = `schlägt herein (Angel bei (${hinge.x},${hinge.y}), Viertelkreis mit ${cm(o.t1 - o.t0)} cm Radius frei lassen)`;
  }
  return entranceDoor ? `Wohnungstür ${o.id} bei ${where}, ${swing}` : `Tür ${o.id} bei ${where} ${target}, ${swing}`;
}

/** Nearest opening to a corner along its two walls (label and distance). */
function nearest(a: RoomAnalysis, k: number, window: boolean): { id: string; d: number } | null {
  const w = a.walls[k];
  const next = a.walls[(k + 1) % a.walls.length];
  let best: { id: string; d: number } | null = null;
  for (const o of w.openings) if ((o.kind === 'window') === window && (!best || w.length - o.t1 < best.d)) best = { id: o.id, d: w.length - o.t1 };
  for (const o of next.openings) if ((o.kind === 'window') === window && (!best || o.t0 < best.d)) best = { id: o.id, d: o.t0 };
  return best;
}

function cornerText(a: RoomAnalysis, k: number): string {
  const c = a.corners[k];
  const p = toRoomCm(a.origin, c.p);
  const head = `${c.id} (${p.x},${p.y})`;
  if (c.reflex) return `${head} springt in den Raum vor`;
  const door = nearest(a, k, false);
  const win = nearest(a, k, true);
  const parts: string[] = [];
  if (door && door.d < 0.9) parts.push(door.d < 0.05 ? `Tür ${door.id} direkt daneben` : `Tür ${door.id} ${cm(door.d)} cm daneben`);
  if (win && win.d < 0.3) parts.push(`Fenster ${win.id} direkt daneben`);
  return `${head} ${parts.length ? parts.join(', ') : 'frei'}`;
}

/** Wall the back of a piece stands against (within 10 cm), if any. */
function backWall(a: RoomAnalysis, f: Furniture): WallInfo | undefined {
  const front = frontOf(f);
  return a.walls.find((w) => {
    const off = dot(sub(f, w.a), w.inward) - f.depth / 2;
    const t = dot(sub(f, w.a), w.dir);
    return Math.abs(off) < 0.1 && dot(front, w.inward) > 0.9 && t > -0.05 && t < w.length + 0.05;
  });
}

/** Where a piece stands: centre, size, the wall its back is against and where its front faces. */
function pieceText(a: RoomAnalysis, f: Furniture): string {
  const p = toRoomCm(a.origin, f);
  const wall = backWall(a, f);
  const side = sideOfVector(frontOf(f), 30);
  return `${f.name} (${cm(f.width)} × ${cm(f.depth)} cm) bei (${p.x},${p.y})${wall ? `, Rücken an ${wall.id}` : ''}${side ? `, Front nach ${side}` : ''}`;
}

const FIXTURE_WORD: Record<string, string> = { radiator: 'Heizkörper', socket: 'Steckdose', switch: 'Lichtschalter', water: 'Wasseranschluss', drain: 'Abfluss' };

export function roomSketch(ctx: SketchContext, a: RoomAnalysis): string {
  const L = (p: Vec2) => {
    const q = toRoomCm(a.origin, p);
    return `(${q.x},${q.y})`;
  };
  const lines: string[] = [];
  const flags = [a.entrance ? 'mit der Wohnungstür' : '', a.passThrough ? 'Durchgangszimmer' : ''].filter(Boolean);
  const reflex = a.corners.filter((c) => c.reflex).length;
  const shape = a.walls.length === 4 && reflex === 0 && a.walls.every((w) => w.side) ? 'rechteckig' : a.walls.length === 6 && reflex === 1 ? 'L-förmig' : `${a.walls.length} Wände${a.walls.some((w) => !w.side) ? ', teils schräg' : ''}`;
  lines.push(`Raum „${a.name}“${flags.length ? ` (${flags.join(', ')})` : ''}: ${m1(a.area)} m², Innenmaß ${cm(a.size.x)} × ${cm(a.size.y)} cm, ${shape}, Raumhöhe ${cm(a.height)} cm.`);
  lines.push('Koordinaten in cm: x von West nach Ost, y von Nord nach Süd, (0,0) = Nordwest-Ecke des Raums, Norden ist oben im Plan.');
  lines.push('Wände im Uhrzeigersinn:');
  for (const w of a.walls) {
    const behind = w.behind.map((id) => (id ? roomName(ctx, id) : 'außerhalb der Wohnung')).join(', ');
    const head = `- ${w.id} ${wallName(w)}, ${cm(w.length)} cm von ${L(w.a)} nach ${L(w.b)}, ${cm(w.thickness)} cm dick${w.height < a.height - 0.3 ? `, nur ${cm(w.height)} cm hoch (Brüstung)` : ''}; dahinter ${behind}.`;
    const ops = w.openings.map((o) => openingText(ctx, a, w, o));
    // free stretches from west to east and north to south, whichever way the wall runs
    const free = (w.dir.x + w.dir.y < 0 ? [...w.free].reverse() : w.free).map((s) => range(a, w, s.t0, s.t1));
    lines.push(`${head}${ops.length ? ` ${ops.join('; ')}.` : ' Ohne Öffnung.'}${ops.length && free.length ? ` Frei: ${free.join(', ')}.` : ''}`);
  }
  lines.push(`Ecken: ${a.corners.map((_, k) => cornerText(a, k)).join('; ')}.`);
  if (a.entryView) {
    const w = a.walls.find((x) => x.id === a.entryView!.wall);
    const side = sideOfVector(a.entryView.dir, 30);
    const onWall = w?.openings.length ? ` mit ${w.openings.map((o) => o.id).join(', ')}` : '';
    lines.push(`Beim Hereinkommen durch ${a.entryView.door}${side ? ` blickt man nach ${SIDE_TO[side]}` : ''}${w ? ` auf ${w.id}${onWall}` : ''}.`);
  }
  if (a.walkways.length) {
    lines.push(
      `Wege, die frei bleiben müssen (${a.walkways.every((x) => x.width >= 0.9) ? '90 cm breit' : 'Breite je Weg'}; nicht genau diese Linie, aber ein Durchgang dieser Breite ohne großen Umweg):`,
    );
    for (const w of a.walkways) {
      const ends = [w.from, w.to].map((id) => {
        const o = a.walls.flatMap((x) => x.openings).find((x) => x.id === id);
        return o?.toRoomId ? roomName(ctx, o.toRoomId) : a.entrance && id === a.mainDoor ? 'Wohnungstür' : 'außen';
      });
      const pts = w.path.length > 2 ? w.path.slice(1, -1) : w.path;
      lines.push(`- ${w.from} → ${w.to} (${ends[0]} → ${ends[1]}${w.main ? ', Hauptweg' : ''}): ${m1(w.length)} m, ${cm(w.width)} cm breit, über ${pts.map(L).join(' → ')}`);
    }
  }
  const existing = ctx.project.furniture.filter((f) => a.existing.includes(f.id));
  const kitchen = existing.filter(isKitchen);
  const loose = existing.filter((f) => !isKitchen(f));
  if (loose.length) lines.push(`Bestand (bleibt stehen, nicht neu planen): ${loose.map((f) => pieceText(a, f)).join('; ')}.`);
  if (kitchen.length) {
    // the run along each wall: stretch and depth of the floor units standing with their back to it
    const floor = kitchen.filter((f) => f.elevation < 0.5 && f.kitchen?.type !== 'countertop');
    const runs = a.walls.flatMap((w) => {
      const on = floor.filter((f) => backWall(a, f) === w);
      if (!on.length) return [];
      const t0 = Math.min(...on.map((f) => dot(sub(f, w.a), w.dir) - f.width / 2));
      const t1 = Math.max(...on.map((f) => dot(sub(f, w.a), w.dir) + f.width / 2));
      return [`an ${w.id} bei ${range(a, w, t0, t1)}, ${cm(Math.max(...on.map((f) => f.depth)))} cm tief: ${on.map((f) => f.name).join(', ')}`];
    });
    lines.push(`Vorhandene Einbauküche (bleibt, keine zweite planen) ${runs.join('; ') || floor.map((f) => f.name).join(', ')}. Davor 120 cm frei lassen.`);
  }
  if (a.fixtures.length)
    lines.push(
      `Anschlüsse: ${a.fixtures
        .map((x) => {
          const w = a.walls.find((y) => y.id === x.wall);
          const at = w ? `an ${w.id} bei ${range(a, w, x.t - x.width / 2, x.t + x.width / 2)}` : `bei ${L(x.p)}`;
          return `${FIXTURE_WORD[x.kind] ?? x.kind} ${at}${x.kind === 'radiator' && x.height ? `, ${cm(x.height)} cm hoch` : ''}`;
        })
        .join('; ')}.`,
    );
  for (const z of a.userZones) {
    const xs = z.points.map((p) => toRoomCm(a.origin, p));
    const box = `x=${Math.min(...xs.map((p) => p.x))}–${Math.max(...xs.map((p) => p.x))}, y=${Math.min(...xs.map((p) => p.y))}–${Math.max(...xs.map((p) => p.y))}`;
    lines.push(`Vom Nutzer markiert: ${z.id} „${z.purpose}“ bei ${box}${z.keepFree ? ': hier nichts hinstellen.' : ': diese Funktion gehört genau hierhin.'}`);
  }
  if (a.notes.length) lines.push(`Hinweise: ${a.notes.join(' ')}`);
  return lines.join('\n');
}

/** Overview of the flat for the flat concept: rooms, connections, ways from the entrance. */
export function flatSketch(ctx: SketchContext): string {
  const { project, flat } = ctx;
  const lines: string[] = [];
  const total = flat.rooms.reduce((s, r) => s + r.area, 0);
  const entrance = flat.rooms.find((r) => r.roomId === flat.entranceRoomId);
  lines.push(`Wohnung mit ${flat.rooms.length} Räumen, zusammen ${m1(total)} m²${entrance ? `. Die Wohnungstür führt in ${roomName(ctx, entrance.roomId)}` : ''}.`);
  lines.push('Räume:');
  for (const r of flat.rooms) {
    const ops = r.walls.flatMap((w) => w.openings.map((o) => ({ w, o })));
    const doors = ops.filter(({ o }) => o.passable).map(({ o }) => (r.entrance && o.id === r.mainDoor ? 'Wohnungstür' : o.toRoomId ? roomName(ctx, o.toRoomId) : 'außen'));
    const windows = ops.filter(({ o }) => o.kind === 'window');
    const sides = [...new Set(windows.map(({ w }) => w.side).filter((s): s is Side => !!s))];
    const existing = project.furniture.filter((f) => r.existing.includes(f.id));
    const kitchen = existing.some(isKitchen);
    const named = [...new Set(existing.filter((f) => !isKitchen(f)).map((f) => f.name))];
    const flags = [r.passThrough ? 'Durchgangszimmer' : '', r.entrance ? 'Eingang' : ''].filter(Boolean);
    lines.push(
      `- ${r.name}${flags.length ? ` (${flags.join(', ')})` : ''}: ${m1(r.area)} m², ${cm(r.size.x)} × ${cm(r.size.y)} cm; Türen zu ${doors.join(', ') || '–'}; ${
        windows.length ? `${windows.length} Fenster${sides.length ? ` (${sides.join(', ')})` : ''}` : 'kein Fenster'
      }${named.length || kitchen ? `; vorhanden: ${[...(kitchen ? ['Einbauküche'] : []), ...named].join(', ')}` : ''}`,
    );
  }
  // routes from the entrance to the rooms two or more steps away
  if (flat.entranceRoomId) {
    const prev = new Map<string, string>();
    const queue = [flat.entranceRoomId];
    const seen = new Set(queue);
    while (queue.length) {
      const r = queue.shift()!;
      for (const l of flat.links) {
        const next = l.a === r ? l.b : l.b === r ? l.a : null;
        if (next && !seen.has(next)) {
          seen.add(next);
          prev.set(next, r);
          queue.push(next);
        }
      }
    }
    const routes = flat.rooms
      .filter((r) => prev.has(r.roomId) && prev.get(r.roomId) !== flat.entranceRoomId)
      .map((r) => {
        const chain = [r.roomId];
        while (prev.has(chain[0])) chain.unshift(prev.get(chain[0])!);
        return chain.map((id) => project.rooms.find((x) => x.id === id)!.name).join(' → ');
      });
    if (routes.length) lines.push(`Wege vom Eingang durch andere Räume: ${routes.join('; ')}.`);
  }
  const zones = flat.rooms.flatMap((r) => r.userZones.map((z) => `${z.id} „${z.purpose}“ in ${roomName(ctx, r.roomId)}`));
  if (zones.length) lines.push(`Vom Nutzer markierte Bereiche: ${zones.join('; ')}.`);
  return lines.join('\n');
}
