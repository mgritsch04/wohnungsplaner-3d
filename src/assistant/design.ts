/**
 * Furnishing proposal by Claude for the whole apartment or one room (#350).
 *
 * The user only gives interests, needs, wishes, style and budget; Claude plans every room
 * itself. It may choose from two lists:
 * - real products: the user's own imported IKEA/Möbelix products with a product page and real
 *   dimensions (name, size and price as on the retailer's page);
 * - placeholders: the generic catalogue (typical sizes, guide prices), used where no own product
 *   fits. Claude describes the wanted product and gives a search term; the app links the search
 *   on ikea.com / moebelix.at. No invented products or prices: Claude's text is never shown as
 *   product data, only as description.
 * Claude only picks items and reasons; the exact positions come from the collision-free
 * placement of `src/suggest/` (#137), never from Claude.
 */
import { z } from 'zod';
import { isIkeaItem, isMoebelixItem } from '../catalog/ikeaSelection';
import type { CatalogItem } from '../catalog/types';
import { ROOM_TYPES, WISH_CATALOG, type RoomType } from '../suggest/furnishing';
import { MAX_QUANTITY } from './answer';
import { KITCHEN_JSON_HINT, kitchenPromptPart, kitchenTotal, parseKitchen, resolveWith, type DesignKitchen, type KitchenFace } from './kitchenDesign';
import { guidePrompt, implausibleSize, type RoomFix } from './designGuide';
import type { PlanSummary } from './planSummary';

export type RetailerChoice = 'both' | 'ikea' | 'moebelix';

export const RETAILER_CHOICES: { value: RetailerChoice; label: string }[] = [
  { value: 'both', label: 'IKEA und Möbelix' },
  { value: 'ikea', label: 'Nur IKEA' },
  { value: 'moebelix', label: 'Nur Möbelix' },
];

export const STYLES = ['skandinavisch', 'modern', 'gemütlich', 'industriell', 'minimalistisch', 'Landhaus'];

export interface DesignWishes {
  interests: string;
  needs: string;
  wants: string;
  style: string;
  colors: string;
  /** Upper limit in EUR for the whole proposal; 0 = none. */
  budget: number;
  retailer: RetailerChoice;
  /** Search real products for the placeholders right after the proposal (#350); only where a search way exists. */
  searchReal: boolean;
  /** „gründlich“: strongest model and a second round in which Claude checks the placed room; „schnell“: one round. */
  quality: DesignQuality;
}

export type DesignQuality = 'thorough' | 'fast';

export const QUALITY_CHOICES: { value: DesignQuality; label: string }[] = [
  { value: 'thorough', label: 'Gründlich – stärkstes Modell, Claude prüft die Aufstellung nach (dauert etwa doppelt so lang)' },
  { value: 'fast', label: 'Schnell – eine Runde mit dem Standardmodell' },
];

export const EMPTY_WISHES: DesignWishes = { interests: '', needs: '', wants: '', style: 'skandinavisch', colors: '', budget: 0, retailer: 'both', searchReal: true, quality: 'thorough' };

export const MAX_FIELD = 300;
/** At most this many own products go into one request (keeps the prompt and the usage small). */
export const MAX_PRODUCTS = 60;
/** Different items per room. */
export const MAX_PICKS = 14;

export const retailerOf = (c: CatalogItem): 'IKEA' | 'Möbelix' | null => (isMoebelixItem(c) ? 'Möbelix' : isIkeaItem(c) ? 'IKEA' : null);

/** Imported retailer products that can be proposed: product page as source and usable dimensions. */
export function realProducts(items: CatalogItem[], retailer: RetailerChoice = 'both'): CatalogItem[] {
  return items.filter((c) => {
    const r = retailerOf(c);
    if (!r || c.kitchen || !c.productUrl) return false;
    if (retailer === 'ikea' && r !== 'IKEA') return false;
    if (retailer === 'moebelix' && r !== 'Möbelix') return false;
    // squashed or flat products (seat height or top thickness read as height) are not offered (#350)
    return [c.width, c.depth, c.height].every((v) => Number.isFinite(v) && v >= 0.02 && v <= 6) && !implausibleSize(c);
  });
}

