/**
 * Does Claude's own plan keep the rules it was given? (mgritsch04/wohnungsplaner-3d#436, research of
 * 6.11.2026: self-correction only works with reliable feedback, and a contradiction in the programme
 * is cheaper to fix before the solver than after it, LayoutVLM „self-consistent decoding“.)
 *
 * The check reads the start places and directions of the programme, before anything is placed, and
 * names what already breaks a rule there: the television not opposite the sofa or far off it (W5), the sofa
 * looking at the kitchen run (W10), dining chairs without room to the wall (E2), a half of the room or a
 * wide patch of floor left empty (E6; in all six benchmark rooms with E6 the plan itself left it empty,
 * 6.11.), a rug under the bed too short across it or off its middle (S5), a piece in the way between
 * two doors (B2), a programme that needs more floor than the room has (R5), a piece where the curtain
 * hangs and a desk looking straight at the window (D7, C5). These go back to Claude with the other problems of the answer (one repair round); a finding
 * the solver causes later is not Claude's to fix.
 */
import { findCatalogItem, GENERIC_CATALOG } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import type { Furniture } from '../../model/schema';
import { dist, pointInPolygon, sub, type Vec2 } from '../../model/vec';
import type { RoomType } from '../../suggest/furnishing';
import { roleOf, rotationFacing, shapeOf } from '../../suggest/roomGeometry';
import { checkWalkways } from '../analysis';
import { RoomCtx } from '../review/context';
import { checkDesk, checkTv } from '../review/arrangeRules';
import { checkCurtains, checkPlants } from '../review/decorRules';
import { checkClearances } from '../review/wayRules';
import { checkTvGlare } from '../review/groupRules';
import { boundaryDist } from '../review/geom';
import { BALANCED, checkBalance, checkOpenPatch } from '../review/overallRules';
import { toRItem } from '../review/items';
import { sideOfVector } from '../coords';
import { specOf, type Clearance } from '../solver/items';
import { tvRange } from '../tvDistance';
import type { PlacedItem, ProgramItem, RoomAnalysis, RoomProgram } from '../types';

const deg = (d: number) => (d * Math.PI) / 180;
/** Front of a piece with this rotation (local +y), as `Furniture.rotation`. */
const frontOf = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });
const angle = (a: Vec2, b: Vec2) => {
  const l = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  return l < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / l)));
};
const SIDE_NAMES = { N: 'Norden', O: 'Osten', S: 'Süden', W: 'Westen' } as const;
const sideName = (v: Vec2) => {
  const s = sideOfVector(v, 45);
  return s ? SIDE_NAMES[s] : 'schräg';
};

/** The television must lie within this angle of the sofa's view (W5; the walkthrough flags 30°). */
export const TV_CONE = deg(30);
/** The sofa does not look at kitchen pieces within this cone and distance (W10, as the walkthrough). */
const KITCHEN_CONE = deg(35);
const KITCHEN_RANGE = 5;

interface Placed {
  id: string;
  category: string;
  height: number;
  at: Vec2;
  front: Vec2;
  role: string;
  shape: string;
  width: number;
  depth: number;
}

function placedOf(items: readonly ProgramItem[], products: readonly CatalogItem[]): Placed[] {
  return items.flatMap((it) => {
    const c = findCatalogItem(it.catalogId, [...products]);
    if (!c || !it.hint) return [];
    return [{ id: it.id, at: { x: it.hint.x, y: it.hint.y }, front: frontOf(it.hint.rotation), role: roleOf(c), shape: shapeOf(c), category: c.category, height: c.height, width: c.width, depth: c.depth }];
  });
}

/** Points of the kitchen run along its wall, and pieces of a kitchen already in the room. */
function kitchenPoints(program: RoomProgram, existing: readonly Furniture[]): Vec2[] {
  const out: Vec2[] = [];
  for (const k of program.kitchen ?? [])
    for (let t = 0; t <= 1.0001; t += 0.25) out.push({ x: k.from.x + (k.to.x - k.from.x) * t, y: k.from.y + (k.to.y - k.from.y) * t });
  for (const f of existing) if (f.kitchen || shapeOf(f).startsWith('k-')) out.push({ x: f.x, y: f.y });
  return out;
}


