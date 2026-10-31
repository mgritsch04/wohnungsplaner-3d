/**
 * Budget tiers of the proposal (mgritsch04/wohnungsplaner-3d#436): the same furnishing at three
 * price levels – günstig, mittel, schön – each with a total. A tier is a price class: it scales
 * the guide prices of the placeholders (never found products, whose prices come from the product
 * pages) and tells Claude which quality to choose for the concept and for the product search.
 * The factors are rough guide values, not offers.
 */
export type Tier = 'guenstig' | 'mittel' | 'schoen';

export interface TierInfo {
  id: Tier;
  label: string;
  /** Factor on the guide prices of placeholders (the generic catalogue is calibrated to „mittel“). */
  factor: number;
  /** One line for the buttons. */
  blurb: string;
  /** What Claude should choose at this level. */
  quality: string;
}

export const TIERS: readonly TierInfo[] = [
  { id: 'guenstig', label: 'Günstig', factor: 0.6, blurb: 'Basisserien, nur das Nötige, wenige Extras', quality: 'Wähle die günstigste brauchbare Ausführung (Basisserien, Spanplatte/Folie ist in Ordnung), nur Pflichtteile und das, was der Raum wirklich braucht, möglichst wenig Deko.' },
  { id: 'mittel', label: 'Mittel', factor: 1, blurb: 'solide Qualität, rundes Gesamtbild', quality: 'Wähle solide Mittelklasse (haltbar, gutes Preis-Leistungs-Verhältnis) mit ein paar Akzenten, die den Raum rund machen.' },
  { id: 'schoen', label: 'Schön', factor: 1.8, blurb: 'hochwertige Materialien, Akzente, Beleuchtung', quality: 'Wähle hochwertige Ausführungen (Massivholz, Echtmaterialien, gute Stoffe), stimmige Akzente, Beleuchtung in mehreren Ebenen, Vorhänge, Teppich und Bilder, damit der Raum besonders schön wird.' },
];

export const DEFAULT_TIER: Tier = 'mittel';

export const tierInfo = (id: Tier | undefined): TierInfo => TIERS.find((t) => t.id === id) ?? TIERS[1]!;

/** Totals as `proposalTotal` returns them. */
export interface PriceTotal {
  real: number;
  placeholder: number;
  unpriced: number;
}

/** Total of the proposal at a tier: found products at their price, placeholders scaled. */
export function tierPrice(total: PriceTotal, tier: Tier | undefined): { real: number; placeholder: number; sum: number } {
  const placeholder = Math.round(total.placeholder * tierInfo(tier).factor);
  return { real: total.real, placeholder, sum: total.real + placeholder };
}

/** All three tiers side by side. */
export const tierTotals = (total: PriceTotal): { tier: TierInfo; sum: number }[] => TIERS.map((tier) => ({ tier, sum: tierPrice(total, tier.id).sum }));

/** The line for Claude's prompts (concept and product search). */
export const tierPromptLine = (tier: Tier | undefined): string => `Preisstufe „${tierInfo(tier).label}“: ${tierInfo(tier).quality}`;
