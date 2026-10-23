/**
 * Smart-home concept for the whole apartment (#375).
 *
 * Builds on the per-room suggestion (#225): `suggestSmartHome` places the devices (sensors where
 * the datasheet range covers the floor, contacts on windows/outer doors, bulbs for existing
 * lights). Claude (same connection as #350) plans the whole apartment on top of that: which of
 * the placed devices make sense, in which order to buy them, scenes across rooms, network and
 * open questions. Claude never invents products, positions or prices: it can only refer to the
 * placed devices by key (K1, K2 …); the app computes the budget from the catalogue prices
 * (datasheet research, docs/smart-home/HARDWARE_AND_DEVICES.md) and the central unit from a fixed,
 * sourced list. Without Claude the same structure is filled by rules (CONCEPT.md §4/§5).
 */
import { z } from 'zod';
import type { PlanSummary } from '../assistant/planSummary';
import { derivePlan } from '../model/derived';
import type { Project, SmartDeviceKind } from '../model/schema';
import { guessRoomType, ROOM_TYPES, type RoomType } from '../suggest/furnishing';
import { roomAt } from './actions';
import { KIND_LABEL, productById } from './catalog';
import { recommendBands } from './wifi';
import type { DeviceProposal, SmartHomeSuggestion } from './suggest';

export type Phase = 1 | 2 | 3;
export const PHASES: Phase[] = [1, 2, 3];
export const DEFAULT_PHASE_TITLE: Record<Phase, string> = { 1: 'Zuerst', 2: 'Danach', 3: 'Später' };
const DEFAULT_PHASE_WHY: Record<Phase, string> = {
  1: 'Zentrale, Melder und Kontakte: tragen die Szenen und sind günstig.',
  2: 'Smarte Lampen und Präsenz in den Wohnräumen.',
  3: 'Zusatzgeräte, wenn das Grundsystem läuft.',
};
export const KIND_PHASE: Record<SmartDeviceKind, Phase> = { motion: 1, contact: 1, presence: 2, light: 2, strip: 2, speaker: 3, plug: 3, router: 1, blind: 3 };

export const MAX_FIELD = 300;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export interface ConceptWishes {
  /** Alltag: who lives here, working from home, … */
  habits: string;
  wants: string;
  /** Upper limit in EUR for devices and central unit; 0 = none. */
  budget: number;
}
export const EMPTY_CONCEPT_WISHES: ConceptWishes = { habits: '', wants: '', budget: 0 };

export interface ConceptItem extends DeviceProposal {
  phase: Phase;
}

export interface ConceptScene {
  name: string;
  trigger: string;
  actions: string;
  roomIds: string[];
}

export interface ConceptRoom {
  roomId: string;
  type: RoomType;
  /** One sentence: what this room does in the concept. */
  role: string;
}

export interface CentralPart {
  id: string;
  name: string;
  /** EUR, from the cited page (Stand 2026-10-16, check before buying). */
  price: number;
  why: string;
  source: string;
}

const HA_GREEN: CentralPart = { id: 'ha-green', name: 'Home Assistant Green', price: 179.9, why: 'lokale Zentrale, läuft ohne Cloud', source: 'https://www.shelly.com/de/products/home-assistant-green' };
const ZBT2: CentralPart = { id: 'ha-zbt2', name: 'Home Assistant Connect ZBT-2 (Zigbee)', price: 45, why: 'Funkstick für die Zigbee-Geräte', source: 'https://www.home-assistant.io/blog/2025/11/19/home-assistant-connect-zbt-2' };
const ZBT2_THREAD: CentralPart = { id: 'ha-zbt2-thread', name: 'Zweiter ZBT-2 (Thread)', price: 45, why: 'Funkstick für die Thread/Matter-Geräte', source: ZBT2.source };
const VOICE: CentralPart = { id: 'ha-voice-pe', name: 'Home Assistant Voice Preview Edition', price: 59, why: 'lokale Sprachsteuerung (UVP)', source: 'https://thepihut.com/products/home-assistant-voice-preview-edition' };

export interface ConceptNetwork {
  /** Claude's (or the rules') reasoning for the radio standards. */
  note: string;
  /** Facts computed from the chosen devices. */
  facts: string[];
}

export interface ConceptQuestion {
  question: string;
  proposal: string;
}

