/**
 * IKEA-Planung + Produktliste → echte Namen und Preise für die Korpusse.
 *
 * Die Planungs-JSON kennt nur Artikelnummern und Maße. Namen und Preise stehen auf den
 * öffentlichen IKEA-Produktseiten; `scripts/ikea-products.mjs --plan <planung.json>` holt
 * sie für genau die Artikel der Planung und schreibt eine Produktliste. Beim Import
 * werden beide Dateien über die Artikelnummer (8 Ziffern) zusammengeführt:
 *   Korpus-Preis = Preis des Korpus + Preise seiner Einbauteile (Böden, Stangen, Schubladen …),
 * soweit die Produktliste sie enthält. Fehlendes wird gemeldet, nie geschätzt.
 */
import type { CatalogEntry } from '../catalogFormat';
import { formatArticle, type ArticleRef } from './ikeaList';
import { describeFittings, type IkeaPlan } from './ikeaPlanner';

export interface PlanPrice {
  amount: number;
  recordedAt?: string;
  /** estimate = nicht alle Einbauteile hatten einen Preis in der Produktliste */
  status: 'user' | 'estimate';
}

export interface EnrichedFurniture {
  name?: string;
  productUrl?: string;
  imageUrl?: string;
  price?: PlanPrice;
}

export interface PlanEnrichment {
  /** parallel zu `plan.items` (und damit zu `placeIkeaPlan(...).furniture`) */
  furniture: EnrichedFurniture[];
  /** Korpusse mit Namen aus der Produktliste */
  named: number;
  /** Korpusse mit Preis */
  priced: number;
  /** Hinweise für den Nutzer (Deutsch); leer, wenn alles zugeordnet wurde */
  notes: string[];
}

const digitsOf = (articleNumber: string | undefined): string | null => {
  const d = (articleNumber ?? '').replace(/\D/g, '');
  return d.length === 8 ? d : null;
};

/** Index der Produktliste nach Artikelnummer (8 Ziffern); bei Dubletten gewinnt der erste Eintrag. */
export function indexByArticle(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  const m = new Map<string, CatalogEntry>();
  for (const e of entries) {
    const d = digitsOf(e.articleNumber);
    if (d && !m.has(d)) m.set(d, e);
  }
  return m;
}

/** Alle Artikel der Planung (Stückliste, sonst Korpusse + Einbauteile) für das Hilfsskript. */
export function planArticles(plan: IkeaPlan): ArticleRef[] {
  const out = new Map<string, ArticleRef>();
  const add = (digits: string, combination: boolean, quantity: number) => {
    const key = (combination ? 's' : '') + digits;
    out.set(key, { digits, combination, quantity: (out.get(key)?.quantity ?? 0) + quantity });
  };
  if (plan.itemList.length) {
    for (const i of plan.itemList) add(i.itemNo, i.itemType === 'SPR', i.quantity);
  } else {
    for (const i of plan.items) {
      add(i.itemNo, i.itemType === 'SPR', 1);
      for (const [no, n] of Object.entries(i.fittingArticles)) add(no, false, n);
    }
  }
  return [...out.values()];
}

const eur = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export function enrichPlacement(plan: IkeaPlan, entries: CatalogEntry[]): PlanEnrichment {
  const index = indexByArticle(entries);
  const notes: string[] = [];
  const missing = new Set<string>();
  let named = 0;
  let priced = 0;
  let partial = 0;
  const used = new Map<string, number>(); // bereits Korpus/Einbauteil zugeordnete Stückzahlen je Artikel

  const furniture = plan.items.map((item): EnrichedFurniture => {
    const frame = index.get(item.itemNo);
    used.set(item.itemNo, (used.get(item.itemNo) ?? 0) + 1);
    for (const [no, n] of Object.entries(item.fittingArticles)) used.set(no, (used.get(no) ?? 0) + n);
    if (!frame) {
      missing.add(item.itemNo);
      return {};
    }
    named++;
    const fit = describeFittings(item.fittings);
    const out: EnrichedFurniture = {
      name: `${frame.name}${fit ? ` (${fit})` : ''}`.slice(0, 200),
      productUrl: frame.productUrl,
      imageUrl: frame.imageUrl,
    };
    if (frame.price === undefined) {
      missing.add(`${item.itemNo} (Preis)`);
      return out;
    }
    let amount = frame.price;
    let complete = true;
    for (const [no, n] of Object.entries(item.fittingArticles)) {
      const p = index.get(no)?.price;
      if (p === undefined) {
        complete = false;
        missing.add(no);
      } else amount += p * n;
    }
    if (!complete) partial++;
    priced++;
    out.price = { amount: Math.round(amount * 100) / 100, recordedAt: frame.priceDate, status: complete ? 'user' : 'estimate' };
    return out;
  });

  if (missing.size) {
    const list = [...missing].slice(0, 6).map((m) => formatArticle({ digits: m.slice(0, 8), combination: false }) + m.slice(8));
    notes.push(`Nicht in der Produktliste gefunden: ${list.join(', ')}${missing.size > 6 ? ` … (+${missing.size - 6})` : ''}.`);
  }
  if (partial) notes.push(`${partial} Korpus(se) mit unvollständigem Preis (Einbauteile ohne Preis) – als Schätzwert markiert.`);

  // Stücklistenartikel ohne Geometrie in der Planung (z. B. Scharniere, Türen): nicht auf Korpusse verteilt.
  let leftoverParts = 0;
  let leftoverSum = 0;
  let leftoverUnpriced = 0;
  for (const i of plan.itemList) {
    const rest = i.quantity - (used.get(i.itemNo) ?? 0);
    if (rest <= 0) continue;
    leftoverParts += rest;
    const p = index.get(i.itemNo)?.price;
    if (p === undefined) leftoverUnpriced += rest;
    else leftoverSum += p * rest;
  }
  if (leftoverParts) {
    notes.push(
      `${leftoverParts} Teil(e) der IKEA-Stückliste haben keine eigene Position im Plan (z. B. Türen, Scharniere)${leftoverSum ? ` – ${eur(leftoverSum)} laut Produktliste stehen NICHT im Budget` : ''}${leftoverUnpriced ? `, ${leftoverUnpriced} Teil(e) ohne Preis` : ''}.`,
    );
  }
  return { furniture, named, priced, notes };
}