/** Distance from `p` along `dir` to the room's outline (m), or Infinity. */
function rayToOutline(p: Vec2, dir: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const den = dir.x * e.y - dir.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const ap = sub(a, p);
    const t = (ap.x * e.y - ap.y * e.x) / den;
    const u = (ap.x * dir.y - ap.y * dir.x) / den;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t);
  }
  return best;
}

/** Room behind the chairs of a dining table, table edge to wall (E2; the walkthrough flags under 75 cm). */
const CHAIR_ROOM = 0.75;
/** An anchor may stand this far (m) outside its zone before the walkthrough calls it misplaced (A5). */
const ZONE_SLACK = 0.3;
const SIDE_WORD = { N: 'nördlichen', O: 'östlichen', S: 'südlichen', W: 'westlichen' } as const;

/**
 * Problems in the programme's own start places, as lines for the repair prompt. `existing` are the
 * pieces already in the room (a fitted kitchen counts as kitchen run).
 */
export function intentProblems(program: RoomProgram, room: Pick<RoomAnalysis, 'polygon'> | undefined, existing: readonly Furniture[] = [], products: readonly CatalogItem[] = [], type?: RoomType): string[] {
  const problems: string[] = [];
  const pieces = placedOf(program.items, products);
  const sofas = pieces.filter((p) => p.role === 'sofa');
  const tvs = pieces.filter((p) => p.role === 'tv');
  const kitchen = kitchenPoints(program, existing);
  for (const tv of tvs) {
    const sofa = sofas.slice().sort((a, b) => dist(a.at, tv.at) - dist(b.at, tv.at))[0];
    if (!sofa) continue;
    const to = sub(tv.at, sofa.at);
    if (Math.hypot(to.x, to.y) > 0.3 && angle(sofa.front, to) > TV_CONE + deg(5))
      problems.push(
        `„${tv.id}“ steht nach deinen Startplätzen nicht gegenüber von „${sofa.id}“: das Sofa schaut nach ${sideName(sofa.front)}, der Fernseher liegt von ihm aus im ${sideName(to)} (W5: Fernseher mittig gegenüber dem Hauptsitz). Sofa und Fernseher an gegenüberliegende Wände stellen oder die Blickrichtung des Sofas ändern.`,
      );
    else {
      const range = tvRange(tv.width);
      const d = Math.hypot(to.x, to.y) - sofa.depth / 2;
      if (d > range.hi + 0.3 || d < range.lo - 0.3)
        problems.push(
          `Zwischen der Vorderkante von „${sofa.id}“ und „${tv.id}“ liegen nach deinen Startplätzen etwa ${d.toFixed(1).replace('.', ',')} m, bei diesem Fernseher sind ${range.lo.toFixed(1).replace('.', ',')} bis ${range.hi.toFixed(1).replace('.', ',')} m angenehm (W5). Das Sofa näher oder weiter weg stellen, notfalls frei im Raum mit Konsole dahinter.`,
        );
    }
  }
  if (kitchen.length)
    for (const s of sofas) {
      const tv = tvs.find((t) => angle(s.front, sub(t.at, s.at)) <= KITCHEN_CONE);
      const seen = kitchen.filter((k) => {
        const to = sub(k, s.at);
        const d = Math.hypot(to.x, to.y);
        return d <= KITCHEN_RANGE && angle(s.front, to) <= KITCHEN_CONE && !(tv && dist(tv.at, s.at) < d);
      });
      if (seen.length)
        problems.push(
          `„${s.id}“ schaut nach deinen Startplätzen nach ${sideName(s.front)} direkt auf die Küchenzeile (W10). Das Sofa so drehen oder stellen, dass es auf Fenster, Fernseher oder die Sitzgruppe schaut; die Küche liegt seitlich oder im Rücken, dann mit Konsole oder Sideboard dahinter.`,
        );
    }
  // dining chairs need room behind them to the wall (E2): a table pushed to the wall with chairs on that side
  if (room?.polygon.length)
    for (const t of pieces.filter((p) => p.category === 'table' && p.shape === 'table' && p.width >= 0.55 && p.height >= 0.6)) {
      const right = { x: t.front.y * -1, y: t.front.x };
      const sides = [
        { dir: t.front, half: t.depth / 2 },
        { dir: { x: -t.front.x, y: -t.front.y }, half: t.depth / 2 },
        { dir: right, half: t.width / 2 },
        { dir: { x: -right.x, y: -right.y }, half: t.width / 2 },
      ];
      for (const side of sides) {
        const chairs = pieces.filter((c) => c.category === 'chair' && c.shape === 'chair').filter((c) => {
          const to = sub(c.at, t.at);
          const along = to.x * side.dir.x + to.y * side.dir.y;
          return along > side.half - 0.1 && along < side.half + 0.8 && angle(side.dir, to) < deg(60);
        });
        if (!chairs.length) continue;
        const edge = { x: t.at.x + side.dir.x * side.half, y: t.at.y + side.dir.y * side.half };
        const free = rayToOutline(edge, side.dir, room.polygon);
        if (free < CHAIR_ROOM - 0.05) {
          const s = sideOfVector(side.dir, 45);
          problems.push(
            `Hinter ${chairs.length === 1 ? 'dem Stuhl' : 'den Stühlen'} an der ${s ? SIDE_WORD[s] : 'einen'} Seite von „${t.id}“ bleiben nach deinen Startplätzen nur etwa ${Math.round(free * 100)} cm bis zur Wand, zum Zurückschieben und Aufstehen braucht es 90 cm (E2). Den Tisch weiter in den Raum stellen oder auf dieser Seite keinen Stuhl (dort eine Bank an der Wand).`,
          );
        }
      }
    }
  // A5: an anchor whose start place lies outside its own zone (benchmark 7.11.: F Bad 2, the solver kept it there)
  for (const it of program.items) {
    const zone = it.required && it.hint ? program.zones.find((z) => z.id === it.zone) : undefined;
    if (!zone || !it.hint) continue;
    const r = zone.rect;
    const out = Math.max(r.x0 - it.hint.x, it.hint.x - r.x1, r.y0 - it.hint.y, it.hint.y - r.y1, 0);
    if (out > ZONE_SLACK)
      problems.push(
        `„${it.id}“ steht nach deinen Startplätzen etwa ${Math.round(out * 100)} cm außerhalb seiner Zone „${zone.id}“ (${zone.function}) (A5). Den Startplatz in die Zone legen oder die Zone so ziehen, dass sie das Möbel einschließt; die Begehung prüft das Ankermöbel in seiner Zone.`,
      );
  }
  problems.push(...rugUnderBed(pieces, products, room?.polygon));
  if (type && room && 'walls' in room) problems.push(...emptyFloor(program, room as RoomAnalysis, type, existing, products));
  if (room && 'walkways' in room) problems.push(...blockedWays(program, room as RoomAnalysis, existing, products));
  if (room && 'walkways' in room) problems.push(...areaBudget(program, room as RoomAnalysis, existing, products));
  if (type && room && 'walls' in room) problems.push(...windowSpots(program, room as RoomAnalysis, type, existing, products));
  if (type && room && 'walls' in room) problems.push(...focusSpots(program, room as RoomAnalysis, type, existing, products));
  return problems;
}