export interface SmartHomeConcept {
  source: 'claude' | 'rules';
  summary: string;
  rooms: ConceptRoom[];
  items: ConceptItem[];
  /** Placed devices Claude left out, with its reason. */
  left: { name: string; reason: string }[];
  scenes: ConceptScene[];
  phases: Record<Phase, { title: string; why: string }>;
  network: ConceptNetwork;
  voice: boolean;
  questions: ConceptQuestion[];
  later: { roomId: string; text: string }[];
  coverage: SmartHomeSuggestion['coverage'];
  /** Entries of Claude's answer that did not match (dropped). */
  dropped: number;
}

const DEFAULT_PHASES = (): SmartHomeConcept['phases'] => ({ 1: { title: DEFAULT_PHASE_TITLE[1], why: DEFAULT_PHASE_WHY[1] }, 2: { title: DEFAULT_PHASE_TITLE[2], why: DEFAULT_PHASE_WHY[2] }, 3: { title: DEFAULT_PHASE_TITLE[3], why: DEFAULT_PHASE_WHY[3] } });

const ROLE: Record<RoomType, string> = {
  living: 'Hauptaufenthalt: Präsenz erkennen, Licht und Medien automatisch schalten.',
  bedroom: 'Ruhe: Licht abends gedimmt, nachts nur bei Bedarf, Lüften im Blick.',
  kids: 'Aufenthalt und Schlafen: Licht und Lüften, ohne Kameras oder Mikrofone.',
  office: 'Arbeiten: Präsenz und Licht, Lüften bei langer Nutzung.',
  dining: 'Essen und Aufenthalt: Licht nach Tageszeit.',
  kitchen: 'Bewegung für Licht, Fenster im Blick.',
  bath: 'Licht per Bewegung, Feuchte später messen.',
  hall: 'Durchgang: Licht per Bewegung, Außentür meldet Ankunft und Abwesenheit.',
  utility: 'Abstellraum: Licht per Bewegung, Wasser- oder Feuchtemelder bei Waschmaschine.',
  balcony: 'Außenbereich: Licht per Dämmerung, Balkontür im Blick.',
  other: 'Nebenraum: Licht per Bewegung, wo es nützt.',
};

// ---------------------------------------------------------------- budget and network

export interface Cost {
  min: number;
  max: number;
  unknown: number;
}
const addCost = (c: Cost, productId: string | undefined) => {
  const price = productById(productId)?.priceEur;
  if (price) {
    c.min += price[0];
    c.max += price[1];
  } else c.unknown++;
};
const round2 = (c: Cost): Cost => ({ min: Math.round(c.min * 100) / 100, max: Math.round(c.max * 100) / 100, unknown: c.unknown });

export const itemsUpTo = (c: SmartHomeConcept, upTo: Phase) => c.items.filter((i) => i.phase <= upTo);

/** Central unit parts needed for the chosen devices (Zigbee stick only with Zigbee devices …). */
export function centralFor(items: { productId?: string }[], voice: boolean): CentralPart[] {
  if (!items.length) return [];
  const protocols = new Set(items.map((i) => productById(i.productId)?.protocol));
  const out = [HA_GREEN];
  if (protocols.has('Zigbee')) out.push(ZBT2);
  if (protocols.has('Thread/Matter')) out.push(protocols.has('Zigbee') ? ZBT2_THREAD : { ...ZBT2_THREAD, name: 'Home Assistant Connect ZBT-2 (Thread)' });
  if (voice) out.push(VOICE);
  return out;
}

export interface ConceptBudget {
  rooms: { roomId: string; cost: Cost }[];
  central: { parts: CentralPart[]; total: number };
  devices: Cost;
  /** Total of devices and central unit; unknown = devices without a price. */
  total: Cost;
}

export function budgetOf(c: SmartHomeConcept, upTo: Phase): ConceptBudget {
  const items = itemsUpTo(c, upTo);
  const rooms: ConceptBudget['rooms'] = [];
  const devices: Cost = { min: 0, max: 0, unknown: 0 };
  for (const it of items) {
    let r = rooms.find((x) => x.roomId === it.roomId);
    if (!r) rooms.push((r = { roomId: it.roomId, cost: { min: 0, max: 0, unknown: 0 } }));
    addCost(r.cost, it.productId);
    addCost(devices, it.productId);
  }
  const parts = centralFor(items, c.voice);
  const centralTotal = parts.reduce((t, p) => t + p.price, 0);
  return {
    rooms: rooms.map((r) => ({ roomId: r.roomId, cost: round2(r.cost) })),
    central: { parts, total: centralTotal },
    devices: round2(devices),
    total: round2({ min: devices.min + centralTotal, max: devices.max + centralTotal, unknown: devices.unknown }),
  };
}

