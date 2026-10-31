/**
 * Stage 1 (mgritsch04/wohnungsplaner-3d#439): the flat concept. One request for the whole flat,
 * like the first meeting with an interior designer: who lives here, which room takes which
 * function, style and palette. The app checks the answer (every wish has a room, the single
 * functions only once, a bedroom sleeps, no new sanitary objects) and asks Claude once to repair
 * what is wrong. From here on the room type of the concept is the one the whole pipeline uses.
 */
import { clipLines, type DesignWishes, MAX_FIELD, apartmentPalette } from '../../assistant/design';
import type { Furniture, Project } from '../../model/schema';
import { guessRoomType, ROOM_TYPES } from '../../suggest/furnishing';
import { parseScheme } from './scheme';
import type { FlatAnalysis, FlatConcept, FunctionAssignment, RoomAnalysis, PaletteRole, RoomConcept, RoomType, StylePlan } from '../types';
import { type Checked, hex, key, SANITARY, shapeOf, str, strList } from './common';
import { isCooking, isSleeping, SINGLE_FUNCTIONS } from './needs';

export interface FlatConceptInput {
  project: Project;
  analysis: FlatAnalysis;
  /** Overview of the flat as text for Claude (stage 0): rooms, sizes, doors, windows, what is there. */
  sketch: string;
  wishes: DesignWishes;
}

/** A wish of the residents, numbered for the answer („Wunsch 3“). */
export interface Wish {
  n: number;
  text: string;
}

/** The residents' wishes, one per line of interests, needs and wants (style and colours are not functions). */
export function wishList(w: DesignWishes): Wish[] {
  const lines = [w.interests, w.needs, w.wants].flatMap((v) => clipLines(v, MAX_FIELD).split('\n')).filter(Boolean);
  return [...new Set(lines)].map((text, i) => ({ n: i + 1, text }));
}

export const existingIn = (project: Project, room: Pick<RoomAnalysis, 'existing'>): Furniture[] => project.furniture.filter((f) => room.existing.includes(f.id));

const ROOM_TYPE_IDS = ROOM_TYPES.map((t) => t.id);

/** Room type as Claude may write it: the id (living …) or a German name (Wohnzimmer, Gang …); null when unknown. */
export function parseRoomType(v: unknown): RoomType | null {
  const s = str(v, 40).toLowerCase();
  if (!s) return null;
  const id = ROOM_TYPE_IDS.find((t) => t === s);
  if (id) return id;
  const byLabel = ROOM_TYPES.find((t) => t.label.toLowerCase() === s)?.id;
  if (byLabel) return byLabel;
  if (/^(wc|toilet|toilette)$/.test(s)) return 'bath';
  if (/^(storage|storeroom|abstellraum)$/.test(s)) return 'utility';
  const guess = guessRoomType(s);
  return guess === 'other' ? (s === 'sonstiges' ? 'other' : null) : guess;
}

/** Shares of the palette (SL2). */
const ROLES: PaletteRole[] = ['haupt', 'zweit', 'akzent', 'neutral'];
const SHARE: Record<PaletteRole, string> = { haupt: 'Hauptfarbe 60 %', zweit: 'Zweitfarbe 30 %', akzent: 'Akzent 10 %', neutral: 'neutral' };

/** A palette colour for a prompt: „Salbei #8a9a7b (Zweitfarbe 30 %)“. */
export const paletteText = (c: StylePlan['palette'][number]): string => `${c.name} ${c.hex}${c.role ? ` (${SHARE[c.role]})` : ''}`;

const FORMAT = `{"living":"2–3 Sätze",
 "style":{"idea":"Leitidee in einem Satz","materials":["Eiche hell geölt","…"],"forms":"ein Satz","palette":[{"name":"…","hex":"#rrggbb","role":"haupt"}]},
 "functions":[{"function":"Schlafen","room":"<Raumname>","why":"…","wishes":[2]}],
 "rooms":[{"room":"<Raumname>","type":"bedroom","role":"ein Satz","functions":["Schlafen","Kleidung"],"anchors":["Doppelbett 160 mit Kopfteil an der ruhigen Wand"],"accent":"#rrggbb","avoid":["…"]}]}`;