/** Half the extent of a piece along `axis` (unit vector). */
function halfAlong(p: Placed, axis: Vec2): number {
  const across = { x: p.front.y, y: -p.front.x };
  return (Math.abs(axis.x * across.x + axis.y * across.y) * p.width + Math.abs(axis.x * p.front.x + axis.y * p.front.y) * p.depth) / 2;
}

/** The rug under the bed shows 40 to 60 cm on both sides (S5); in four of four benchmark bedrooms
 * with this finding (6.11.) the rug Claude chose was already too short across the bed. */
function rugUnderBed(pieces: readonly Placed[], products: readonly CatalogItem[], outline?: readonly Vec2[]): string[] {
  const out: string[] = [];
  for (const bed of pieces.filter((p) => p.shape === 'bed')) {
    const across = { x: bed.front.y, y: -bed.front.x };
    // a bed with one long side at the wall (day bed, single bed): the rug only has to show on the free side
    const atWall = (s: -1 | 1) => !!outline && boundaryDist({ x: bed.at.x + across.x * s * (bed.width / 2 + 0.05), y: bed.at.y + across.y * s * (bed.width / 2 + 0.05) }, outline) < 0.15;
    const wallLeft = atWall(-1);
    const wallRight = atWall(1);
    for (const rug of pieces.filter((p) => p.shape === 'rug')) {
      const to = sub(rug.at, bed.at);
      const u = to.x * across.x + to.y * across.y;
      const v = to.x * bed.front.x + to.y * bed.front.y;
      const half = halfAlong(rug, across);
      // under the bed: spans it across and lies under its lower part, not a runner beside it
      if (Math.abs(u) > bed.width / 2 || half < bed.width * 0.4 || Math.abs(v) > bed.depth / 2 + halfAlong(rug, bed.front) - 0.15) continue;
      const cm = (m: number) => Math.round(Math.max(0, m) * 100);
      // the solver turns the rug with its long side across the bed, so its long side counts
      const long = Math.max(rug.width, rug.depth);
      const longAcross = 2 * half >= long - 0.01;
      const left = half - u - bed.width / 2;
      const right = half + u - bed.width / 2;
      if (wallLeft !== wallRight) {
        const free = wallLeft ? right : left;
        if (free < 0.39)
          out.push(`„${rug.id}“ ragt nach deinen Startplätzen auf der freien Seite von „${bed.id}“ nur ${cm(free)} cm heraus (S5). Das Bett steht mit einer Seite an der Wand, dort braucht es nichts; auf der freien Seite sind 40 bis 60 cm schön. Den Teppich zur freien Seite rücken oder einen größeren nehmen.`);
        continue;
      }
      if (long - bed.width < 0.79) {
        const need = bed.width + 0.8;
        const fits = [...products, ...GENERIC_CATALOG]
          .filter((c) => shapeOf(c) === 'rug' && Math.max(c.width, c.depth) >= need - 0.01 && Math.min(c.width, c.depth) >= 1.2)
          .sort((a, b) => a.width * a.depth - b.width * b.depth)[0];
        out.push(
          `„${rug.id}“ unter „${bed.id}“ ist nach deinen Startplätzen zu klein (Bett ${cm(bed.width)} cm breit): selbst quer ragt er nur ${cm((long - bed.width) / 2)} cm heraus, schön sind 40 bis 60 cm auf beiden Seiten (S5). Einen Teppich mit mindestens ${cm(need)} cm Länge nehmen${fits ? ` (z. B. ${fits.id}, ${fits.name})` : ''}, mit der langen Seite quer unter das untere Bettdrittel, oder statt dessen zwei Bettvorleger links und rechts.`,
        );
      } else if (!longAcross)
        out.push(`„${rug.id}“ liegt nach deinen Startplätzen längs unter „${bed.id}“, so ragt er seitlich nur ${cm(Math.min(left, right))} cm heraus (S5). Mit der langen Seite quer unter das untere Bettdrittel legen, dann sind es je ${cm((long - bed.width) / 2)} cm.`);
      else if (Math.min(left, right) < 0.39)
        out.push(`„${rug.id}“ liegt nach deinen Startplätzen nicht mittig unter „${bed.id}“: er ragt auf einer Seite ${cm(Math.min(left, right))} cm, auf der anderen ${cm(Math.max(left, right))} cm heraus, schön sind 40 bis 60 cm auf beiden Seiten (S5). Mittig unter das untere Bettdrittel legen.`);
    }
  }
  return out;
}