/** Facts about the radio network of the chosen devices and the WLAN of the plan (computed, not by Claude). */
export function networkFacts(project: Project, items: { productId?: string }[]): string[] {
  const out: string[] = [];
  const prods = items.map((i) => productById(i.productId)).filter((p): p is NonNullable<typeof p> => !!p);
  const count = (proto: string) => prods.filter((p) => p.protocol === proto).length;
  const zigbee = prods.filter((p) => p.protocol === 'Zigbee');
  if (zigbee.length) {
    const routers = zigbee.filter((p) => p.router === 'stated' || p.router === 'inferred').length;
    out.push(`Zigbee: ${zigbee.length} Gerät${zigbee.length === 1 ? '' : 'e'}, davon ${routers} netzbetrieben mit Routerfunktion (verstärken das Netz).${routers === 0 ? ' Ohne netzbetriebenes Gerät dazwischen hängt die Reichweite allein am Funkstick.' : ''}`);
  }
  if (count('Thread/Matter')) out.push(`Thread/Matter: ${count('Thread/Matter')} Gerät${count('Thread/Matter') === 1 ? '' : 'e'}, brauchen einen eigenen Thread-Funkstick oder Border-Router.`);
  if (count('Wi-Fi')) out.push(`WLAN-Geräte: ${count('Wi-Fi')}.`);
  const derived = derivePlan(project);
  const bands = recommendBands(project, derived);
  if (!bands.length) out.push('Im Plan ist kein Router eingetragen – die WLAN-Abdeckung kann nicht bewertet werden (Werkzeug „WLAN“ im Smart-Home-Reiter).');
  else {
    const weak = bands.filter((b) => b.band === '2.4').map((b) => project.rooms.find((r) => r.id === b.roomId)?.name || 'Raum ohne Namen');
    out.push(weak.length ? `WLAN: In ${weak.join(', ')} reicht 5 GHz laut Schätzung nicht, WLAN-Geräte dort im 2,4-GHz-Band betreiben.` : 'WLAN: 5 GHz reicht laut Schätzung in allen Räumen.');
  }
  return out;
}

// ---------------------------------------------------------------- rules-based concept

const roomsWith = (items: ConceptItem[], kinds: SmartDeviceKind[]) => [...new Set(items.filter((i) => kinds.includes(i.kind)).map((i) => i.roomId))];

/** Scenes that the planned devices can really carry (CONCEPT.md §5); nothing is offered without its devices. */
export function scenesByRules(items: ConceptItem[], project: Project): ConceptScene[] {
  const scenes: ConceptScene[] = [];
  const lights = roomsWith(items, ['light']);
  const contactRooms = roomsWith(items, ['contact']);
  const motion = items.filter((i) => i.kind === 'motion' || i.kind === 'presence');
  const outerDoor = items.filter((i) => i.kind === 'contact' && project.openings.find((o) => o.id === i.openingId)?.kind === 'door');
  if (lights.length || contactRooms.length)
    scenes.push({
      name: 'Abwesend',
      trigger: 'Alle Handys sind weg (Companion App)',
      actions: `${lights.length ? 'Alle smarten Lampen aus. ' : ''}${contactRooms.length ? 'Hinweis aufs Handy, falls ein Fenster oder die Außentür offen ist.' : ''}`.trim(),
      roomIds: [...new Set([...lights, ...contactRooms])],
    });
  if (lights.length)
    scenes.push({ name: 'Nacht', trigger: 'Schlafenszeit oder nach 22 Uhr', actions: motion.length ? 'Alle Lampen aus; Lampen in Durchgangsräumen gehen bei Bewegung nur gedimmt (ca. 15 %) und warmweiß an.' : 'Alle Lampen aus.', roomIds: lights });
  if (outerDoor.length && lights.length)
    scenes.push({ name: 'Ankunft', trigger: 'Außentür öffnet sich und es ist dunkel', actions: 'Licht im Eingangsbereich an, in den Wohnräumen die Abendszene.', roomIds: [...new Set(outerDoor.map((i) => i.roomId))] });
  const windows = items.filter((i) => i.kind === 'contact' && project.openings.find((o) => o.id === i.openingId)?.kind === 'window');
  if (windows.length) scenes.push({ name: 'Lüften', trigger: 'Fenster länger als 15 Minuten offen und draußen unter 5 °C', actions: 'Erinnerung aufs Handy: Fenster schließen.', roomIds: [...new Set(windows.map((i) => i.roomId))] });
  return scenes;
}