/** Generic furniture Claude may use as a placeholder (no stairs, no built-in kitchen modules). */
export const PLACEHOLDERS: CatalogItem[] = WISH_CATALOG.filter((c) => c.category !== 'stairs');

/** Categories that usually belong in a room type (the rest is still offered, just later). */
const ROOM_CATEGORIES: Record<RoomType, string[]> = {
  living: ['sofa', 'table', 'storage', 'lighting', 'textile', 'decor', 'chair'],
  bedroom: ['bed', 'storage', 'lighting', 'textile', 'decor', 'desk'],
  kids: ['bed', 'storage', 'desk', 'chair', 'textile', 'lighting', 'decor'],
  office: ['desk', 'chair', 'storage', 'lighting', 'decor', 'textile'],
  dining: ['table', 'chair', 'storage', 'lighting', 'textile', 'decor'],
  kitchen: ['table', 'chair', 'storage', 'lighting', 'appliance'],
  bath: ['bathroom', 'storage', 'textile', 'decor', 'lighting'],
  hall: ['storage', 'lighting', 'textile', 'decor', 'chair'],
  utility: ['storage', 'appliance'],
  balcony: ['chair', 'table', 'decor', 'textile', 'lighting'],
  other: ['storage', 'table', 'chair', 'lighting', 'decor', 'textile', 'sofa', 'desk', 'bed'],
};

