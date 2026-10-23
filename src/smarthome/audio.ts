/**
 * Audio setup per room (#138): which kind of loudspeakers fit a room, where they go and how
 * far they sit from walls and listening position. Only generic speaker TYPES – no product
 * models and no prices (nothing is invented; the cost stays "open" until a real product is
 * chosen). Distances are rules of thumb, shown as such. Pure functions; the suggestion
 * becomes devices only when applied (suggestStore).
 */
import { derivePlan, type DerivedPlan } from '../model/derived';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import type { AudioDeviceDef, Furniture, Project, SmartDevice } from '../model/schema';
import { dist, normalize, perp, pointInPolygon, polygonCentroid, sub, type Vec2 } from '../model/vec';
import { guessRoomType, type RoomType } from '../suggest/furnishing';
import type { DeviceProposal, SmartHomeSuggestion } from './suggest';

export type SpeakerType = NonNullable<SmartDevice['speakerType']>;

export const SPEAKER_TYPES: Record<SpeakerType, { label: string; elevation: number; minWallM: number; note: string }> = {
  bookshelf: { label: 'Regallautsprecher', elevation: 1, minWallM: 0.3, note: 'Hochtöner etwa auf Ohrhöhe im Sitzen; Faustregel: mindestens 30 cm Wandabstand, wenn sie hinten Bassreflex-Öffnungen haben' },
  bluetooth: { label: 'Bluetooth-Lautsprecher', elevation: 0.55, minWallM: 0.1, note: 'kompakt, auf Nachttisch oder Regal' },
  soundbar: { label: 'Soundbar', elevation: 0.5, minWallM: 0.05, note: 'unter oder vor dem Fernseher, mittig' },
  subwoofer: { label: 'Subwoofer', elevation: 0, minWallM: 0.1, note: 'auf dem Boden; nahe einer Wand oder Ecke wird der Bass lauter, nahe einer Raumkante dröhnt er leichter' },
  desk: { label: 'Schreibtisch-Lautsprecher', elevation: 0.9, minWallM: 0.1, note: 'links und rechts vom Bildschirm, auf Ohrhöhe, im Dreieck zu dir' },
};

/** Faustregel (Annahme): spacing of a stereo pair ≈ distance to the listener, within these limits (m). */
const SPACING = [1.2, 2.4] as const;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const LISTENER: Partial<Record<RoomType, RegExp>> = {
  living: /sofa|couch|sessel|wohnlandschaft/i,
  bedroom: /bett|bed\b/i,
  office: /schreibtisch|desk/i,
};
const TV = /\btv\b|fernseh|tv-?bank|sideboard/i;
const TV_STRICT = /\btv\b|fernseh/i;

const textOf = (f: Furniture) => `${f.catalogId ?? ''} ${f.name} ${f.category}`;
const inRoom = (p: Vec2, interior: Vec2[]) => pointInPolygon(p, interior);

/** What the user wants changed ("Design nicht gut", "kompakter" …) – read from free text. */
export interface AudioWishes {
  /** fewer and smaller devices (no subwoofer, no pair where one is enough) */
  compact: boolean;
  /** discreet look: soundbar/Bluetooth instead of visible pairs */
  discreet: boolean;
  /** explicitly with / without subwoofer; undefined = type decides */
  subwoofer?: boolean;
}

export const NO_WISHES: AudioWishes = { compact: false, discreet: false };

export function parseWishes(text: string): AudioWishes {
  const t = text.toLowerCase();
  const w: AudioWishes = { compact: false, discreet: false };
  if (/kompakt|kleiner|platzsparend|weniger platz|günstig|guenstig|billiger|sparsam/.test(t)) w.compact = true;
  if (/design|optik|aussehen|unauffällig|unauffaellig|dezent|hässlich|haesslich|schöner|schoener/.test(t)) w.discreet = true;
  if (/(kein|ohne)\s+(sub|bass)/.test(t)) w.subwoofer = false;
  else if (/subwoofer|mehr bass|bass/.test(t)) w.subwoofer = true;
  return w;
}

/** Distance (m) from p to the nearest edge of the polygon and the point on it. */
export function nearestEdge(p: Vec2, poly: Vec2[]): { distance: number; point: Vec2 } {
  let best = { distance: Infinity, point: poly[0] };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.distance) best = { distance: d, point: q };
  });
  return best;
}