export const GENERAL_QUESTIONS: ConceptQuestion[] = [
  { question: 'Dürfen Sensoren geklebt oder geschraubt werden (Mietwohnung)?', proposal: 'Ja, nur Klebe- und Steckgeräte, kein Eingriff in 230 V (Unterputz nur durch Elektrofachkraft).' },
  { question: 'Wie viel darf das Grundsystem kosten?', proposal: 'Mit Phase 1 anfangen und erst nach einigen Wochen Betrieb weitere Phasen kaufen.' },
  { question: 'Sollen Heizung oder Rollos gesteuert werden?', proposal: 'Zuerst nur messen; Steuerung erst nach Rücksprache mit Vermieter oder Hausverwaltung.' },
];

/** The concept without Claude: devices of the room suggestion, phases by device kind, scenes and network by rules. */
export function conceptByRules(project: Project, base: SmartHomeSuggestion, roomTypes: Record<string, RoomType> = {}): SmartHomeConcept {
  const items: ConceptItem[] = base.items.map((i) => ({ ...i, phase: KIND_PHASE[i.kind] }));
  const rooms: ConceptRoom[] = project.rooms
    .filter((r) => items.some((i) => i.roomId === r.id))
    .map((r) => {
      const type = roomTypes[r.id] ?? guessRoomType(r.name);
      return { roomId: r.id, type, role: ROLE[type] };
    });
  return {
    source: 'rules',
    summary: `Regelbasiertes Konzept: ${items.length} Geräte in ${rooms.length} Räumen, Melder nach Datenblatt-Reichweite platziert, Reihenfolge nach Gerätetyp.`,
    rooms,
    items,
    left: [],
    scenes: scenesByRules(items, project),
    phases: DEFAULT_PHASES(),
    network: { note: 'Zigbee für Batteriegeräte (lokal, ohne Cloud), Thread/Matter nur dort, wo das Gerät es verlangt; Zentrale lokal.', facts: networkFacts(project, items) },
    voice: false,
    questions: GENERAL_QUESTIONS,
    later: base.later,
    coverage: base.coverage,
    dropped: 0,
  };
}

/** The part of the concept up to phase `upTo` as an ordinary suggestion (preview in the plan, apply in one undo step). */
export function suggestionOf(c: SmartHomeConcept, upTo: Phase): SmartHomeSuggestion & { concept: true } {
  const items = itemsUpTo(c, upTo);
  const cost: Cost = { min: 0, max: 0, unknown: 0 };
  for (const it of items) addCost(cost, it.productId);
  const sensorRooms = new Set(items.filter((i) => i.kind === 'motion' || i.kind === 'presence').map((i) => i.roomId));
  return { concept: true, items, coverage: c.coverage.filter((x) => sensorRooms.has(x.roomId)), cost: round2(cost), later: c.later };
}

// ---------------------------------------------------------------- Claude

const shortDevice = (i: DeviceProposal) => {
  const p = productById(i.productId);
  return p ? `${KIND_LABEL[i.kind]} ${p.brand} ${p.model} (${p.protocol}, ${p.power}${p.priceEur ? `, ca. ${p.priceEur[0] === p.priceEur[1] ? p.priceEur[0] : `${p.priceEur[0]}–${p.priceEur[1]}`} €` : ', Preis unbekannt'})` : KIND_LABEL[i.kind];
};

