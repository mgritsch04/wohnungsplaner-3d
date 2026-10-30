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
import { isPanelPair, normalizeShapeDims } from '../catalog/shapeDims';
import { z } from 'zod';
import { normalizePackSize } from '../catalog/packSize';
import { MOEBELIX_AT } from '../catalog/providers/registry';
import type { CatalogItem } from '../catalog/types';
import type { McpRuntime, SampleTool } from './claude';
import { MAX_ALTERNATIVES, MAX_FIELD, clipLines, searchLinks, type DesignOption, type DesignProposal, type DesignWishes, type RetailerChoice } from './design';
import { kitchenShoppingList, setKitchenProduct } from './kitchenDesign';

export const BROWSER = 'host:claude_browser';
export const IKEA_RETAILER = 'IKEA Österreich';
export const FOUND_SOURCE = 'Claude-Suche';
export const MAX_FOUND = 3;
const MAX_PAGE_TEXT = 9000;
/**
 * Time per attempt: one attempt may take up to 5 minutes (web search plus 1–3 product pages); in the
 * later rounds of a run (searchRun.ts) a little more, still below the 8 minutes of the local helper.
 * A run has no overall time limit any more: it goes on until every piece is found or settled.
 */
export const ITEM_TIMEOUT_MS = 5 * 60_000;
export const ITEM_TIMEOUT_LATE_MS = 7.5 * 60_000;
/** Attempts per piece before „nicht gefunden“: the first plus two with other search terms. */
export const SEARCH_ATTEMPTS = 3;
/** Waiting time when the local helper is busy with other requests, and how often to wait at most. */
export const BUSY_WAIT_MS = 20_000;
export const MAX_BUSY_WAITS = 15;

/**
 * Placeholders IKEA and Möbelix do not sell (electronics, household appliances outside the kitchen,
 * sanitary objects): not searched, shown as „nicht im Sortiment – selbst mitbringen“.
 */
export const NOT_SOLD = new Set(['generic-tv', 'generic-vacuum', 'generic-washer', 'generic-toilet', 'generic-bathtub', 'generic-shower']);
export const notSold = (catalogId: string) => NOT_SOLD.has(catalogId);
export const NOT_SOLD_TEXT = 'nicht im Sortiment von IKEA/Möbelix – selbst mitbringen';

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
    ...r.picks.flatMap((pick, index) => (pick.placeholder && !notSold(pick.catalogId) ? [{ roomId: r.roomId, index, catalogId: pick.catalogId }] : [])),
    ...(r.kitchen ? kitchenShoppingList(r.kitchen).filter((x) => x.part.catalogId === x.part.base).map((x) => ({ roomId: r.roomId, index: -1, kitchen: x.key, catalogId: x.part.base })) : []),
  ]);
}