/** First point where the ray from `from` along unit `dir` leaves the polygon (null if it does not). */
function rayExit(from: Vec2, dir: Vec2, poly: Vec2[]): Vec2 | null {
  let bestT = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) return;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const u = ((a.x - from.x) * dir.y - (a.y - from.y) * dir.x) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < bestT) bestT = t;
  });
  return Number.isFinite(bestT) ? { x: from.x + dir.x * bestT, y: from.y + dir.y * bestT } : null;
}

const toward = (from: Vec2, to: Vec2) => Math.atan2(to.y - from.y, to.x - from.x);

interface Place {
  type: SpeakerType;
  x: number;
  y: number;
  rotation: number;
  elevation: number;
  reason: string;
}

/** Stereo pair on the far side of the room, facing the listener; falls back to one soundbar/Bluetooth speaker. */
function livingSetup(listener: Furniture | undefined, tv: Furniture | undefined, interior: Vec2[], w: AudioWishes): Place[] {
  const centre = polygonCentroid(interior);
  const L: Vec2 = listener ? { x: listener.x, y: listener.y } : centre;
  let F: Vec2 | null = null;
  if (tv) F = { x: tv.x, y: tv.y };
  else {
    const dir = normalize(sub(centre, L));
    const exit = dist(centre, L) > 0.2 ? rayExit(L, dir, interior) : null;
    if (exit) F = { x: exit.x - dir.x * 0.4, y: exit.y - dir.y * 0.4 };
  }
  if (!F || dist(F, L) < 0.8) return [];
  const axis = normalize(sub(L, F));
  const side = perp(axis);
  const listenDist = dist(F, L);
  const out: Place[] = [];
  if (w.compact || w.discreet) {
    const type: SpeakerType = tv ? 'soundbar' : 'bluetooth';
    out.push({ type, x: r3(F.x), y: r3(F.y), rotation: toward(F, L), elevation: SPEAKER_TYPES[type].elevation, reason: tv ? 'mittig beim Fernseher, spart Platz und fällt kaum auf' : 'ein kompakter Lautsprecher an der Stirnseite' });
  } else {
    const half = Math.min(SPACING[1], Math.max(SPACING[0], listenDist)) / 2;
    for (const s of [-1, 1]) {
      let p = { x: F.x + side.x * half * s, y: F.y + side.y * half * s };
      if (!inRoom(p, interior)) p = { x: F.x + side.x * 0.5 * s, y: F.y + side.y * 0.5 * s };
      out.push({ type: 'bookshelf', x: r3(p.x), y: r3(p.y), rotation: toward(p, L), elevation: SPEAKER_TYPES.bookshelf.elevation, reason: `${s < 0 ? 'links' : 'rechts'} ${tv ? 'neben dem Fernseher' : 'an der Stirnseite'}, auf dich ausgerichtet (Stereo-Dreieck)` });
    }
  }
  if (w.subwoofer ?? (!w.compact && !w.discreet)) {
    const p = { x: F.x + side.x * -(SPACING[0] / 2 + 0.5), y: F.y + side.y * -(SPACING[0] / 2 + 0.5) };
    out.push({ type: 'subwoofer', ...(inRoom(p, interior) ? { x: r3(p.x), y: r3(p.y) } : { x: r3(F.x), y: r3(F.y) }), rotation: toward(p, L), elevation: 0, reason: 'auf dem Boden neben der linken Box' });
  }
  return out;
}

function officeSetup(desk: Furniture, interior: Vec2[], w: AudioWishes): Place[] {
  const c = furnitureCorners(desk);
  const centre: Vec2 = { x: desk.x, y: desk.y };
  const wall = nearestEdge(centre, interior).point;
  // listener sits on the side away from the wall → speakers fire away from it
  const away = normalize(sub(centre, wall));
  const axis = c.length >= 2 ? normalize(sub(c[1], c[0])) : { x: 1, y: 0 };
  const along = Math.abs(axis.x * away.x + axis.y * away.y) > 0.7 ? perp(axis) : axis;
  const wide = desk.width > 1 ? desk.width : desk.depth;
  const half = Math.max(0.3, Math.min(0.55, wide / 2 - 0.15));
  const top = desk.elevation + desk.height;
  const rot = Math.atan2(away.y, away.x);
  if (w.compact || w.discreet) return [{ type: 'bluetooth', x: r3(desk.x), y: r3(desk.y), rotation: rot, elevation: r3(top), reason: 'ein kompakter Lautsprecher auf dem Schreibtisch' }];
  return [-1, 1].map((s) => ({ type: 'desk' as const, x: r3(desk.x + along.x * half * s), y: r3(desk.y + along.y * half * s), rotation: rot, elevation: r3(top), reason: `${s < 0 ? 'links' : 'rechts'} vom Bildschirm, auf Schreibtischhöhe (im Dreieck zu dir)` }));
}

