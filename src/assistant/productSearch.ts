/**
 * Claude looks for real products on ikea.com / moebelix.at for a placeholder of the furnishing
 * proposal (#350, stage 3). Two ways, both without an API key in the browser:
 * - Claude artifact in the Claude desktop app: Claude reads shop pages through the app's
 *   built-in browser (`host:claude_browser`), as page functions of one request;
 * - local planner (`npm run dev`): Claude Code on the same computer searches the web and reads
 *   pages of the two shops (through the local helper).
 * Like a person browsing the shop: public pages only, no accounts, no internal interfaces; only
 * www.ikea.com/at and www.moebelix.at may be opened. Everything Claude reports is checked here
 * (shop host, plausible size and price) before it becomes a catalogue entry.
 */
import { z } from 'zod';
import { normalizePackSize } from '../catalog/packSize';
import { MOEBELIX_AT } from '../catalog/providers/registry';
import type { CatalogItem } from '../catalog/types';
import type { McpRuntime, SampleTool } from './claude';
import { MAX_ALTERNATIVES, MAX_FIELD, searchLinks, type DesignOption, type DesignProposal, type DesignWishes, type RetailerChoice } from './design';
import { kitchenShoppingList, setKitchenProduct } from './kitchenDesign';

export const BROWSER = 'host:claude_browser';
export const IKEA_RETAILER = 'IKEA Österreich';
export const FOUND_SOURCE = 'Claude-Suche';
export const MAX_FOUND = 3;
const MAX_PAGE_TEXT = 9000;
/** Limits of the one-step search: placeholders searched per run, time per piece and per run. */
export const MAX_AUTO_SEARCH = 12;
export const ITEM_TIMEOUT_MS = 180_000;
export const TOTAL_TIMEOUT_MS = 20 * 60_000;

export interface SearchTarget {
  roomId: string;
  /** Pick of the room, or -1 for a kitchen part. */
  index: number;
  /** Kitchen part (`partKey`): every module of the kitchen with this key gets the found product. */
  kitchen?: string;
}

/** Placeholders still to search: picks and kitchen parts (one search per distinct kitchen module). */
export function openPlaceholders(p: DesignProposal): (SearchTarget & { catalogId: string })[] {
  return p.rooms.flatMap((r) => [
    ...r.picks.flatMap((pick, index) => (pick.placeholder ? [{ roomId: r.roomId, index, catalogId: pick.catalogId }] : [])),
    ...(r.kitchen ? kitchenShoppingList(r.kitchen).filter((x) => x.part.catalogId === x.part.base).map((x) => ({ roomId: r.roomId, index: -1, kitchen: x.key, catalogId: x.part.base })) : []),
  ]);
}

/** Placeholders to search, biggest pieces first (they shape the room); the rest stay placeholders. */
export function searchTargets(p: DesignProposal, size: (catalogId: string) => number, max = MAX_AUTO_SEARCH): { targets: SearchTarget[]; skipped: number } {
  const all = openPlaceholders(p);
  const ordered = [...all].sort((a, b) => size(b.catalogId) - size(a.catalogId));
  const take = ordered.slice(0, max);
  return { targets: take.map(({ catalogId: _id, ...t }) => t), skipped: all.length - take.length };
}

/** „noch 7 von 12 offen“: pieces not finished yet (the ones being searched right now included). */
export function searchLeft(s: { done: number; total: number }): string {
  const left = Math.max(0, s.total - s.done);
  return left === 0 ? `alle ${s.total} fertig` : `noch ${left} von ${s.total} offen`;
}

/** Product or search pages Claude may open: IKEA Austria and Möbelix only. */
export function shopOf(url: string): 'IKEA' | 'Möbelix' | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'www.ikea.com' && u.pathname.startsWith('/at/')) return 'IKEA';
    if (MOEBELIX_AT.hosts.includes(u.hostname)) return 'Möbelix';
  } catch {
    // not a URL
  }
  return null;
}