/** Placeholders to search, biggest pieces first (they shape the room); beyond `max` they stay placeholders. */
export function searchTargets(p: DesignProposal, size: (catalogId: string) => number, max = Infinity): { targets: SearchTarget[]; skipped: number } {
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

/** The look of the flat a product has to fit (#436): the style plan of the concept and the room's accent. */
export interface ProductLook {
  idea: string;
  materials: string[];
  forms?: string;
  /** „Salbei #8a9a7b (Zweitfarbe 30 %)“ */
  palette: string[];
  accent?: string;
}

/** Request for one placeholder: find up to three fitting real products and read their data from the product pages. */
export function buildFindPrompt(option: DesignOption, item: CatalogItem, wishes: DesignWishes, retailer: RetailerChoice, mode: 'browser' | 'web', roomName: string, retry?: RetryHint | null, look?: ProductLook | null): string {
  const terms = searchTerms(option, item);
  const term = retry ? (terms[retry.attempt - 1] ?? terms[terms.length - 1]) : terms[0];
  const links = searchLinks(term, retailer).map((l) => l.url);
  const how =
    mode === 'browser'
      ? 'Nutze die Werkzeuge: open_page mit einer Suchseite unten, dann page_links für die Produktadressen, dann open_page auf 1–3 Produktseiten, um Maße und Preis zu lesen.'
      : 'Such zuerst mit der Websuche (z. B. „site:ikea.com/at …“ bzw. „site:moebelix.at …“) – die Suchseiten der Shops werden per JavaScript geladen und liefern beim Abruf oft keine Produkte. Dann die Produktseiten abrufen, um Maße und Preis zu lesen. Nur Seiten von www.ikea.com/at und www.moebelix.at abrufen.';
  return [
    `Suche für einen Wohnungsplaner echte Produkte bei ${retailer === 'ikea' ? 'IKEA Österreich' : retailer === 'moebelix' ? 'Möbelix Österreich' : 'IKEA Österreich oder Möbelix Österreich'}.`,
    '',
    `Gesucht für „${roomName}“: ${option.label}${option.reason ? ` – ${option.reason}` : ''}`,
    `Platz eingeplant für ca. ${cm(item.width)}×${cm(item.depth)}×${cm(item.height)} cm (Breite×Tiefe×Höhe); Das ist ein Richtwert: Produkte mit bis zu 20 % Abweichung in jeder Richtung sind gut brauchbar, das passendste verfügbare Produkt zählt mehr als die genauen Maße.`,
    ...(look
      ? [
          `Optik dieses Stücks: ${option.label}${option.color ? `, Farbe ${option.color}` : ''}.${option.features?.length ? ` Muss haben: ${option.features.join(', ')}.` : ''}`,
          `Stil der Wohnung (alle Möbel sollen zusammenpassen): ${look.idea}${look.materials.length ? ` Materialien: ${look.materials.join(', ')}.` : ''}${look.forms ? ` Formen: ${look.forms}` : ''} Palette: ${look.palette.join(', ')}${look.accent ? `; Akzent des Raums ${look.accent}` : ''}.${wishes.budget > 0 ? ` Gesamtbudget der Wohnung ${Math.round(wishes.budget)} €, also eher günstig.` : ''}`,
        ]
      : [
          ...(option.features?.length ? [`Muss haben: ${option.features.join(', ')}.`] : []),
          `Stil: ${wishes.style.slice(0, MAX_FIELD) || 'egal'}; Farben: ${clipLines(wishes.colors, MAX_FIELD) || 'egal'}${wishes.budget > 0 ? `; Gesamtbudget der Wohnung ${Math.round(wishes.budget)} €, also eher günstig` : ''}.`,
        ]),
    `Suchseiten: ${links.join(' , ')}`,
    how,
    ...(terms.length > 1 ? [`Findest du mit „${term}“ nichts, probier andere Begriffe: ${terms.filter((t) => t !== term).map((t) => `„${t}“`).join(', ')}.`] : []),
    ...(retry ? ['', ...retryLines(retry)] : []),
    '',
    'Regeln:',
    `- Höchstens ${MAX_FOUND} Produkte, das am besten passende zuerst. Wähle wie eine Innenarchitektin, nicht nur nach Maßen: Art und Funktionen müssen stimmen, dann Optik (Farbe, Material, Form) und wie es zum Stil der Wohnung passt, dann die Maße.`,
    '- Bewerte jedes Produkt in "fit" von 1 (passt nicht) bis 5 (passt genau): "masse", "optik", "funktionen", "stil"; und sag in "abweichung" in einem kurzen Satz, was vom Gesuchten abweicht (leer, wenn nichts).',
    ...(retailer === 'both' ? ['- Schau in BEIDEN Shops (IKEA und Möbelix). Gibt es in beiden passende Produkte, nimm mindestens eines von jedem Shop in die Liste.'] : []),
    '- Nur Angaben, die du auf der Produktseite gelesen hast: Name, Adresse der Produktseite, Preis in Euro, Breite/Tiefe/Höhe in cm. Nichts schätzen oder erfinden; fehlt eine Angabe, lass das Produkt weg.',
    '- Maße immer als Breite (links-rechts), Tiefe (vorn-hinten) und Höhe (oben-unten): Bei Vorhängen/Gardinen ist die Länge bzw. Fallhöhe die Höhe_cm (z. B. 250), die Tiefe nur wenige cm; bei Paaren/Sets die Breite eines Stücks. Bei Teppichen sind Länge/Breite die Fläche und die Höhe die Flordicke (wenige mm); bei Bildern ist die Tiefe die Rahmendicke.',
    '- Multipacks: Wird das Produkt nur als Packung/Set mit mehreren Stück verkauft (z. B. „3er-Set“, „4 Stück“, „Packung à 6“), gib „price“ als Preis der GANZEN Packung an und „pack_size“ als Stück pro Packung; Maße gelten pro Stück. Wird es einzeln verkauft, lass „pack_size“ weg (oder 1).',
    '- Suchbegriffe: kurz und allgemein (Produktart plus höchstens ein Merkmal wie Material oder Farbe). Keine Maße, keine Modell-/Serienamen und keine Artikelnummern in den Suchbegriff; Modellnamen nur, wenn du sie auf einer Shopseite gelesen hast.',
    '- Passt kein Produkt genau, nimm das passendste verfügbare und beginne „why“ mit „Alternative: …, weil …“ (was weicht ab: Maße, Farbe, Stil). Gib nur „nichts gefunden“ zurück, wenn die Produktart im Shop nicht vorkommt.',
    '- Keine Konten, keine Warenkörbe, nichts bestellen.',
    '',
    'Antworte zuletzt nur mit JSON in genau dieser Form:',
    '{"products":[{"name":"…","url":"https://…","price":199.99,"pack_size":1,"width_cm":200,"depth_cm":90,"height_cm":80,"why":"1 kurzer Satz","fit":{"masse":4,"optik":5,"funktionen":5,"stil":4},"abweichung":"…"}]}',
  ].join('\n');
}

/** Why the search is asked again: number of this attempt (2, 3 …) and what went wrong before. */
export interface RetryHint {
  attempt: number;
  previous: string;
}

function retryLines(r: RetryHint): string[] {
  return [
    `Das ist Versuch ${r.attempt}: Der vorige Versuch brachte nichts Verwertbares (${r.previous}).`,
    '- Dein bisheriger Suchbegriff war zu speziell. Nimm den Begriff dieses Versuchs (siehe oben) und such allgemeiner; die Größe darf um bis zu 30 % abweichen.',
    '- Lies die Angaben von der Produktseite (Abschnitt „Maße“ bzw. „Produktdetails“); ein sicheres Produkt ist besser als keines.',
    ...(r.attempt >= SEARCH_ATTEMPTS
      ? ['- Letzter Versuch: such nur nach der Produktart, nimm das nächstbeste Produkt dieser Kategorie mit passenden Maßen (Typ stimmt, Größe ähnlich) und nimm es auch, wenn Farbe, Stil oder Serie nicht stimmen.']
      : []),
  ];
}

/** Drops sizes, numbers and model-like words (CAPS, with digits) from a search term: shops rarely know them. */
export function plainTerm(s: string): string {
  return s
    .replace(/\d+([.,]\d+)?\s*(×|x)\s*\d+([.,]\d+)?(\s*(×|x)\s*\d+([.,]\d+)?)?(\s*cm)?/gi, '')
    .replace(/Ø\s*\d+|\d+([.,]\d+)?\s*(cm|mm|m|")/gi, '')
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !(w.length > 2 && w === w.toUpperCase() && /[A-ZÄÖÜ]/.test(w)))
    .join(' ')
    .trim();
}

/**
 * Search terms for a piece, one per attempt and each more general than the one before:
 * 1 specific (Claude's term without sizes/models), 2 product type plus one more word (style, material),
 * 3 only the product type (first word of the placeholder's name). Duplicates are skipped, so the list may be shorter.
 */
export function searchTerms(option: DesignOption, item: CatalogItem): string[] {
  const type = plainTerm(item.name).split(' ')[0] ?? '';
  const words = plainTerm(option.search || option.label).split(' ').filter(Boolean);
  const out: string[] = [];
  for (const t of [words.join(' '), words.slice(0, 2).join(' '), type]) {
    const v = t.trim().slice(0, MAX_FIELD);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  if (!out.length) out.push(plainTerm(item.name) || item.name);
  return out.slice(0, SEARCH_ATTEMPTS);
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
  /** Claude's rating 1–5 (mean of size, look, functions, style), when given. */
  fit?: number;
  /** What differs from the wanted piece, in Claude's words. */
  deviation?: string;
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
    const fit = fitOf(p.fit);
    const deviation = typeof p.abweichung === 'string' ? p.abweichung.trim().slice(0, 200) : '';
    out.push({ name, url, shop, price: Math.round(price * 100) / 100, packSize: normalizePackSize(p.pack_size) ?? 1, width: w / 100, depth: d / 100, height: h / 100, why: typeof p.why === 'string' ? p.why.trim().slice(0, 200) : '', ...(fit ? { fit } : {}), ...(deviation ? { deviation } : {}) });
    if (out.length >= MAX_FOUND) break;
  }
  // the best fit first; without ratings Claude's order stays
  return out.map((f, i) => ({ f, i })).sort((a, b) => (b.f.fit ?? 0) - (a.f.fit ?? 0) || a.i - b.i).map(({ f }) => f);
}

/** Mean of Claude's 1–5 ratings (size, look, functions, style); a function the product lacks weighs double. */
function fitOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v >= 1 && v <= 5 ? v : undefined;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const vals = ['masse', 'optik', 'funktionen', 'stil'].map((k) => num(o[k])).filter((x) => Number.isFinite(x) && x >= 1 && x <= 5);
  if (!vals.length) return undefined;
  const f = num(o.funktionen);
  const weighted = Number.isFinite(f) && f >= 1 && f <= 5 ? [...vals, f] : vals;
  return Math.round((weighted.reduce((a, b) => a + b, 0) / weighted.length) * 10) / 10;
}

/** How a real product differs from the planned piece: sizes from the catalogue (3 cm and more), then Claude's note. */
export function deviationText(product: Pick<CatalogItem, 'width' | 'depth' | 'height'>, planned: Pick<CatalogItem, 'width' | 'depth' | 'height'>, note = ''): string {
  const d = (a: number, b: number, more: string, less: string) => {
    const v = Math.round((a - b) * 100);
    return Math.abs(v) >= 3 ? `${Math.abs(v)} cm ${v > 0 ? more : less}` : '';
  };
  const parts = [d(product.width, planned.width, 'breiter', 'schmaler'), d(product.depth, planned.depth, 'tiefer', 'weniger tief'), d(product.height, planned.height, 'höher', 'niedriger')].filter(Boolean);
  return [parts.length ? parts.join(', ') : '', note].filter(Boolean).join('; ');
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
  if (code === 'rate_limited') return 'Claude-Kontingent erreicht';
  if (code === 'busy') return 'Helfer war mit anderen Anfragen ausgelastet';
  const msg = (e as { message?: unknown } | undefined)?.message;
  return `Suche fehlgeschlagen${typeof msg === 'string' && msg ? ` (${msg.slice(0, 120)})` : ''}`;
}

/** What happened to one attempt: products taken over, or the reason why not. */
export type AttemptResult = { ok: true } | { ok: false; reason: string };

/** Outcome of a whole search for one piece. `error` = the last attempt failed (time, helper, answer), not „nothing in the shop“. */
export type SearchOutcome = { ok: true; attempts: number } | { ok: false; attempts: number; reason: string; error: boolean };

/** Errors that end the whole search instead of being retried: the user's stop, Claude not usable, real quota limit. */
export function stopsSearch(e: unknown): boolean {
  const code = (e as { code?: string } | undefined)?.code;
  return code === 'cancelled' || code === 'rate_limited' || code === 'tools_unavailable' || code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed' || code === 'session_expired' || code === 'refused';
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });

/**
 * Searches one piece until something usable comes back (#350): nothing usable, a time-out
 * (`{ code: 'timeout' }`), an unreadable answer or a helper error lead to another attempt with
 * other search terms (`RetryHint`); a busy helper (`{ code: 'busy' }`) is waited for without
 * using up an attempt. The user's stop, a quota limit and „Claude not available here“ are thrown.
 */
export async function searchWithRetry(
  attempt: (retry: RetryHint | null) => Promise<AttemptResult>,
  {
    attempts = SEARCH_ATTEMPTS,
    after,
    busyWaitMs = BUSY_WAIT_MS,
    maxBusyWaits = MAX_BUSY_WAITS,
    stopped = () => false,
    signal,
  }: { attempts?: number; /** Earlier attempts (another round) and why they failed: the first attempt here is already a retry. */ after?: RetryHint; busyWaitMs?: number; maxBusyWaits?: number; stopped?: () => boolean; signal?: AbortSignal } = {},
): Promise<SearchOutcome> {
  const offset = after ? after.attempt - 1 : 0;
  let retry: RetryHint | null = after ?? null;
  let last: { reason: string; error: boolean } = { reason: 'kein passendes Produkt im Shop gefunden', error: false };
  let waits = 0;
  let n = 0;
  while (n < attempts) {
    if (n > 0 && (stopped() || signal?.aborted)) break;
    try {
      const r = await attempt(retry);
      n++;
      if (r.ok) return { ok: true, attempts: n };
      last = { reason: r.reason, error: false };
    } catch (e) {
      if ((e as { code?: string } | undefined)?.code === 'busy' && waits < maxBusyWaits && !signal?.aborted) {
        waits++;
        await pause(busyWaitMs, signal);
        continue;
      }
      if (stopsSearch(e)) throw e;
      n++;
      const err = e as { code?: string; limitMs?: number } | undefined;
      last = { reason: err?.code === 'timeout' ? `Zeitlimit von ${((err.limitMs ?? ITEM_TIMEOUT_MS) / 60_000).toLocaleString('de-AT')} Minuten überschritten` : searchErrorReason(e), error: true };
    }
    retry = { attempt: offset + n + 1, previous: last.reason };
  }
  const tries = offset + n;
  return { ok: false, attempts: tries, ...last, reason: tries > 1 ? `${last.reason} – nach ${tries} Versuchen` : last.reason };
}