/** The prompt for the flat concept. */
export function buildFlatConceptPrompt(input: FlatConceptInput): string {
  const { project, analysis, sketch, wishes } = input;
  const wl = wishList(wishes);
  const zones = analysis.rooms.flatMap((r) => r.userZones.map((z) => `- ${r.name}, Bereich ${z.id}: „${z.purpose || 'ohne Angabe'}“${z.keepFree ? ' (bleibt frei)' : ''}`));
  const palette = apartmentPalette(wishes);
  return `Du bist eine erfahrene Innenarchitektin. Bevor du einzelne Räume einrichtest, machst du ein Wohnkonzept für die ganze Wohnung, so wie beim ersten Termin: Wer wohnt hier, was passiert im Alltag, welcher Raum übernimmt welche Aufgabe, welcher Stil und welche Farben verbinden alles.

Wohnung „${project.name}“ (Räume, Fläche, Türen, Fenster, was schon fest eingebaut ist):
${sketch}

Wünsche der Bewohner (jeder Wunsch muss in "functions" bei "wishes" mindestens einmal vorkommen):
${wl.length ? wl.map((w) => `Wunsch ${w.n}: ${w.text}`).join('\n') : '(keine besonderen Wünsche – plane, was man zum Wohnen braucht)'}
Stil: ${str(wishes.style, MAX_FIELD) || 'frei'}. Farbideen: ${palette.join(', ')}.
${wishes.budget > 0 ? `Budget für alles zusammen: ${Math.round(wishes.budget)} € – lieber weniger, dafür passend.` : 'Kein festes Budget, aber nichts Überflüssiges.'}
${zones.length ? `Vom Nutzer im Plan markierte Bereiche (gelten so):\n${zones.join('\n')}\n` : ''}
Aufgabe:
1. Nutzung: Beschreibe in 2–3 Sätzen, wie hier gewohnt wird (Alltag, Gäste, Hobbys).
2. Funktionen verteilen: Ordne jede Funktion GENAU EINEM Raum zu, mit Grund. Funktionen sind zum Beispiel Schlafen, Kleidung, Kochen, Essen, Sitzen/Fernsehen, Lesen, Arbeiten/PC, Gästeschlafplatz, Vorräte/Stauraum, Garderobe/Schuhe, Wäsche, Körperpflege, Draußen sitzen, dazu jede Funktion aus den Wünschen. "wishes" nennt die Nummern der Wünsche, die diese Funktion erfüllt.
3. Esstisch, Gästeschlafplatz und Küchenzeile gibt es in der Wohnung nur einmal. Plane nichts doppelt, was niemand doppelt braucht (zwei Esstische, zwei Gästebetten, zwei Fernsehplätze).
4. Je Raum: Raumtyp (${ROOM_TYPE_IDS.join(', ')}; ein WC ist bath), Rolle in einem Satz, Funktionen, 1–3 Ankermöbel (das, worum der Raum gebaut wird), Akzentfarbe aus der Palette, ein Farbschema des Raums ("scheme": wall, furniture, textile, accent – alle aus der Palette, die Wand darf eine hellere Abstufung der Hauptfarbe sein; Räume dürfen unterschiedlich wirken, gehören aber zur selben Palette, und innerhalb des Raums passen Wand, Möbel, Textilien und Deko zusammen; "note": die Stimmung in einem Satz) und was dort ausdrücklich NICHT hinkommt. Ein Schlafzimmer bekommt die Funktion Schlafen. Jeder Raum der Wohnung kommt genau einmal vor, mit seinem Namen wie oben.
5. Stil wie ein Profi, für die ganze Wohnung (SL1): Leitidee in einem Satz. Palette mit 4–5 Farben (Hex), jede mit Rolle: "haupt" (60 %: Wände, große Flächen, große Möbel), "zweit" (30 %: Möbel, Textilien), "akzent" (10 %: Kissen, Sessel, Bild, Vase), dazu "neutral" (SL2). Materialien, die wiederkehren: höchstens 2–3 Holztöne, eine Metallfarbe, 2–3 Textilien (SL3). "forms": Formensprache in einem Satz, z. B. schlanke Beine, Rundes zu Eckigem, Texturen zu glatten Flächen (SL4, SL5). Daran richten sich später alle Möbel und die echten Produkte aus.
6. Grenzen: WC, Waschtisch, Dusche und Wanne sind fest eingebaut und werden nicht dazugeplant und nicht verschoben. Nur in einem WC ohne Waschbecken kommt ein kleines Handwaschbecken dazu. Ein Durchgangszimmer behält seinen Weg frei. Eine vorhandene Küche bleibt, wie sie ist.

Antworte nur mit JSON in dieser Form:
${FORMAT}`;
}