function bedroomSetup(bed: Furniture, interior: Vec2[]): Place[] {
  const wall = nearestEdge({ x: bed.x, y: bed.y }, interior).point;
  const away = normalize(sub({ x: bed.x, y: bed.y }, wall));
  const side = perp(away);
  const off = bed.width / 2 + 0.3;
  const p = { x: bed.x + side.x * off, y: bed.y + side.y * off };
  const q = inRoom(p, interior) ? p : { x: bed.x - side.x * off, y: bed.y - side.y * off };
  return [{ type: 'bluetooth', x: r3(q.x), y: r3(q.y), rotation: toward(q, { x: bed.x, y: bed.y }), elevation: SPEAKER_TYPES.bluetooth.elevation, reason: 'neben dem Bett auf Nachttisch-Höhe, leise Hörlautstärke reicht' }];
}

/**
 * Audio setup per room. Rooms without a listening place (no sofa/bed/desk) get no proposal –
 * the note says so instead of guessing. Existing speakers in the room are respected (nothing
 * proposed twice).
 */
export function suggestAudio(project: Project, roomIds?: string[], wishes: AudioWishes = NO_WISHES, types: Record<string, RoomType> = {}): SmartHomeSuggestion {
  const derived = derivePlan(project);
  const items: DeviceProposal[] = [];
  const later: SmartHomeSuggestion['later'] = [];
  const nameCount = new Map<string, number>();
  for (const room of project.rooms) {
    if (roomIds && !roomIds.includes(room.id)) continue;
    const g = derived.rooms.get(room.id);
    if (!g) continue;
    const type = types[room.id] ?? guessRoomType(room.name);
    const re = LISTENER[type];
    if (!re) continue;
    if (project.devices.some((d) => d.kind === 'speaker' && inRoom(d, g.interior))) {
      later.push({ roomId: room.id, text: 'hat schon Lautsprecher – nichts Neues vorgeschlagen' });
      continue;
    }
    const mine = project.furniture.filter((f) => inRoom(f, g.interior));
    const listener = mine.find((f) => re.test(textOf(f)));
    let places: Place[] = [];
    if (type === 'living') places = livingSetup(listener, mine.find((f) => TV_STRICT.test(textOf(f))) ?? mine.find((f) => TV.test(textOf(f))), g.interior, wishes);
    else if (!listener) places = [];
    else if (type === 'office') places = officeSetup(listener, g.interior, wishes);
    else if (type === 'bedroom') places = bedroomSetup(listener, g.interior);
    if (!places.length) {
      later.push({ roomId: room.id, text: type === 'living' ? 'kein Sofa oder keine Stirnseite gefunden – Lautsprecher von Hand platzieren' : `${type === 'office' ? 'kein Schreibtisch' : 'kein Bett'} im Raum – erst Möbel stellen oder Lautsprecher von Hand platzieren` });
      continue;
    }
    for (const [i, p] of places.entries()) {
      const base = `${SPEAKER_TYPES[p.type].label} ${room.name}`;
      const n = (nameCount.get(base) ?? 0) + 1;
      nameCount.set(base, n);
      items.push({
        key: `${room.id}:speaker:${i}`,
        roomId: room.id,
        kind: 'speaker',
        speakerType: p.type,
        name: n > 1 ? `${base} ${n}` : base,
        x: p.x,
        y: p.y,
        rotation: p.rotation,
        elevation: p.elevation,
        reason: p.reason,
      });
    }
  }
  // no products, hence no prices: every item stays "open"
  return { items, coverage: [], cost: { min: 0, max: 0, unknown: items.length }, later };
}

/** Smallest signed difference of two angles (rad), in (-π, π]. */
const angleDiff = (a: number, b: number) => {
  const d = (a - b) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d;
};