/** Stable catalogue id per product page. */
export function foundId(url: string): string {
  let h = 0;
  for (const ch of url) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `found-${(h >>> 0).toString(36)}`;
}

/** Catalogue entry for a found product; shape and colour come from the placeholder (no 3D model of the product). */
export function foundToCatalog(f: FoundProduct, placeholder: CatalogItem, today = new Date().toISOString().slice(0, 10)): CatalogItem {
  const shape = placeholder.model.type === 'procedural' ? placeholder.model.shape : undefined;
  const flatDims = normalizeShapeDims(shape, { width: f.width, depth: f.depth, height: f.height });
  // a pair of curtain panels is sold as one product: both hang side by side
  if (shape === 'curtain' && isPanelPair(f.name)) flatDims.width = Math.round(flatDims.width * 2 * 1000) / 1000;
  return {
    id: foundId(f.url),
    name: f.name,
    category: placeholder.category,
    ...flatDims,
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
export function replaceWithFound(p: DesignProposal, roomId: string, index: number, found: { id: string; why: string; deviation?: string }[]): DesignProposal {
  if (!found.length) return p;
  return {
    ...p,
    rooms: p.rooms.map((r) => {
      if (r.roomId !== roomId || !r.picks[index]) return r;
      const { quantity, alternatives, ...old } = r.picks[index];
      const real = found.map((f) => ({ catalogId: f.id, reason: f.why || old.reason, placeholder: false, label: '', search: '', ...(f.deviation ? { deviation: f.deviation } : {}) }));
      const rest = [...real.slice(1), old, ...alternatives].filter((a, i, all) => a.catalogId !== real[0].catalogId && all.findIndex((x) => x.catalogId === a.catalogId) === i);
      // the line keeps its zone and the programme pieces it stands for (the new way, #442)
      const keep = { ...(old.zone ? { zone: old.zone } : {}), ...((old as { items?: string[] }).items ? { items: (old as { items?: string[] }).items } : {}) };
      const picks = r.picks.map((x, i) => (i === index ? { ...real[0], ...keep, quantity, alternatives: rest.slice(0, MAX_ALTERNATIVES + MAX_FOUND) } : x));
      return { ...r, picks };
    }),
  };
}

/** The kitchen part `key` in room `roomId` becomes the first found product (all modules with that key). */
export function replaceKitchenWithFound(p: DesignProposal, roomId: string, key: string, found: { id: string }[]): DesignProposal {
  if (!found.length) return p;
  return { ...p, rooms: p.rooms.map((r) => (r.roomId === roomId && r.kitchen ? { ...r, kitchen: setKitchenProduct(r.kitchen, key, found[0].id) } : r)) };
}