export function buildConceptPrompt(w: ConceptWishes, plan: PlanSummary, base: SmartHomeSuggestion, project: Project): string {
  const keyOfRoom = (id: string) => Object.entries(plan.roomKeys).find(([, rid]) => rid === id)?.[0] ?? '?';
  const field = (label: string, v: string) => `${label}: ${clip(v, MAX_FIELD) || '(keine Angabe)'}`;
  const derived = derivePlan(project);
  const existing = project.rooms.map((r) => ({ r, n: project.devices.filter((d) => roomAt(project, derived, d) === r.id).length })).filter((x) => x.n);
  const bands = recommendBands(project, derived);
  return [
    'Du bist Smart-Home-Planer für eine Mietwohnung. Erstelle ein ganzheitliches Konzept für die ganze Wohnung: alle Räume zusammen, lokal bevorzugt (keine Cloud-Pflicht), mieterfreundlich (kein Eingriff in 230 V). Antwort auf Deutsch.',
    '',
    plan.text,
    '',
    'Wünsche der Bewohnerin bzw. des Bewohners:',
    field('Alltag', w.habits),
    field('Wünscht sich', w.wants),
    `Budget: ${w.budget > 0 ? `höchstens ${Math.round(w.budget)} € für Geräte und Zentrale zusammen` : 'kein festes Budget'}`,
    '',
    'Geräte, die der Planer nach Datenblatt-Reichweite schon an passenden Stellen platziert hat (nur diese Schlüssel darfst du verwenden):',
    base.items.length ? base.items.map((i, n) => `K${n + 1}: ${keyOfRoom(i.roomId)}, ${shortDevice(i)}; Grund: ${i.reason}`).join('\n') : '(keine)',
    existing.length ? `Schon vorhanden: ${existing.map((x) => `${x.n} Gerät(e) in ${x.r.name}`).join(', ')}` : '',
    base.later.length ? `Noch nicht planbar (kein Gerätetyp im Planer): ${base.later.map((l) => `${keyOfRoom(l.roomId)}: ${l.text}`).join('; ')}` : '',
    bands.length ? `WLAN-Schätzung: ${bands.map((b) => `${keyOfRoom(b.roomId)} ${b.band === '5' ? '5 GHz ok' : 'nur 2,4 GHz'}`).join(', ')}` : 'WLAN: im Plan ist kein Router eingetragen.',
    'Zentrale: Der Planer rechnet Home Assistant Green mit Funkstick(s) fest ein; du entscheidest nur, ob eine Sprachsteuerung (lokal) sinnvoll ist.',
    '',
    'Regeln:',
    '- Bewerte jedes Gerät K1…: behalten (keep) oder weglassen mit Begründung, dazu Phase 1 (zuerst), 2 (danach) oder 3 (später) und einen Satz Begründung mit Bezug auf Raum und Wünsche.',
    '- Gib keine Positionen, Produkte oder Preise an; das Budget rechnet der Planer. Keine Geräte erfinden, die oben nicht stehen. Alles Weitere (z. B. Temperatursensor) nur als Hinweis in "later".',
    '- Szenen über mehrere Räume (z. B. Abwesend, Nacht, Ankunft): nur mit Geräten aus der Liste; nenne die beteiligten Räume (R1 …).',
    '- Phasen so legen, dass Phase 1 das Budget einhält und schon nützlich ist.',
    '- Offene Fragen knapp, jeweils mit deinem besten Vorschlag als Antwort.',
    '',
    'Antworte nur mit JSON in genau dieser Form:',
    '{"summary":"2–3 Sätze zum Gesamtkonzept","rooms":[{"room":"R1","role":"1 Satz"}],"devices":[{"key":"K1","keep":true,"phase":1,"reason":"…"}],"scenes":[{"name":"Abwesend","trigger":"…","actions":"…","rooms":["R1"]}],"phases":[{"phase":1,"title":"Zuerst","why":"…"}],"network":"Funkstandards und Betrieb in 2–3 Sätzen","voice":false,"questions":[{"question":"…","proposal":"…"}],"later":[{"room":"R1","text":"…"}]}',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const Schema = z.object({
  summary: z.unknown().optional(),
  rooms: z.array(z.object({ room: z.unknown().optional(), role: z.unknown().optional() })).catch([]),
  devices: z.array(z.object({ key: z.unknown().optional(), keep: z.unknown().optional(), phase: z.unknown().optional(), reason: z.unknown().optional() })).catch([]),
  scenes: z.array(z.object({ name: z.unknown().optional(), trigger: z.unknown().optional(), actions: z.unknown().optional(), rooms: z.array(z.unknown()).optional().catch([]) })).catch([]),
  phases: z.array(z.object({ phase: z.unknown().optional(), title: z.unknown().optional(), why: z.unknown().optional() })).catch([]),
  network: z.unknown().optional(),
  voice: z.unknown().optional(),
  questions: z.array(z.object({ question: z.unknown().optional(), proposal: z.unknown().optional() })).catch([]),
  later: z.array(z.object({ room: z.unknown().optional(), text: z.unknown().optional() })).catch([]),
});

const MAX_SCENES = 6;
const MAX_QUESTIONS = 5;

/**
 * Checks Claude's answer against the placed devices and the rooms of the plan: unknown keys and
 * rooms are dropped, devices Claude does not mention stay (rule phase), and without any usable
 * device judgement the answer is rejected. Whatever the answer says, positions and products stay those of `base`.
 */
export function parseConceptAnswer(raw: unknown, ctx: { plan: PlanSummary; project: Project; base: SmartHomeSuggestion; roomTypes?: Record<string, RoomType> }): SmartHomeConcept {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) throw new Error('Antwort hat nicht die erwartete Form.');
  const a = parsed.data;
  const { plan, project, base } = ctx;
  let dropped = 0;
  const roomOf = (v: unknown): string | undefined => (typeof v === 'string' ? plan.roomKeys[v.trim().toUpperCase()] : undefined);
  const byKey = new Map(base.items.map((i, n) => [`K${n + 1}`, i]));
  const verdict = new Map<string, { keep: boolean; phase?: Phase; reason: string }>();
  for (const d of a.devices) {
    const key = typeof d.key === 'string' ? d.key.trim().toUpperCase() : '';
    if (!byKey.has(key) || verdict.has(key)) {
      dropped++;
      continue;
    }
    const ph = Math.round(Number(d.phase));
    verdict.set(key, { keep: d.keep !== false, phase: ph === 1 || ph === 2 || ph === 3 ? (ph as Phase) : undefined, reason: clip(d.reason, 300) });
  }
  if (!verdict.size && base.items.length) throw new Error('Keine verwertbare Bewertung der Geräte.');

  const items: ConceptItem[] = [];
  const left: SmartHomeConcept['left'] = [];
  for (const [key, it] of byKey) {
    const v = verdict.get(key);
    if (v && !v.keep) {
      left.push({ name: it.name, reason: v.reason || 'von Claude weggelassen' });
      continue;
    }
    items.push({ ...it, reason: v?.reason || it.reason, phase: v?.phase ?? KIND_PHASE[it.kind] });
  }

  const rooms: ConceptRoom[] = [];
  for (const r of a.rooms) {
    const id = roomOf(r.room);
    if (!id || rooms.some((x) => x.roomId === id) || !items.some((i) => i.roomId === id)) {
      dropped++;
      continue;
    }
    const room = project.rooms.find((x) => x.id === id)!;
    const type = ctx.roomTypes?.[id] ?? guessRoomType(room.name);
    rooms.push({ roomId: id, type, role: clip(r.role, 200) || ROLE[type] });
  }
  for (const room of project.rooms) {
    if (!items.some((i) => i.roomId === room.id) || rooms.some((x) => x.roomId === room.id)) continue;
    const type = ctx.roomTypes?.[room.id] ?? guessRoomType(room.name);
    rooms.push({ roomId: room.id, type, role: ROLE[type] });
  }

  const scenes: ConceptScene[] = [];
  for (const s of a.scenes) {
    const name = clip(s.name, 40);
    const actions = clip(s.actions, 300);
    const roomIds = [...new Set((s.rooms ?? []).map(roomOf).filter((x): x is string => !!x))];
    if (!name || !actions || scenes.length >= MAX_SCENES) {
      dropped++;
      continue;
    }
    scenes.push({ name, trigger: clip(s.trigger, 200), actions, roomIds });
  }

  const phases = DEFAULT_PHASES();
  for (const p of a.phases) {
    const n = Math.round(Number(p.phase));
    if (n !== 1 && n !== 2 && n !== 3) continue;
    phases[n as Phase] = { title: clip(p.title, 40) || phases[n as Phase].title, why: clip(p.why, 200) || phases[n as Phase].why };
  }

  const questions = a.questions
    .map((q) => ({ question: clip(q.question, 200), proposal: clip(q.proposal, 200) }))
    .filter((q) => q.question)
    .slice(0, MAX_QUESTIONS);

  const later = [...base.later];
  for (const l of a.later) {
    const id = roomOf(l.room);
    const text = clip(l.text, 200);
    if (!id || !text) dropped++;
    else if (later.length < 12 && !later.some((x) => x.roomId === id && x.text === text)) later.push({ roomId: id, text });
  }

  return {
    source: 'claude',
    summary: clip(a.summary, 800),
    rooms,
    items,
    left,
    scenes,
    phases,
    network: { note: clip(a.network, 500), facts: networkFacts(project, items) },
    voice: a.voice === true,
    questions: questions.length ? questions : GENERAL_QUESTIONS,
    later,
    coverage: left.some((l) => base.items.some((i) => i.name === l.name && (i.kind === 'motion' || i.kind === 'presence'))) ? base.coverage.filter((c) => !left.some((l) => base.items.some((i) => i.name === l.name && i.roomId === c.roomId && (i.kind === 'motion' || i.kind === 'presence')))) : base.coverage,
    dropped,
  };
}

export const roomTypeLabel = (t: RoomType) => ROOM_TYPES.find((x) => x.id === t)?.label ?? t;