const text = (r: { content?: { type: string; text?: string }[]; payload?: unknown }) =>
  (r.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n') || (typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload ?? ''));

/** Page functions for one request in the artifact: open a shop page, read its text and its links. */
export function browserTools(mcp: McpRuntime, onStep?: (what: string) => void): SampleTool[] {
  const open = async (url: string, signal?: AbortSignal) => {
    if (!shopOf(url)) throw new Error('Nur Seiten von www.ikea.com/at und www.moebelix.at dürfen geöffnet werden.');
    onStep?.(url);
    await mcp.callTool(BROWSER, 'navigate', { url }, { signal });
  };
  return [
    {
      name: 'open_page',
      description: 'Öffnet eine Seite von www.ikea.com/at/… oder www.moebelix.at (Suche oder Produktseite) im Browser und liefert ihren Text (gekürzt).',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      execute: async (input, ctx) => {
        const url = String((input as { url?: unknown })?.url ?? '');
        await open(url, ctx?.signal);
        return text(await mcp.callTool(BROWSER, 'get_page_text', {}, { signal: ctx?.signal })).slice(0, MAX_PAGE_TEXT);
      },
    },
    {
      name: 'page_links',
      description: 'Liefert Links und Bedienelemente der zuletzt geöffneten Seite (gekürzt), z. B. um die Adresse einer Produktseite aus der Suche zu finden.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, ctx) => text(await mcp.callTool(BROWSER, 'read_page', { filter: 'interactive' }, { signal: ctx?.signal })).slice(0, MAX_PAGE_TEXT),
    },
  ];
}

/** True when the built-in browser of the Claude desktop app is reachable from this view. */
export async function browserAvailable(mcp: McpRuntime | null): Promise<boolean> {
  if (!mcp) return false;
  try {
    const r = await mcp.listTools();
    return !!r.servers?.some((s) => s.server === BROWSER);
  } catch {
    return false;
  }
}

const cm = (v: number) => Math.round(v * 100);

/** Request for one placeholder: find up to three fitting real products and read their data from the product pages. */
export function buildFindPrompt(option: DesignOption, item: CatalogItem, wishes: DesignWishes, retailer: RetailerChoice, mode: 'browser' | 'web', roomName: string): string {
  const links = searchLinks(option.search, retailer).map((l) => l.url);
  const how =
    mode === 'browser'
      ? 'Nutze die Werkzeuge: open_page mit einer Suchseite unten, dann page_links für die Produktadressen, dann open_page auf 1–3 Produktseiten, um Maße und Preis zu lesen.'
      : 'Nutze die Websuche (z. B. „site:ikea.com/at“ bzw. „site:moebelix.at“) oder ruf die Suchseiten unten ab, dann die Produktseiten, um Maße und Preis zu lesen. Nur Seiten von www.ikea.com/at und www.moebelix.at abrufen.';
  return [
    `Suche für einen Wohnungsplaner echte Produkte bei ${retailer === 'ikea' ? 'IKEA Österreich' : retailer === 'moebelix' ? 'Möbelix Österreich' : 'IKEA Österreich oder Möbelix Österreich'}.`,
    '',
    `Gesucht für „${roomName}“: ${option.label}${option.reason ? ` – ${option.reason}` : ''}`,
    `Platz eingeplant für ca. ${cm(item.width)}×${cm(item.depth)}×${cm(item.height)} cm (Breite×Tiefe×Höhe); ähnliche Größe bevorzugen.`,
    `Stil: ${wishes.style.slice(0, MAX_FIELD) || 'egal'}; Farben: ${wishes.colors.slice(0, MAX_FIELD) || 'egal'}${wishes.budget > 0 ? `; Gesamtbudget der Wohnung ${Math.round(wishes.budget)} €, also eher günstig` : ''}.`,
    `Suchseiten: ${links.join(' , ')}`,
    how,
    '',
    'Regeln:',
    `- Höchstens ${MAX_FOUND} Produkte, das am besten passende zuerst.`,
    ...(retailer === 'both' ? ['- Schau in BEIDEN Shops (IKEA und Möbelix). Gibt es in beiden passende Produkte, nimm mindestens eines von jedem Shop in die Liste.'] : []),
    '- Nur Angaben, die du auf der Produktseite gelesen hast: Name, Adresse der Produktseite, Preis in Euro, Breite/Tiefe/Höhe in cm. Nichts schätzen oder erfinden; fehlt eine Angabe, lass das Produkt weg.',
    '- Multipacks: Wird das Produkt nur als Packung/Set mit mehreren Stück verkauft (z. B. „3er-Set“, „4 Stück“, „Packung à 6“), gib „price“ als Preis der GANZEN Packung an und „pack_size“ als Stück pro Packung; Maße gelten pro Stück. Wird es einzeln verkauft, lass „pack_size“ weg (oder 1).',
    '- Keine Konten, keine Warenkörbe, nichts bestellen.',
    '',
    'Antworte zuletzt nur mit JSON in genau dieser Form:',
    '{"products":[{"name":"…","url":"https://…","price":199.99,"pack_size":1,"width_cm":200,"depth_cm":90,"height_cm":80,"why":"1 kurzer Satz"}]}',
  ].join('\n');
}

export interface FoundProduct {
  name: string;
  url: string;
  shop: 'IKEA' | 'Möbelix';
  /** Price of one pack (= one piece when `packSize` is 1). */
  price: number;
  /** Pieces per pack; 1 = sold singly. */
  packSize: number;
  width: number;
  depth: number;
  height: number;
  why: string;
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.]/g, '')) : NaN);
const FoundSchema = z.object({ products: z.array(z.record(z.string(), z.unknown())).catch([]) });