/** What a designer puts into an empty half or middle, per room type (research 6.11.: R-M3, S7, R4, W9, KI1). */
const FILL: Partial<Record<RoomType, string>> = {
  living: 'eine zweite kleine Gruppe (Leseecke mit Sessel, Beistelltisch und Stehleuchte am Fenster), die Sitzgruppe frei in den Raum mit Konsole oder Sideboard hinter dem Sofa, oder ein runder Tisch oder Pouf als Anker (R4, W9)',
  bedroom: 'eine Kommode oder Bank (mit 90 cm bis zur Wand), eine Leseecke mit Sessel und Stehleuchte oder eine Ankleide-Ecke mit Spiegel (S7)',
  kids: 'eine Spielfläche mit Teppich und niedrigem Regal oder Kisten (KI1)',
  office: 'eine Leseecke mit Sessel und Stehleuchte oder ein Regal oder Sideboard an der leeren Seite',
  dining: 'ein Sideboard oder eine Anrichte an der leeren Wand',
};

/** The plan as the walkthrough sees it: the start places, the kitchen run as one block, the pieces already there. */
function hintLayout(program: RoomProgram, room: RoomAnalysis, existing: readonly Furniture[], products: readonly CatalogItem[]): { items: PlacedItem[]; fixed: PlacedItem[] } {
  const items: PlacedItem[] = program.items.flatMap((it) => {
    const c = findCatalogItem(it.catalogId, [...products]);
    if (!c || !it.hint) return [];
    return [{ id: it.id, catalogId: it.catalogId, zone: it.zone, x: it.hint.x, y: it.hint.y, rotation: it.hint.rotation, elevation: c.elevation ?? 0, width: c.width, depth: c.depth, height: c.height }];
  });
  for (const [k, run] of (program.kitchen ?? []).entries()) {
    const wall = room.walls.find((w) => w.id === run.wall);
    if (!wall) continue;
    const len = dist(run.from, run.to);
    items.push({ id: `kitchen-${k}`, catalogId: 'generic-k-base-60', zone: '', x: (run.from.x + run.to.x) / 2 + wall.inward.x * 0.3, y: (run.from.y + run.to.y) / 2 + wall.inward.y * 0.3, rotation: rotationFacing(wall.inward), elevation: 0, width: len, depth: 0.6, height: 0.9 });
  }
  const fixed: PlacedItem[] = existing.map((f) => ({ id: f.id, catalogId: f.catalogId ?? '', zone: 'bestand', x: f.x, y: f.y, rotation: f.rotation, elevation: f.elevation ?? 0, width: f.width, depth: f.depth, height: f.height }));
  return { items, fixed };
}