/** Preselection of own products: categories of the planned room types first, nothing above the budget, at most `limit`. */
export function preselect(products: CatalogItem[], types: RoomType[], budget = 0, limit = MAX_PRODUCTS): CatalogItem[] {
  const rank = (c: CatalogItem) => Math.min(...types.map((t) => (ROOM_CATEGORIES[t].indexOf(c.category) + 100) % 100));
  return products
    .filter((c) => !budget || !c.price || c.price.amount <= budget)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Search on the retailer's own website (a link the user opens; nothing is fetched by the app). */
export function searchLinks(term: string, retailer: RetailerChoice): { label: string; url: string }[] {
  const q = encodeURIComponent(term.trim());
  if (!q) return [];
  const out: { label: string; url: string }[] = [];
  if (retailer !== 'moebelix') out.push({ label: 'bei IKEA suchen', url: `https://www.ikea.com/at/de/search/?q=${q}` });
  if (retailer !== 'ikea') out.push({ label: 'bei Möbelix suchen', url: `https://www.moebelix.at/s/?s=${q}` });
  return out;
}

const cm = (v: number) => Math.round(v * 100);
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const dims = (c: CatalogItem) => `${cm(c.width)}×${cm(c.depth)}×${cm(c.height)} cm`;

/** „id: Name (Händler), B×T×H cm, Kategorie, Preis“ – Claude may only propose these ids. */
export function summarizeProducts(items: CatalogItem[]): string {
  return items.map((c) => `${c.id}: ${c.name} (${retailerOf(c)}), ${dims(c)}, ${c.category}, ${c.price ? `${Math.round(c.price.amount)} €` : 'Preis unbekannt'}`).join('\n');
}

export function summarizePlaceholders(items: CatalogItem[] = PLACEHOLDERS): string {
  return items.map((c) => `${c.id}: ${c.name}, ${dims(c)}, ${c.category}${c.price ? `, Richtwert ${Math.round(c.price.amount)} €` : ''}`).join('\n');
}

/** Room-by-room mode: the other rooms are furnished by parallel requests with the same wishes. */
export interface RoomContext {
  others: string;
  wholeBudget: number;
}

/**
 * `kitchen`: wall faces of the (one) kitchen room without kitchen run in this request – Claude
 * then plans the kitchen run too (#350).
 */
export interface PromptExtra {
  /** Room types in this request: their design guide goes into the prompt (#350). */
  types?: RoomType[];
  /** „Gefällt mir nicht“: what the user said about the last proposal of this room. */
  feedback?: string;
  /** Second round („gründlich“): the planner's report on how the first answer was placed. */
  review?: string;
}

/** What an interior designer checks before handing over a room (#350); Claude checks itself against it. */
export const CHECKLIST = [
  'alle Pflichtmöbel des Raumtyps da (oder schon im Raum vorhanden)',
  'Größen passen zur Fläche: höchstens etwa die Hälfte der Bodenfläche zugestellt, große Stücke nicht zu groß für die Wand',
  'Laufwege frei (Gang 90 cm, sonst 60–80 cm), Türschwung und Fenster frei',
  'ein klarer Blickfang und erkennbare Zonen statt einzelner verteilter Möbel',
  'Licht in Ebenen (Decke/Stehlampe/Tischlampe), Textilien (Teppich, Vorhang) und Wanddeko (Bilder, Wandregal, Spiegel)',
  'Farben und Materialien aus einer Palette, passend zum Stil',
  'nichts Unpassendes: keine losen Kisten am Boden, keine Innenmöbel auf dem Balkon, keine Stehlampe im Gang',
];

export function buildDesignPrompt(
  w: DesignWishes,
  plan: PlanSummary,
  products: CatalogItem[],
  placeholders: CatalogItem[] = PLACEHOLDERS,
  room?: RoomContext,
  kitchen?: KitchenFace[],
  extra: PromptExtra = {},
): string {
  const field = (label: string, v: string) => `${label}: ${clip(v, MAX_FIELD) || '(keine Angabe)'}`;
  const shops = w.retailer === 'ikea' ? 'IKEA' : w.retailer === 'moebelix' ? 'Möbelix' : 'IKEA oder Möbelix';
  const types = [...new Set(extra.types ?? [])];
  return [
    room
      ? `Du bist Innenarchitekt für einen Wohnungsplaner. Richte NUR den Raum unten ein; die übrigen Räume (${room.others}) richtet gleichzeitig eine andere Anfrage mit denselben Wünschen ein. Halte Stil und Farben genau ein, damit alle Räume zusammenpassen, und plane nur Möbel, die in diesen Raum gehören (Antwort auf Deutsch).`
      : 'Du bist Innenarchitekt für einen Wohnungsplaner. Richte die Wohnung unten ganzheitlich und stimmig ein: jeder genannte Raum bekommt alles, was er für seinen Zweck braucht, Stil und Farben ziehen sich durch, das Budget wird sinnvoll auf die Räume verteilt (Antwort auf Deutsch).',
    '',
    plan.text,
    '',
    'Wünsche der Bewohnerin bzw. des Bewohners (gelten für die ganze Wohnung):',
    field('Interessen/Hobbys', w.interests),
    field('Braucht', w.needs),
    field('Wünscht sich', w.wants),
    field('Stil', w.style),
    field('Farben', w.colors),
    `Budget: ${
      w.budget > 0 ? (room ? `höchstens ${Math.round(w.budget)} € für diesen Raum (Anteil am Gesamtbudget von ${Math.round(room.wholeBudget)} €, nach Fläche verteilt)` : `höchstens ${Math.round(w.budget)} € für alles zusammen`) : 'kein festes Budget'
    }`,
    `Händler: ${shops}`,
    '',
    'A) Eigene Produkte – echte Produkte, die schon ausgewählt sind (bevorzugen, wenn sie passen; Format „id: Name (Händler), Breite×Tiefe×Höhe, Kategorie, Preis“):',
    products.length ? summarizeProducts(products) : '(keine)',
    '',
    `B) Platzhalter – typische Größen für alles, was in A fehlt; dazu beschreibst du das gesuchte Produkt und gibst einen Suchbegriff für ${shops} an (Format „id: Art, Breite×Tiefe×Höhe, Kategorie, Richtwert“):`,
    summarizePlaceholders(placeholders),
    '',
    ...(kitchen?.length ? [...kitchenPromptPart(kitchen), ''] : []),
    'Vorgehen wie ein Einrichtungsberater:',
    '1. Zuerst je Raum ein Leitfaden ("brief"): Zweck, Zonen, Blickfang, Laufwege, Farbpalette (3–4 Farben), Deko.',
    '2. Dann die Möbel genau aus diesem Leitfaden ableiten – jede Zone bekommt, was sie braucht; nichts, was keiner Zone dient.',
    `3. Vor der Antwort selbst prüfen und korrigieren: ${CHECKLIST.join('; ')}.`,
    '',
    ...types.flatMap((t) => [`Leitlinien für ${ROOM_TYPES.find((x) => x.id === t)?.label ?? t}:`, ...guidePrompt(t), '']),
    ...(extra.feedback ? [`Rückmeldung zum letzten Vorschlag für diesen Raum (unbedingt berücksichtigen, anders machen): ${clip(extra.feedback, MAX_FIELD)}`, ''] : []),
    ...(extra.review ? ['Zweite Runde – so hat der Planer deinen ersten Vorschlag aufgestellt; prüfe ihn mit der Prüfliste und liefere den verbesserten, vollständigen Vorschlag für den Raum (gleiches Format):', clip(extra.review, 4000), ''] : []),
    'Regeln:',
    `- Nur catalogId aus A oder B. Je Raum höchstens ${MAX_PICKS} verschiedene Einträge.`,
    '- Achte auf Raumgröße, vorhandene Möbel, Türen und Fenster; lieber weniger, dafür passend. Vorhandene Möbel nicht doppelt kaufen.',
    '- Jeder Eintrag mit einer kurzen Begründung (1 Satz, Bezug auf die Wünsche).',
    '- Für Platzhalter (B): "label" = kurze Beschreibung des gesuchten Produkts (Art, Material, Farbe, Stil), "search" = kurzer Suchbegriff für den Shop. Keine Produktnamen, Artikelnummern oder Preise erfinden.',
    `- Für größere Möbel (Bett, Sofa, Schrank, Tisch, Schreibtisch, Regal …) bis zu ${MAX_ALTERNATIVES} Alternativen in "alternatives" (andere catalogId, gleiche Regeln, kurze Begründung, z. B. günstiger oder größer).`,
    `- Die App stellt die Möbel selbst kollisionsfrei nach den Leitlinien auf (Rückwand an die Wand, Vorhang ans Fenster, Bild über Sofa/Bett, Spiegel über den Waschtisch, Boxen ins Regal); keine Positionen angeben. Im Bad Waschtisch, WC und Dusche nur planen, wenn sie nicht schon im Raum stehen; ${kitchen?.length ? 'die Küchenzeile nur im Feld "kitchen"' : 'keine Küchenzeilen planen'}.`,
    `- "type" je Raum: einer von ${ROOM_TYPES.map((t) => t.id).join(', ')}.`,
    '',
    'Antworte nur mit JSON in genau dieser Form:',
    `{"summary":"2–3 Sätze zum Gesamtkonzept","rooms":[{"room":"R1","type":"${kitchen?.length ? 'kitchen' : 'living'}","brief":{"purpose":"wofür der Raum da ist","zones":["Zone: was dort passiert"],"focus":"Blickfang","paths":"Laufwege","palette":["Farbe"],"decor":"Wanddeko, Textilien, Pflanzen"},"concept":"1 Satz","items":[{"catalogId":"…","quantity":1,"reason":"…","label":"nur bei Platzhaltern","search":"nur bei Platzhaltern","alternatives":[{"catalogId":"…","reason":"…","label":"…","search":"…"}]}]${kitchen?.length ? `,${KITCHEN_JSON_HINT}` : ''}}]}`,
  ].join('\n');
}

export interface DesignOption {
  catalogId: string;
  reason: string;
  /** Placeholder (generic catalogue): Claude's description of the wanted product and a shop search term. */
  placeholder: boolean;
  label: string;
  search: string;
}

export interface DesignPick extends DesignOption {
  quantity: number;
  /** Other items Claude would take instead (shown under „Alternativen“, swappable). */
  alternatives: DesignOption[];
}

export const MAX_ALTERNATIVES = 3;

/** Claude's design brief of a room (#350): the guide the furniture is derived from, shown to the user. */
export interface DesignBrief {
  purpose: string;
  zones: string[];
  focus: string;
  paths: string;
  palette: string[];
  decor: string;
}

export interface DesignRoom {
  roomId: string;
  type: RoomType | null;
  concept: string;
  brief?: DesignBrief;
  /** What the planner changed after Claude's answer: essentials added, misfits left out (#350). */
  fixes?: RoomFix[];
  /** Claude checked the placed room in a second round („gründlich“). */
  reviewed?: boolean;
  picks: DesignPick[];
  /** Kitchen run Claude planned for a kitchen room without one (#350). */
  kitchen?: DesignKitchen;
}

export interface DesignProposal {
  summary: string;
  rooms: DesignRoom[];
  /** Entries Claude named that were not offered or name an unknown room (dropped). */
  dropped: number;
}

const OptionSchema = z.object({ catalogId: z.unknown(), reason: z.unknown().optional(), label: z.unknown().optional(), search: z.unknown().optional() });
const ItemSchema = OptionSchema.extend({ quantity: z.unknown().optional(), alternatives: z.array(OptionSchema).optional().catch([]) });
const DesignSchema = z.object({
  summary: z.unknown().optional(),
  rooms: z.array(z.object({ room: z.unknown().optional(), type: z.unknown().optional(), concept: z.unknown().optional(), items: z.array(ItemSchema).catch([]), kitchen: z.unknown().optional(), brief: z.unknown().optional() })).catch([]),
});

/**
 * Checks Claude's answer: only rooms of `roomIds` (keys of the plan summary), only offered
 * ids, quantities clamped; a kitchen run only for `kitchenRooms`; throws when nothing usable is left.
 */
export function parseDesignAnswer(raw: unknown, plan: PlanSummary, roomIds: string[], products: CatalogItem[], placeholders: CatalogItem[] = PLACEHOLDERS, kitchenRooms: string[] = []): DesignProposal {
  const parsed = DesignSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Antwort hat nicht die erwartete Form.');
  const real = new Set(products.map((c) => c.id));
  const generic = new Map(placeholders.map((c) => [c.id, c]));
  const allowed = new Set(roomIds);
  const rooms: DesignRoom[] = [];
  let dropped = 0;
  const option = (it: z.infer<typeof OptionSchema>): DesignOption | null => {
    const id = typeof it.catalogId === 'string' ? it.catalogId.trim() : '';
    const g = !real.has(id) ? generic.get(id) : undefined;
    if (!real.has(id) && !g) return null;
    return { catalogId: id, reason: clip(it.reason, 300), placeholder: !!g, label: g ? clip(it.label, 80) || g.name : '', search: g ? clip(it.search, 60) || g.name : '' };
  };
  for (const r of parsed.data.rooms) {
    const key = typeof r.room === 'string' ? r.room.trim().toUpperCase() : '';
    const roomId = plan.roomKeys[key] ?? (roomIds.length === 1 && !key ? roomIds[0] : undefined);
    if (!roomId || !allowed.has(roomId)) {
      dropped += r.items.length;
      continue;
    }
    let room = rooms.find((x) => x.roomId === roomId);
    if (!room) {
      const type = ROOM_TYPES.find((t) => t.id === r.type)?.id ?? null;
      const brief = parseBrief(r.brief);
      room = { roomId, type, concept: clip(r.concept, 300), picks: [], ...(brief ? { brief } : {}) };
      rooms.push(room);
    }
    if (r.kitchen !== undefined && !room.kitchen) {
      const k = kitchenRooms.includes(roomId) ? parseKitchen(r.kitchen) : { kitchen: null, dropped: 1 };
      dropped += k.dropped;
      if (k.kitchen) room.kitchen = k.kitchen;
    }
    for (const it of r.items) {
      const opt = option(it);
      if (!opt) {
        dropped++;
        continue;
      }
      const q = Math.max(1, Math.min(MAX_QUANTITY, Math.round(Number(it.quantity ?? 1)) || 1));
      const same = room.picks.find((p) => p.catalogId === opt.catalogId);
      if (same) same.quantity = Math.min(MAX_QUANTITY, same.quantity + q);
      else if (room.picks.length < MAX_PICKS) {
        const alternatives: DesignOption[] = [];
        for (const a of it.alternatives ?? []) {
          const alt = option(a);
          if (alt && alt.catalogId !== opt.catalogId && !alternatives.some((x) => x.catalogId === alt.catalogId) && alternatives.length < MAX_ALTERNATIVES) alternatives.push(alt);
        }
        room.picks.push({ ...opt, quantity: q, alternatives });
      }
    }
  }
  const usable = rooms.filter((r) => r.picks.length || r.kitchen);
  if (!usable.length) throw new Error('Keine verwertbaren Möbel.');
  return { summary: clip(parsed.data.summary, 800), rooms: usable, dropped };
}

function parseBrief(raw: unknown): DesignBrief | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => clip(x, max)).filter(Boolean).slice(0, n) : typeof v === 'string' ? [clip(v, max)].filter(Boolean) : []);
  const brief: DesignBrief = { purpose: clip(b.purpose, 200), zones: list(b.zones, 5, 120), focus: clip(b.focus, 120), paths: clip(b.paths, 160), palette: list(b.palette, 5, 30), decor: clip(b.decor, 200) };
  return brief.purpose || brief.zones.length || brief.focus ? brief : undefined;
}