/** Everything the checks need to know about the flat. */
interface FlatFacts {
  rooms: RoomAnalysis[];
  existing: Map<string, Furniture[]>;
  wishes: Wish[];
}

function facts(input: FlatConceptInput): FlatFacts {
  return { rooms: input.analysis.rooms, existing: new Map(input.analysis.rooms.map((r) => [r.roomId, existingIn(input.project, r)])), wishes: wishList(input.wishes) };
}

const SANITARY_WORDS: [RegExp, string][] = [
  [/\b(wc|toilette|klo)\b/i, 'toilet'],
  [/\b(dusche|duschkabine)\b/i, 'shower'],
  [/\b(badewanne|wanne)\b/i, 'bathtub'],
  [/\b(waschtisch|waschbecken|lavabo)\b/i, 'washbasin'],
];

/** May a room get a (small) washbasin: a WC with a toilet but no basin. */
export const wantsHandBasin = (existing: readonly Furniture[]) => existing.some((f) => shapeOf(f) === 'toilet') && !existing.some((f) => shapeOf(f) === 'washbasin');

/**
 * Parses and checks the flat concept answer. Room names (or ids) are matched to the rooms of
 * the flat; the function list and the rooms' functions are made to agree.
 */
export function parseFlatConcept(raw: unknown, input: FlatConceptInput): Checked<FlatConcept> {
  const f = facts(input);
  const problems: string[] = [];
  const notes: string[] = [];
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (o !== raw) problems.push('Die Antwort ist kein JSON-Objekt der verlangten Form.');
  const byName = new Map(f.rooms.flatMap((r) => [[key(r.name), r] as const, [key(r.roomId), r] as const]));
  const roomOf = (v: unknown) => byName.get(key(str(v, 80)));

  // style
  const s = (o.style && typeof o.style === 'object' ? o.style : {}) as Record<string, unknown>;
  const palette = (Array.isArray(s.palette) ? s.palette : [])
    .map((c) => {
      const e = (c ?? {}) as Record<string, unknown>;
      const h = hex(e.hex ?? (typeof c === 'string' ? /#[0-9a-f]{3,6}/i.exec(c)?.[0] : undefined));
      const role = ROLES.find((r) => r === str(e.role, 20).toLowerCase());
      return h ? { name: str(e.name ?? (typeof c === 'string' ? c.replace(/#[0-9a-f]{3,6}/i, '') : ''), 40) || h, hex: h, ...(role ? { role } : {}) } : null;
    })
    .filter((c): c is StylePlan['palette'][number] => !!c)
    .slice(0, 8);
  if (!palette.length) problems.push('"style.palette" braucht 4–5 Farben mit gültigem Hex-Wert (#rrggbb).');
  const forms = str(s.forms, 300);
  const style: StylePlan = { idea: str(s.idea), materials: strList(s.materials, 80, 12), palette, ...(forms ? { forms } : {}) };
  if (!style.idea) problems.push('"style.idea" (Leitidee) fehlt.');

  // rooms
  const rooms: RoomConcept[] = [];
  for (const r of Array.isArray(o.rooms) ? o.rooms : []) {
    const e = (r ?? {}) as Record<string, unknown>;
    const room = roomOf(e.room ?? e.name ?? e.roomId);
    if (!room) {
      problems.push(`Raum „${str(e.room ?? e.name, 80)}“ gibt es in der Wohnung nicht – nur diese Namen verwenden: ${f.rooms.map((x) => x.name).join(', ')}.`);
      continue;
    }
    if (rooms.some((x) => x.roomId === room.roomId)) {
      problems.push(`Raum „${room.name}“ steht mehrmals in "rooms".`);
      continue;
    }
    const type = parseRoomType(e.type);
    if (!type) problems.push(`Raum „${room.name}“: Raumtyp „${str(e.type, 40)}“ ist unbekannt (erlaubt: ${ROOM_TYPE_IDS.join(', ')}).`);
    const accent = hex(e.accent);
    if (e.accent !== undefined && !accent) notes.push(`Raum „${room.name}“: Akzentfarbe „${str(e.accent, 20)}“ ist kein Hex-Wert, weggelassen.`);
    const anchors = strList(e.anchors ?? e.anchor, 200, 5);
    const roomType = type ?? guessRoomType(room.name);
    const scheme = parseScheme(e.scheme ?? e.farbschema, style, roomType, accent ?? undefined, room.name, notes);
    rooms.push({ roomId: room.roomId, type: roomType, role: str(e.role, 300), functions: strList(e.functions, 80, 15), anchors, ...(accent ? { accent } : {}), ...(scheme ? { scheme } : {}), avoid: strList(e.avoid, 200, 12) });
  }
  for (const r of f.rooms) if (!rooms.some((x) => x.roomId === r.roomId)) problems.push(`Raum „${r.name}“ fehlt in "rooms".`);

  // functions, each with one room
  const functions: FunctionAssignment[] = [];
  const covered = new Set<number>();
  for (const a of Array.isArray(o.functions) ? o.functions : []) {
    const e = (a ?? {}) as Record<string, unknown>;
    const fn = str(e.function, 80);
    const room = roomOf(e.room ?? e.roomId);
    if (!fn) continue;
    if (!room) {
      problems.push(`Funktion „${fn}“: Raum „${str(e.room, 80)}“ gibt es nicht.`);
      continue;
    }
    for (const n of Array.isArray(e.wishes) ? e.wishes : [e.wishes]) {
      const k = typeof n === 'number' ? n : Number(/\d+/.exec(String(n ?? ''))?.[0]);
      if (Number.isInteger(k)) covered.add(k);
    }
    functions.push({ function: fn, roomId: room.roomId, why: str(e.why, 400) });
    // the room's own list names the function too
    const rc = rooms.find((x) => x.roomId === room.roomId);
    if (rc && !rc.functions.some((x) => key(x) === key(fn))) {
      rc.functions.push(fn);
      notes.push(`Funktion „${fn}“ bei Raum „${room.name}“ ergänzt.`);
    }
  }
  if (!functions.length) problems.push('"functions" ist leer.');
  const twice = functions.filter((a, i) => functions.findIndex((b) => key(b.function) === key(a.function)) !== i && a.roomId !== functions.find((b) => key(b.function) === key(a.function))!.roomId);
  for (const a of twice) notes.push(`Funktion „${a.function}“ ist mehreren Räumen zugeordnet.`);

  const value: FlatConcept = { living: str(o.living, 800), style, functions, rooms };
  if (!value.living) problems.push('"living" (wie hier gewohnt wird) fehlt.');
  problems.push(...checkFlatConcept(value, f, covered));
  return { value, problems, notes };
}

/** Checks of the concept beyond its form (problems as texts for the repair request). */
function checkFlatConcept(c: FlatConcept, f: FlatFacts, covered: Set<number>): string[] {
  const problems: string[] = [];
  const nameOf = (id: string) => f.rooms.find((r) => r.roomId === id)?.name ?? id;
  // the wish numbers Claude gave; without them (older answers) the wish's words in the concept
  const corpus = key([...c.functions.flatMap((a) => [a.function, a.why]), ...c.rooms.flatMap((r) => [...r.functions, ...r.anchors, r.role])].join(' '));
  const mentioned = (w: Wish) => {
    const words = wishWords(w.text);
    return words.length > 0 && words.every((s) => [s, ...(WORD_ALIASES[s] ?? [])].some((x) => corpus.includes(x)));
  };
  for (const w of f.wishes) if (!covered.has(w.n) && !mentioned(w)) problems.push(`Wunsch ${w.n} „${w.text}“ ist keiner Funktion zugeordnet (in "functions" bei "wishes" angeben).`);
  // single functions in one room only
  for (const sf of SINGLE_FUNCTIONS) {
    const where = new Set([...c.functions.filter((a) => sf.test.test(a.function)).map((a) => a.roomId), ...c.rooms.filter((r) => r.functions.some((x) => sf.test.test(x))).map((r) => r.roomId)]);
    if (where.size > 1) problems.push(`${sf.label} ist in mehreren Räumen geplant (${[...where].map(nameOf).join(', ')}) – nur einen Raum dafür wählen.`);
  }
  if (!c.functions.some((a) => isCooking(a.function)) && !c.rooms.some((r) => r.functions.some(isCooking))) problems.push('Kochen ist keinem Raum zugeordnet.');
  if (!c.rooms.some((r) => r.functions.some(isSleeping))) problems.push('Kein Raum hat die Funktion Schlafen.');
  for (const r of c.rooms) {
    if ((r.type === 'bedroom' || r.type === 'kids') && !r.functions.some(isSleeping)) problems.push(`Raum „${nameOf(r.roomId)}“ ist ein Schlafzimmer, hat aber nicht die Funktion Schlafen.`);
    // sanitary objects are fixed: only what is there, plus a hand basin in a WC without one
    const there = new Set((f.existing.get(r.roomId) ?? []).map(shapeOf).filter((s) => SANITARY.has(s)));
    for (const text of [...r.anchors, ...r.functions]) {
      for (const [re, kind] of SANITARY_WORDS) {
        if (!re.test(text) || there.has(kind)) continue;
        if (kind === 'washbasin' && /handwasch/i.test(text) && wantsHandBasin(f.existing.get(r.roomId) ?? [])) continue;
        if (/\b(kein|ohne|nicht)\b/i.test(text)) continue;
        problems.push(`Raum „${nameOf(r.roomId)}“: „${text}“ plant ein Sanitärobjekt, das es dort nicht gibt – WC, Waschtisch, Dusche und Wanne sind fest eingebaut.`);
      }
    }
  }
  return problems;
}

const STOP_WORDS = new Set(['viel', 'viele', 'für', 'mit', 'ohne', 'und', 'oder', 'eine', 'einen', 'ein', 'der', 'die', 'das', 'gemütliche', 'gemütlicher', 'gemütliches', 'schöne', 'schöner', 'große', 'großer', 'kleine', 'kleiner', 'platz']);

/** Stems that a concept may write differently („Monitor“ → „PC“). */
const WORD_ALIASES: Record<string, string[]> = { monit: ['pc', 'compu', 'schre', 'bilds'], spie: ['gaming', 'zocken', 'konsole', 'pc'], compu: ['pc'], tv: ['fernseh'], ferns: ['tv'] };

/** Stems of the words of a wish that a concept would repeat („Esstisch für 4“ → „esst“). */
export function wishWords(text: string): string[] {
  return key(text)
    .split(/[^a-zäöüß0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => w.slice(0, Math.min(w.length, w.length > 6 ? 5 : 4)));
}

const MAX_ANSWER = 24_000;

/**
 * Repair request: the original prompt, Claude's last answer and what the app found. Used for
 * both stages.
 */
export function repairPrompt(prompt: string, answer: unknown, problems: readonly string[]): string {
  let last: string;
  try {
    last = JSON.stringify(answer) ?? String(answer);
  } catch {
    last = String(answer);
  }
  return `${prompt}

Deine letzte Antwort:
${last.slice(0, MAX_ANSWER)}

Die Prüfung der App hat dabei Folgendes gefunden:
${problems.map((p) => `- ${p}`).join('\n')}

Behebe genau diese Punkte und lass alles andere, wie es war. Antworte wieder nur mit dem vollständigen JSON in derselben Form.`;
}

/** Concept of a room, or a neutral one when the concept left the room out. */
export function roomConceptOf(c: FlatConcept, room: Pick<RoomAnalysis, 'roomId' | 'name'>): RoomConcept {
  return c.rooms.find((r) => r.roomId === room.roomId) ?? { roomId: room.roomId, type: guessRoomType(room.name), role: '', functions: [], anchors: [], avoid: [] };
}