/** E6 on the start places: the walkthrough's own check on the plan as Claude drew it. */
function emptyFloor(program: RoomProgram, room: RoomAnalysis, type: RoomType, existing: readonly Furniture[], products: readonly CatalogItem[]): string[] {
  const fill = FILL[type];
  if (!fill || !BALANCED.has(type) || room.area < 12) return [];
  const { items, fixed } = hintLayout(program, room, existing, products);
  // only the two E6 checks of the walkthrough, not all of it: this runs for every programme Claude sends
  const ctx = new RoomCtx({ analysis: room, type, layout: { roomId: room.roomId, items, dropped: [], cost: 0, unsolved: [], seed: 0 }, existing: fixed, program });
  checkBalance(ctx);
  checkOpenPatch(ctx);
  return ctx.findings
    .filter((f) => f.rule === 'E6')
    .slice(0, 1)
    .map((f) => `Im Plan gilt nach deinen Startplätzen schon: ${f.text} Dort plant ein Profi ${fill}; Wege bleiben frei.`);
}

/**
 * D7 and C5 on the start places: a desk, chest or sideboard where the curtain hangs (it cannot be drawn; in
 * four of seven benchmark rooms with this finding, 7.11., the plan had it already), and a desk facing the
 * window (backlight on the screen; real run r7, image review). Workplace rule: the line of sight runs along
 * the window, the daylight comes from the side (research 7.11.).
 */