/** Checks Claude's report: shop pages only, plausible size (cm) and price; at most `MAX_FOUND`, no duplicates. */
export function parseFound(raw: unknown): FoundProduct[] {
  const parsed = FoundSchema.safeParse(Array.isArray(raw) ? { products: raw } : raw);
  if (!parsed.success) return [];
  const out: FoundProduct[] = [];
  for (const p of parsed.data.products) {
    const url = typeof p.url === 'string' ? p.url.trim() : '';
    const shop = shopOf(url);
    const name = typeof p.name === 'string' ? p.name.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    const [w, d, h] = [num(p.width_cm), num(p.depth_cm), num(p.height_cm)];
    const price = num(p.price);
    if (!shop || !name || out.some((x) => x.url === url)) continue;
    if (![w, d, h].every((v) => Number.isFinite(v) && v >= 1 && v <= 600)) continue;
    if (!Number.isFinite(price) || price <= 0 || price > 50_000) continue;
    out.push({ name, url, shop, price: Math.round(price * 100) / 100, packSize: normalizePackSize(p.pack_size) ?? 1, width: w / 100, depth: d / 100, height: h / 100, why: typeof p.why === 'string' ? p.why.trim().slice(0, 200) : '' });
    if (out.length >= MAX_FOUND) break;
  }
  return out;
}

/** Why nothing usable came back: no hit at all, or hits without complete data from the product page. */
export function notFoundReason(raw: unknown, usable: number): string {
  const list = Array.isArray(raw) ? raw : (raw as { products?: unknown } | null)?.products;
  const hits = Array.isArray(list) ? list.length : 0;
  if (usable > 0) return 'Produkt konnte nicht übernommen werden';
  if (!hits) return 'kein passendes Produkt im Shop gefunden';
  return `${hits === 1 ? '1 Treffer' : `${hits} Treffer`} ohne vollständige Angaben (Produktseite, Maße oder Preis fehlten bzw. unplausibel)`;
}

/** Reason for a failed search request (the user's stop is handled separately). */
export function searchErrorReason(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code;
  if (code === 'invalid_json' || code === 'empty_completion') return 'Antwort von Claude war nicht lesbar';
  if (code === 'rate_limited') return 'Claude-Kontingent erreicht bzw. Helfer ausgelastet';
  const msg = (e as { message?: unknown } | undefined)?.message;
  return `Suche fehlgeschlagen${typeof msg === 'string' && msg ? ` (${msg.slice(0, 120)})` : ''}`;
}

/** Stable catalogue id per product page. */
export function foundId(url: string): string {
  let h = 0;
  for (const ch of url) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `found-${(h >>> 0).toString(36)}`;
}

/** Catalogue entry for a found product; shape and colour come from the placeholder (no 3D model of the product). */
export function foundToCatalog(f: FoundProduct, placeholder: CatalogItem, today = new Date().toISOString().slice(0, 10)): CatalogItem {
  return {
    id: foundId(f.url),
    name: f.name,
    category: placeholder.category,
    width: f.width,
    depth: f.depth,
    height: f.height,
    ...(placeholder.elevation ? { elevation: placeholder.elevation } : {}),
    color: placeholder.color,
    model: structuredClone(placeholder.model),
    price: { amount: f.price, currency: 'EUR', status: 'confirmed', recordedAt: today, ...(f.packSize > 1 ? { packSize: f.packSize } : {}) },
    retailer: f.shop === 'IKEA' ? IKEA_RETAILER : MOEBELIX_AT.label,
    productUrl: f.url,
    approximate: true,
    solid: placeholder.solid,
    // a kitchen module keeps its role (base, sink, oven …), so it can be placed in the kitchen run
    ...(placeholder.kitchen ? { kitchen: { ...placeholder.kitchen } } : {}),
    tags: [...placeholder.tags],
    source: 'imported',
    sourceName: FOUND_SOURCE,
    description: 'Von Claude auf der Produktseite gelesen – Maße und Preis bitte dort prüfen.',
  };
}

/**
 * The placeholder at `index` in room `roomId` becomes the first found product; the other found
 * products and the placeholder itself become alternatives (placeholder first among the old ones).
 */
export function replaceWithFound(p: DesignProposal, roomId: string, index: number, found: { id: string; why: string }[]): DesignProposal {
  if (!found.length) return p;
  return {
    ...p,
    rooms: p.rooms.map((r) => {
      if (r.roomId !== roomId || !r.picks[index]) return r;
      const { quantity, alternatives, ...old } = r.picks[index];
      const real = found.map((f) => ({ catalogId: f.id, reason: f.why || old.reason, placeholder: false, label: '', search: '' }));
      const rest = [...real.slice(1), old, ...alternatives].filter((a, i, all) => a.catalogId !== real[0].catalogId && all.findIndex((x) => x.catalogId === a.catalogId) === i);
      const picks = r.picks.map((x, i) => (i === index ? { ...real[0], quantity, alternatives: rest.slice(0, MAX_ALTERNATIVES + MAX_FOUND) } : x));
      return { ...r, picks };
    }),
  };
}

/** The kitchen part `key` in room `roomId` becomes the first found product (all modules with that key). */
export function replaceKitchenWithFound(p: DesignProposal, roomId: string, key: string, found: { id: string }[]): DesignProposal {
  if (!found.length) return p;
  return { ...p, rooms: p.rooms.map((r) => (r.roomId === roomId && r.kitchen ? { ...r, kitchen: setKitchenProduct(r.kitchen, key, found[0].id) } : r)) };
}