/** Takes alternative `alt` of pick `index` in room `roomId` instead; the replaced item becomes an alternative (swap back possible). */
export function swapPick(p: DesignProposal, roomId: string, index: number, alt: number): DesignProposal {
  return {
    ...p,
    rooms: p.rooms.map((r) => {
      if (r.roomId !== roomId) return r;
      const pick = r.picks[index];
      const chosen = pick?.alternatives[alt];
      if (!chosen) return r;
      const { quantity, alternatives, ...current } = pick;
      const picks = r.picks.map((x, i) => (i === index ? { ...chosen, quantity, alternatives: alternatives.map((a, k) => (k === alt ? current : a)) } : x));
      return { ...r, picks };
    }),
  };
}

/** Totals from catalogue prices: real products (prices from the product pages) and placeholders (guide values). */
export function proposalTotal(proposal: DesignProposal, catalog: CatalogItem[]): { real: number; placeholder: number; unpriced: number } {
  let real = 0;
  let placeholder = 0;
  let unpriced = 0;
  for (const r of proposal.rooms)
    for (const p of r.picks) {
      const c = catalog.find((x) => x.id === p.catalogId);
      if (!c?.price) unpriced += p.quantity;
      else if (p.placeholder) placeholder += c.price.amount * p.quantity;
      else real += c.price.amount * p.quantity;
    }
  const resolve = resolveWith(catalog);
  for (const r of proposal.rooms) {
    if (!r.kitchen) continue;
    const k = kitchenTotal(r.kitchen, resolve);
    real += k.real;
    placeholder += k.placeholder;
  }
  return { real, placeholder, unpriced };
}