function windowSpots(program: RoomProgram, room: RoomAnalysis, type: RoomType, existing: readonly Furniture[], products: readonly CatalogItem[]): string[] {
  const asks = (i: ProgramItem) => {
    const c = findCatalogItem(i.catalogId, [...products]);
    return !!c && !!i.hint && (c.category === 'desk' || shapeOf(c) === 'curtain' || shapeOf(c) === 'tv');
  };
  if (!room.walls.some((w) => w.openings.some((o) => o.kind === 'window')) || !program.items.some(asks)) return [];
  const { items, fixed } = hintLayout(program, room, existing, products);
  const ctx = new RoomCtx({ analysis: room, type, layout: { roomId: room.roomId, items, dropped: [], cost: 0, unsolved: [], seed: 0 }, existing: fixed, program, catalog: [...products] });
  checkCurtains(ctx);
  checkDesk(ctx);
  checkTvGlare(ctx);
  const mine = new Set(items.map((i) => i.id));
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const out: string[] = [];
  // one message per piece in the way: a sideboard under the window often reaches into both curtains
  const caught = new Map<string, string[]>();
  for (const f of ctx.findings)
    if (f.rule === 'D7' && f.items.length === 2 && f.items.every((id) => mine.has(id))) caught.set(f.items[1], [...new Set([...(caught.get(f.items[1]) ?? []), f.items[0]])]);
  for (const [hit, cs] of caught) {
    const desk = byId.get(hit)?.category === 'desk';
    const names = cs.map((c) => `„${c}“`).join(' und ');
    out.push(
      cs.length > 1
        ? `„${hit}“ reicht nach deinen Startplätzen unter dem Fenster in beide Vorhänge ${names}: sie lassen sich nicht auf- und zuziehen (D7). Unter dem Fenster nur, was schmaler als das Fenster und niedriger als die Fensterbank ist, sonst „${hit}“ an eine Wand ohne Fenster oder ein Rollo statt der Schals.`
        : `„${hit}“ steht nach deinen Startplätzen dort, wo ${names} am Fenster hängt: der Vorhang lässt sich nicht auf- und zuziehen (D7). Den Vorhang auf die freie Seite des Fensters hängen oder „${hit}“ so rücken, dass neben dem Fensterrand etwa 40 cm für den zusammengeschobenen Stoff frei bleiben${desk ? '; den Schreibtisch am besten quer zum Fenster, das Licht kommt dann von der Seite (C5)' : '; unter dem Fenster nur, was schmaler als das Fenster und niedriger als die Fensterbank ist'}.`,
    );
  }
  for (const f of ctx.findings)
    if (f.rule === 'C5' && f.text.includes('hinter dem Bildschirm') && f.items.every((id) => mine.has(id))) {
      const w = /Fenster (\S+) liegt/.exec(f.text)?.[1] ?? '';
      out.push(
        `„${f.items[0]}“ schaut nach deinen Startplätzen direkt auf das Fenster ${w}: man blickt beim Arbeiten ins Gegenlicht, der Bildschirm wirkt dunkel (C5). Profis stellen den Schreibtisch quer zum Fenster, das Tageslicht kommt von der Seite (für Rechtshänder von links), der Blick geht an der Fensterwand entlang.`,
      );
    }
  // benchmark 7.11.: in A and C the plan put the television opposite a window already, the solver kept it
  for (const f of ctx.findings)
    if (f.rule === 'C3' && f.items.every((id) => mine.has(id))) {
      const w = /dem Fenster (\S+) gegenüber/.exec(f.text)?.[1] ?? '';
      out.push(
        `„${f.items[0]}“ steht nach deinen Startplätzen dem Fenster ${w} gegenüber: bei Tageslicht spiegelt sich das Fenster im Bild (C3). Profis stellen den Fernseher an eine Wand quer zum Fenster, das Licht fällt dann von der Seite; reicht der Platz nicht, einen Vorhang oder ein Rollo am Fenster einplanen.`,
      );
    }
  return [...new Set(out)];
}

/**
 * C3, C4 and D1 on the start places: a sofa that looks at nothing, a dining table in the work aisle of
 * the kitchen, a tall plant in a room without a window. In the benchmark (7.11.) each came from the plan
 * (F Zimmer 2, E Küche, A Gang) and the solver kept it; no plan had one that the solver then mended, so
 * asking adds no repair round the result would not need (the recorded first answer for F Vorraum has a
 * tall plant without daylight too). Designers give every sofa a focal point (picture,
 * armchairs, window or television opposite), keep 120 cm between kitchen run and table (NKBA: 42 in work
 * aisle plus room behind the chairs) and put shade or artificial plants where no daylight comes.
 */
