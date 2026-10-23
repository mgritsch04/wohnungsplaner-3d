/**
 * Furnishing proposal with real IKEA/Möbelix products through Claude (#350).
 *
 * The products Claude may choose from are only the user's own imported retailer products
 * („Meine IKEA-Auswahl“, „Meine Möbelix-Auswahl“) with a product page and real dimensions –
 * no invented products or prices. A rule-based preselection keeps the prompt small (room type,
 * budget, retailer). Claude only picks products and gives a reason; the exact positions come
 * from the collision-free placement of `src/suggest/` (#137), never from Claude.
 */
import { z } from 'zod';
import { isIkeaItem, isMoebelixItem } from '../catalog/ikeaSelection';
import type { CatalogItem } from '../catalog/types';
import type { RoomType } from '../suggest/furnishing';
import { MAX_QUANTITY } from './answer';
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
}

export const EMPTY_WISHES: DesignWishes = { interests: '', needs: '', wants: '', style: 'skandinavisch', colors: '', budget: 0, retailer: 'both' };

export const MAX_FIELD = 300;
/** At most this many products go into one request (keeps the prompt and the usage small). */
export const MAX_PRODUCTS = 60;
export const MAX_PICKS = 12;

export const retailerOf = (c: CatalogItem): 'IKEA' | 'Möbelix' | null => (isMoebelixItem(c) ? 'Möbelix' : isIkeaItem(c) ? 'IKEA' : null);

/** Imported retailer products that can be proposed: product page as source and usable dimensions. */
export function realProducts(items: CatalogItem[], retailer: RetailerChoice = 'both'): CatalogItem[] {
  return items.filter((c) => {
    const r = retailerOf(c);
    if (!r || c.kitchen || !c.productUrl) return false;
    if (retailer === 'ikea' && r !== 'IKEA') return false;
    if (retailer === 'moebelix' && r !== 'Möbelix') return false;
    return [c.width, c.depth, c.height].every((v) => Number.isFinite(v) && v >= 0.02 && v <= 6);
  });
}

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
  other: ['storage', 'table', 'chair', 'lighting', 'decor', 'textile', 'sofa', 'desk', 'bed'],
};

/** Preselection for one room: fitting categories first, nothing above the budget, at most `MAX_PRODUCTS`. */
export function preselect(products: CatalogItem[], type: RoomType, budget = 0, limit = MAX_PRODUCTS): CatalogItem[] {
  const cats = ROOM_CATEGORIES[type];
  const rank = (c: CatalogItem) => {
    const i = cats.indexOf(c.category);
    return i < 0 ? cats.length : i;
  };
  return products
    .filter((c) => !budget || !c.price || c.price.amount <= budget)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

const cm = (v: number) => Math.round(v * 100);
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** „id: Name (Händler), B×T×H cm, Kategorie, Preis“ – Claude may only propose these ids. */
export function summarizeProducts(items: CatalogItem[]): string {
  return items
    .map((c) => {
      const price = c.price ? `${Math.round(c.price.amount)} €` : 'Preis unbekannt';
      return `${c.id}: ${c.name} (${retailerOf(c)}), ${cm(c.width)}×${cm(c.depth)}×${cm(c.height)} cm, ${c.category}, ${price}`;
    })
    .join('\n');
}

export function buildDesignPrompt(w: DesignWishes, plan: PlanSummary, products: CatalogItem[]): string {
  const field = (label: string, v: string) => `${label}: ${clip(v, MAX_FIELD) || '(keine Angabe)'}`;
  return [
    'Du bist Einrichtungsberater für einen Wohnungsplaner. Stelle für den Raum unten eine stimmige Einrichtung aus echten Produkten zusammen (Antwort auf Deutsch).',
    '',
    plan.text,
    '',
    'Wünsche der Bewohnerin bzw. des Bewohners:',
    field('Interessen/Hobbys', w.interests),
    field('Braucht', w.needs),
    field('Wünscht sich', w.wants),
    field('Stil', w.style),
    field('Farben', w.colors),
    `Budget: ${w.budget > 0 ? `höchstens ${Math.round(w.budget)} € für alles zusammen` : 'kein festes Budget'}`,
    '',
    'Produkte (nur diese dürfen vorgeschlagen werden; Format „id: Name (Händler), Breite×Tiefe×Höhe, Kategorie, Preis“):',
    summarizeProducts(products),
    '',
    'Regeln:',
    `- Höchstens ${MAX_PICKS} verschiedene Produkte, nur mit einer catalogId aus der Liste oben. Keine anderen Produkte, Marken oder Preise erfinden.`,
    '- Achte auf die Raumgröße, vorhandene Möbel, Türen und Fenster; lieber weniger, dafür passend.',
    '- Jedes Produkt mit einer kurzen Begründung (1 Satz, Bezug auf die Wünsche).',
    '- Die App stellt die Möbel selbst kollisionsfrei auf; keine Positionen angeben.',
    '',
    'Antworte nur mit JSON in genau dieser Form:',
    '{"summary":"1–2 Sätze zum Gesamtkonzept","items":[{"catalogId":"…","quantity":1,"reason":"…"}]}',
  ].join('\n');
}

export interface DesignPick {
  catalogId: string;
  quantity: number;
  reason: string;
}

export interface DesignProposal {
  summary: string;
  picks: DesignPick[];
  /** Products Claude named that were not offered (dropped). */
  dropped: number;
}

const DesignSchema = z.object({
  summary: z.unknown().optional(),
  items: z.array(z.object({ catalogId: z.unknown(), quantity: z.unknown().optional(), reason: z.unknown().optional() })).catch([]),
});

/** Checks Claude's answer against the offered products; throws when nothing usable is left. */
export function parseDesignAnswer(raw: unknown, products: CatalogItem[]): DesignProposal {
  const parsed = DesignSchema.safeParse(Array.isArray(raw) ? { items: raw } : raw);
  if (!parsed.success) throw new Error('Antwort hat nicht die erwartete Form.');
  const ids = new Set(products.map((c) => c.id));
  const picks: DesignPick[] = [];
  let dropped = 0;
  for (const it of parsed.data.items) {
    const id = typeof it.catalogId === 'string' ? it.catalogId.trim() : '';
    if (!ids.has(id)) {
      dropped++;
      continue;
    }
    const q = Math.max(1, Math.min(MAX_QUANTITY, Math.round(Number(it.quantity ?? 1)) || 1));
    const same = picks.find((p) => p.catalogId === id);
    if (same) same.quantity = Math.min(MAX_QUANTITY, same.quantity + q);
    else if (picks.length < MAX_PICKS) picks.push({ catalogId: id, quantity: q, reason: clip(it.reason, 300) });
  }
  if (!picks.length) throw new Error('Keine verwertbaren Produkte.');
  return { summary: clip(parsed.data.summary, 600), picks, dropped };
}

/** Total of the picks from the catalogue prices; `unpriced` counts pieces without a price. */
export function proposalTotal(picks: { catalogId: string; quantity: number }[], products: CatalogItem[]): { total: number; unpriced: number } {
  let total = 0;
  let unpriced = 0;
  for (const p of picks) {
    const c = products.find((x) => x.id === p.catalogId);
    if (c?.price) total += c.price.amount * p.quantity;
    else unpriced += p.quantity;
  }
  return { total, unpriced };
}