/** Size line of an own device, e.g. „20 × 25 × 30 cm“ (width × depth × height). */
export const defSizeText = (def: AudioDeviceDef) => `${[def.widthM, def.depthM, def.heightM].map((m) => String(Math.round(m * 1000) / 10).replace('.', ',')).join(' × ')} cm`;

export interface SpeakerHint {
  ok: boolean;
  text: string;
}

/** Distances of a placed speaker to the nearest wall and to the listening place of its room. */
export function speakerHints(project: Project, derived: DerivedPlan, d: SmartDevice): SpeakerHint[] {
  const room = project.rooms.find((r) => {
    const g = derived.rooms.get(r.id);
    return g && inRoom(d, g.interior);
  });
  const g = room && derived.rooms.get(room.id);
  if (!room || !g) return [{ ok: false, text: 'Der Lautsprecher steht außerhalb der Räume.' }];
  const spec = SPEAKER_TYPES[d.speakerType ?? 'bookshelf'];
  const def = project.audioCatalog.find((x) => x.id === d.audioDefId);
  const hints: SpeakerHint[] = [];
  // own device: the wall distance is measured from the housing, not from its centre (#336)
  const wall = Math.max(0, nearestEdge(d, g.interior).distance - (def ? def.depthM / 2 : 0));
  const fmt = (m: number) => `${m.toFixed(2).replace('.', ',')} m`;
  if (d.speakerType === 'subwoofer') hints.push({ ok: true, text: `Abstand zur Wand ${fmt(wall)} – ${spec.note}.` });
  else hints.push(wall >= spec.minWallM ? { ok: true, text: `Abstand zur Wand ${fmt(wall)} (Faustregel ab ${fmt(spec.minWallM)}).` } : { ok: false, text: `Nur ${fmt(wall)} bis zur Wand – Faustregel ab ${fmt(spec.minWallM)}, sonst wird der Bass dröhnig.` });
  const type = guessRoomType(room.name);
  const re = LISTENER[type];
  const listener = re && project.furniture.filter((f) => inRoom(f, g.interior)).find((f) => re.test(textOf(f)));
  if (listener) {
    const l = dist(d, listener);
    hints.push({ ok: l >= 0.5, text: `${fmt(l)} bis „${listener.name}“ (Hörplatz). ${spec.note}.` });
    if (def?.coverageDeg && def.coverageDeg < 360 && d.speakerType !== 'subwoofer') {
      const off = Math.abs(angleDiff(Math.atan2(listener.y - d.y, listener.x - d.x), d.rotation)) * (180 / Math.PI);
      hints.push(off <= def.coverageDeg / 2 ? { ok: true, text: `Der Hörplatz liegt im Abstrahlwinkel (${Math.round(def.coverageDeg)}°, ${Math.round(off)}° von der Mitte).` } : { ok: false, text: `Der Hörplatz liegt ${Math.round(off)}° neben der Blickrichtung – außerhalb des Abstrahlwinkels von ${Math.round(def.coverageDeg)}° (halb: ${Math.round(def.coverageDeg / 2)}°). Box drehen.` });
    }
    const mate = project.devices.find((o) => o.id !== d.id && o.kind === 'speaker' && o.speakerType === d.speakerType && inRoom(o, g.interior));
    if (mate && (d.speakerType === 'bookshelf' || d.speakerType === 'desk')) {
      const gap = dist(d, mate);
      const mid = { x: (d.x + mate.x) / 2, y: (d.y + mate.y) / 2 };
      const ld = dist(mid, listener);
      hints.push(gap >= 0.6 && gap <= ld * 1.4 + 0.3 ? { ok: true, text: `Abstand der beiden Boxen ${fmt(gap)}, Hörplatz ${fmt(ld)} entfernt (Stereo-Dreieck passt grob).` } : { ok: false, text: `Abstand der beiden Boxen ${fmt(gap)} bei ${fmt(ld)} Hörabstand – Faustregel: etwa gleich groß.` });
    }
  } else hints.push({ ok: true, text: `Kein ${type === 'living' ? 'Sofa' : type === 'bedroom' ? 'Bett' : 'Schreibtisch'} im Raum erkannt – Hörplatz selbst prüfen.` });
  return hints;
}