function focusSpots(program: RoomProgram, room: RoomAnalysis, type: RoomType, existing: readonly Furniture[], products: readonly CatalogItem[]): string[] {
  const wanted = program.items.some((i) => {
    const c = findCatalogItem(i.catalogId, [...products]);
    return !!c && !!i.hint && (roleOf(c) === 'sofa' || shapeOf(c) === 'plant' || c.category === 'table');
  });
  if (!wanted) return [];
  const { items, fixed } = hintLayout(program, room, existing, products);
  const ctx = new RoomCtx({ analysis: room, type, layout: { roomId: room.roomId, items, dropped: [], cost: 0, unsolved: [], seed: 0 }, existing: fixed, program, catalog: [...products] });
  checkTv(ctx);
  checkPlants(ctx);
  checkClearances(ctx);
  const mine = new Set(program.items.map((i) => i.id));
  const out: string[] = [];
  for (const f of ctx.findings) {
    const id = f.items[0];
    if (!id || !mine.has(id)) continue;
    if (f.rule === 'C3' && f.text.includes('schaut auf nichts'))
      out.push(
        `„${id}“ schaut nach deinen Startplätzen auf nichts: kein Fernseher, kein Fenster, kein Bild und keine Sessel gegenüber (C3). Profis geben jedem Sofa ein Blickziel: gegenüber ein Bild ab 60 cm Breite, Sessel oder das Fenster; oder das Sofa so drehen, dass es in den Raum statt auf eine leere Wand schaut.`,
      );
    else if (f.rule === 'C4' && f.text.includes('Arbeitsgang der Küche')) {
      const left = /bleiben (\d+) cm/.exec(f.text)?.[1];
      out.push(
        `„${id}“ steht nach deinen Startplätzen im Arbeitsgang der Küche${left ? `, vor der Zeile bleiben nur ${left} cm` : ''} (C4). Zwischen Küchenzeile und Esstisch plant man mindestens 120 cm, damit man kochen kann, während jemand am Tisch sitzt; den Tisch weiter in den Raum rücken oder quer zur Zeile stellen.`,
      );
    } else if (f.rule === 'D1' && f.text.includes('kein Tageslicht'))
      out.push(
        `„${id}“ steht nach deinen Startplätzen in einem Raum ohne Fenster und bekommt kein Tageslicht (D1). Dort eine Schattenpflanze wählen und so benennen (Zamioculcas, Sansevieria, Schusterpalme) oder eine Kunstpflanze, sonst die Pflanze in einen Raum mit Fenster.`,
      );
  }
  return [...new Set(out)];
}

/**
 * B1/B2 on the start places: a piece of the plan in the way between two doors. In the benchmark (6.11.) both
 * rooms of F with three doors had it in the plan already; the solver then shrank the 180 bed to 140 to get
 * the way free (research RF4: in a room one walks through, the bed or sofa goes to the longest wall without doors).
 */
function blockedWays(program: RoomProgram, room: RoomAnalysis, existing: readonly Furniture[], products: readonly CatalogItem[]): string[] {
  if (!room.walkways.length) return [];
  const { items, fixed } = hintLayout(program, room, existing, products);
  const extra = [...products];
  const block = (list: readonly PlacedItem[], isExisting: boolean) => list.map((i) => toRItem(i, isExisting, extra)).filter((i) => i.obstacle);
  const mine = block(items, false);
  const theirs = block(fixed, true).map((i) => i.poly);
  const all = checkWalkways(room, [...theirs, ...mine.map((i) => i.poly)]);
  // the walking grid is not cheap: the room without Claude's pieces only where a way is too narrow
  if (all.every((w) => w.fits >= w.width - 0.05)) return [];
  const base = checkWalkways(room, theirs);
  const out: string[] = [];
  for (const [k, w] of all.entries()) {
    // the pieces already in the room are not Claude's to move
    if (w.fits >= w.width - 0.05 || w.fits >= base[k].fits - 0.05) continue;
    const without = mine.filter((m) => {
      const rest = checkWalkways(room, [...theirs, ...mine.filter((o) => o !== m).map((o) => o.poly)])[k];
      return rest.fits >= Math.min(w.width, base[k].fits) - 0.05 || rest.fits >= w.fits + 0.15;
    });
    const who = without.length ? without.map((m) => `„${m.id}“`).join(', ') : 'deine Möbel';
    const free = w.fits === 0 ? 'man kommt nicht mehr durch' : `nur ${Math.round(w.fits * 100)} cm frei`;
    out.push(
      `Nach deinen Startplätzen steht ${who} im Weg zwischen den Türen ${w.from} und ${w.to}: ${free}, gebraucht werden ${Math.round(w.width * 100)} cm (B2). Den Durchgang frei lassen: große Möbel an die türfreien Wandstücke, Bett oder Sofa an die längste Wand ohne Tür (RF4).`,
    );
  }
  return out;
}

/** Floor a piece takes with its movement areas (the solver's minimum strips, solver/items.ts), m². */
function footprintWithMoves(width: number, depth: number, clear: readonly Clearance[]): { stand: number; move: number } {
  let move = 0;
  let either = false;
  for (const c of clear) {
    if (c.either) {
      if (either) continue;
      either = true;
    }
    const part = (c.to ?? 1) - (c.from ?? 0);
    move += (c.side === 'front' || c.side === 'back' ? width : depth) * part * c.min;
  }
  return { stand: width * depth, move };
}

/** Area (m²) of the ways between the doors, each as wide as it must stay, overlaps counted once. */
function wayArea(room: RoomAnalysis): number {
  const segs = room.walkways.flatMap((w) => w.path.slice(1).map((b, i) => ({ a: w.path[i], b, r: w.width / 2 })));
  if (!segs.length) return 0;
  const cell = 0.1;
  // only the cells around each way, on a fixed lattice, each counted once
  const seen = new Set<number>();
  let n = 0;
  for (const sg of segs) {
    const i0 = Math.floor((Math.min(sg.a.x, sg.b.x) - sg.r) / cell);
    const i1 = Math.ceil((Math.max(sg.a.x, sg.b.x) + sg.r) / cell);
    const j0 = Math.floor((Math.min(sg.a.y, sg.b.y) - sg.r) / cell);
    const j1 = Math.ceil((Math.max(sg.a.y, sg.b.y) + sg.r) / cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const key = i * 100003 + j;
        if (seen.has(key)) continue;
        const p = { x: (i + 0.5) * cell, y: (j + 0.5) * cell };
        if (segmentDist(p, sg.a, sg.b) > sg.r) continue;
        seen.add(key);
        if (pointInPolygon(p, room.polygon)) n++;
      }
  }
  return n * cell * cell;
}

function segmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l = d.x * d.x + d.y * d.y;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l)) : 0;
  return Math.hypot(p.x - a.x - t * d.x, p.y - a.y - t * d.y);
}

/**
 * Above this share of the room the programme does not fit: a real run of B Wohnküche needed 104 % and lost
 * six pieces, its passing version 96 %; F Schrankraum (108 %) got a smaller wardrobe. C Küche (104 %) and
 * E Abstellraum (105 %) of the benchmark still fitted, so up to 110 % the message says it gets tight.
 */
const BUDGET = 1.0;
const TIGHT = 1.1;
const SLACK = 0.3;

/**
 * Area budget before the solver (FlairGPT: area per zone first; suggestion of the improvement thread
 * 7.11.): floor and movement area of every piece plus the ways between the doors against the room.
 * Over it, the solver would have to leave pieces out or take smaller ones without asking; Claude is
 * told with the numbers and the optional pieces that take the most floor.
 */
function areaBudget(program: RoomProgram, room: RoomAnalysis, existing: readonly Furniture[], products: readonly CatalogItem[]): string[] {
  if (room.area <= 0) return [];
  const extra = [...products];
  const own = program.items.flatMap((it) => {
    const sp = specOf(it.catalogId, extra);
    if (!sp || sp.base !== 'floor') return [];
    const f = footprintWithMoves(sp.width, sp.depth, sp.clear);
    return [{ id: it.id, required: !!it.required, need: f.stand + f.move }];
  });
  const kitchen = (program.kitchen ?? []).reduce((s, k) => s + dist(k.from, k.to) * (0.6 + 1.0), 0);
  const fixed = existing.reduce((s, f) => {
    const sp = f.catalogId ? specOf(f.catalogId, extra) : undefined;
    const m = footprintWithMoves(f.width, f.depth, sp?.clear ?? []);
    return s + ((f.elevation ?? 0) < 0.05 ? m.stand + m.move : 0);
  }, 0);
  const pieces = own.reduce((s, o) => s + o.need, 0);
  const total = pieces + kitchen + fixed + wayArea(room);
  // and by more than a few tiles: a store room of 2.2 m² with shelves on three walls fills exactly, as planned
  if (total <= room.area * BUDGET + SLACK) return [];
  const optional = own.filter((o) => !o.required).sort((a, b) => b.need - a.need).slice(0, 3);
  const m2 = (v: number) => v.toFixed(1).replace('.', ',');
  return [
    `Dein Programm braucht mit Stell- und Bewegungsflächen und den Wegen zwischen den Türen etwa ${m2(total)} m², der Raum hat ${m2(room.area)} m² (R5). ${total / room.area <= TIGHT ? 'Das wird knapp, sonst lässt der Löser Teile weg oder nimmt sie kleiner.' : 'So muss der Löser Teile weglassen oder kleiner nehmen.'} Streiche oder verkleinere zuerst Optionales${optional.length ? ` (am meisten Boden brauchen ${optional.map((o) => `„${o.id}“ ${m2(o.need)} m²`).join(', ')})` : ''}; Pflichtmöbel bleiben.`,
  ];
}
