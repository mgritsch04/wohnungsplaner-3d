import type { CatalogItem } from './types';

/**
 * Built-in generic catalog. Dimensions are typical market sizes (meters);
 * prices are rough guide values ("estimate") and NOT offers of any retailer.
 */
type Def = [id: string, name: string, category: string, w: number, d: number, h: number, shape: string, color: string, price: number | null, extra?: Partial<CatalogItem>];

const est = (amount: number) => ({ amount, currency: 'EUR' as const, status: 'estimate' as const });

const DEFS: Def[] = [
  ['generic-sofa-3', 'Sofa 3-Sitzer', 'sofa', 2.1, 0.9, 0.82, 'sofa', '#7d8a96', 650, { tags: ['couch', 'wohnzimmer'] }],
  ['generic-sofa-2', 'Sofa 2-Sitzer', 'sofa', 1.6, 0.88, 0.82, 'sofa', '#8a7f72', 450, { tags: ['couch'] }],
  ['generic-sofa-corner', 'Ecksofa 260×180', 'sofa', 2.6, 1.8, 0.82, 'sofa-corner', '#6f7680', 1100, { tags: ['couch', 'eck'] }],
  ['generic-armchair', 'Sessel', 'sofa', 0.8, 0.82, 0.85, 'armchair', '#a07858', 280, { tags: ['sessel'] }],
  ['generic-bed-90', 'Einzelbett 90×200', 'bed', 0.95, 2.05, 0.9, 'bed', '#d9d4cc', 220, { tags: ['bett'] }],
  ['generic-bed-140', 'Doppelbett 140×200', 'bed', 1.45, 2.05, 0.9, 'bed', '#d9d4cc', 380, { tags: ['bett'] }],
  ['generic-bed-160', 'Doppelbett 160×200', 'bed', 1.65, 2.08, 0.95, 'bed', '#d9d4cc', 450, { tags: ['bett'] }],
  ['generic-bed-180', 'Doppelbett 180×200', 'bed', 1.85, 2.08, 0.95, 'bed', '#d9d4cc', 520, { tags: ['bett'] }],
  ['generic-nightstand', 'Nachttisch', 'bed', 0.42, 0.38, 0.5, 'cabinet', '#c8b59a', 60, { tags: ['nachtkästchen'] }],
  ['generic-dining-table-4', 'Esstisch 4 Personen', 'table', 1.4, 0.85, 0.75, 'table', '#b8946a', 280, { tags: ['esstisch'] }],
  ['generic-dining-table-6', 'Esstisch 6 Personen', 'table', 1.8, 0.9, 0.75, 'table', '#b8946a', 420, { tags: ['esstisch'] }],
  ['generic-round-table', 'Runder Tisch Ø 110', 'table', 1.1, 1.1, 0.75, 'table-round', '#b8946a', 250, { tags: ['tisch', 'rund'] }],
  ['generic-coffee-table', 'Couchtisch', 'table', 1.1, 0.6, 0.42, 'table', '#a88a68', 120, { tags: ['couchtisch'] }],
  ['generic-chair', 'Stuhl', 'chair', 0.45, 0.52, 0.86, 'chair', '#a88a68', 70, { tags: ['stuhl', 'esszimmer'] }],
  ['generic-office-chair', 'Bürostuhl', 'chair', 0.65, 0.65, 1.1, 'office-chair', '#333538', 180, { tags: ['büro'] }],
  ['generic-bar-stool', 'Barhocker', 'chair', 0.42, 0.42, 0.75, 'stool', '#3d3f42', 60, { tags: ['hocker'] }],
  ['generic-wardrobe-100', 'Kleiderschrank 100 cm', 'storage', 1.0, 0.6, 2.0, 'wardrobe', '#ece8e1', 250, { tags: ['schrank'] }],
  ['generic-wardrobe-150', 'Kleiderschrank 150 cm', 'storage', 1.5, 0.6, 2.2, 'wardrobe', '#ece8e1', 380, { tags: ['schrank'] }],
  ['generic-wardrobe-200', 'Kleiderschrank 200 cm', 'storage', 2.0, 0.6, 2.2, 'wardrobe', '#ece8e1', 480, { tags: ['schrank'] }],
  ['generic-shelf-80', 'Regal 80×190', 'storage', 0.8, 0.3, 1.9, 'shelf', '#e5ddd0', 90, { tags: ['bücherregal'] }],
  ['generic-shelf-cube', 'Würfelregal 4×4', 'storage', 1.47, 0.39, 1.47, 'shelf', '#f0eee9', 150, { tags: ['regal'] }],
  ['generic-sideboard', 'Sideboard', 'storage', 1.6, 0.45, 0.8, 'cabinet', '#c8b59a', 300, { tags: ['kommode'] }],
  ['generic-tv-sideboard', 'TV-Lowboard', 'storage', 1.8, 0.42, 0.45, 'cabinet', '#3e3a36', 200, { tags: ['tv', 'lowboard'] }],
  ['generic-storage-box', 'Aufbewahrungsbox', 'storage', 0.38, 0.3, 0.25, 'box', '#d6cfc2', 10, { tags: ['box', 'kiste', 'aufbewahrung'] }],
  ['generic-dresser', 'Kommode', 'storage', 0.8, 0.48, 0.9, 'dresser', '#ece8e1', 160, { tags: ['kommode'] }],
  ['generic-desk', 'Schreibtisch 140×70', 'desk', 1.4, 0.7, 0.74, 'desk', '#e2dbd0', 180, { tags: ['büro', 'homeoffice'] }],
  ['generic-desk-small', 'Schreibtisch 100×60', 'desk', 1.0, 0.6, 0.74, 'desk', '#e2dbd0', 110, { tags: ['büro'] }],
  ['generic-floor-lamp', 'Stehlampe', 'lighting', 0.35, 0.35, 1.6, 'floor-lamp', '#2d2d2d', 60, { solid: false, tags: ['lampe', 'licht'] }],
  ['generic-table-lamp', 'Tischlampe', 'lighting', 0.25, 0.25, 0.45, 'table-lamp', '#e7e2d8', 35, { solid: false, elevation: 0.75, tags: ['lampe'] }],
  ['generic-pendant', 'Pendelleuchte', 'lighting', 0.4, 0.4, 0.5, 'pendant', '#2d2d2d', 70, { solid: false, elevation: 1.9, tags: ['lampe', 'decke'] }],
  ['generic-rug-200', 'Teppich 200×300', 'textile', 2.0, 3.0, 0.01, 'rug', '#bfb3a2', 150, { solid: false, tags: ['teppich'] }],
  ['generic-rug-160', 'Teppich 160×230', 'textile', 1.6, 2.3, 0.01, 'rug', '#9aa5a0', 100, { solid: false, tags: ['teppich'] }],
  ['generic-curtain', 'Vorhang 140×250', 'textile', 1.4, 0.06, 2.5, 'curtain', '#e8e1d4', 40, { solid: false, tags: ['vorhang', 'gardine'] }],
  ['generic-plant', 'Zimmerpflanze groß', 'decor', 0.5, 0.5, 1.4, 'plant', '#4f7a43', 45, { solid: false, tags: ['pflanze'] }],
  ['generic-plant-small', 'Zimmerpflanze klein', 'decor', 0.3, 0.3, 0.5, 'plant', '#4f7a43', 15, { solid: false, tags: ['pflanze'] }],
  ['generic-tv', 'Fernseher 55"', 'decor', 1.23, 0.08, 0.72, 'tv', '#111111', 600, { elevation: 0.5, solid: false, tags: ['tv'] }],
  ['generic-mirror', 'Wandspiegel', 'decor', 0.6, 0.03, 1.6, 'panel', '#cfd8dc', 60, { elevation: 0.3, solid: false, tags: ['spiegel'] }],
  // kitchen
  ['generic-k-base-60', 'Unterschrank 60 cm', 'kitchen', 0.6, 0.6, 0.86, 'k-base', '#f2f0eb', 160, { kitchen: { type: 'base', front: 'doors', generated: false } }],
  ['generic-k-base-40', 'Unterschrank 40 cm', 'kitchen', 0.4, 0.6, 0.86, 'k-base', '#f2f0eb', 130, { kitchen: { type: 'base', front: 'doors', generated: false } }],
  ['generic-k-drawer-60', 'Schubladenschrank 60 cm', 'kitchen', 0.6, 0.6, 0.86, 'k-base', '#f2f0eb', 230, { kitchen: { type: 'base', front: 'drawers', generated: false } }],
  ['generic-k-sink-80', 'Spülenschrank 80 cm', 'kitchen', 0.8, 0.6, 0.86, 'k-sink', '#f2f0eb', 260, { kitchen: { type: 'sink', front: 'doors', generated: false } }],
  ['generic-k-wall-60', 'Oberschrank 60 cm', 'kitchen', 0.6, 0.35, 0.72, 'k-wall', '#f2f0eb', 110, { elevation: 1.45, kitchen: { type: 'wall', front: 'doors', generated: false } }],
  ['generic-k-wall-80', 'Oberschrank 80 cm', 'kitchen', 0.8, 0.35, 0.72, 'k-wall', '#f2f0eb', 130, { elevation: 1.45, kitchen: { type: 'wall', front: 'doors', generated: false } }],
  ['generic-k-tall-60', 'Hochschrank 60 cm', 'kitchen', 0.6, 0.6, 2.1, 'k-tall', '#f2f0eb', 350, { kitchen: { type: 'tall', front: 'doors', generated: false } }],
  ['generic-k-hood-60', 'Dunstabzugshaube 60 cm', 'appliance', 0.6, 0.45, 0.5, 'k-hood', '#b9bcc0', 250, { elevation: 1.5, solid: false, kitchen: { type: 'hood', front: 'appliance', generated: false } }],
  ['generic-k-oven', 'Backofen-Umbau 60 cm', 'appliance', 0.6, 0.6, 0.86, 'k-oven', '#2b2c2e', 450, { kitchen: { type: 'oven', front: 'appliance', generated: false } }],
  ['generic-k-cooktop', 'Kochfeld (Einbau) 60 cm', 'appliance', 0.58, 0.51, 0.05, 'k-cooktop', '#141414', 350, { elevation: 0.9, solid: false, kitchen: { type: 'cooktop', front: 'appliance', generated: false } }],
  ['generic-k-fridge', 'Kühlschrank freistehend', 'appliance', 0.6, 0.65, 1.85, 'k-fridge', '#e9eaec', 600, { kitchen: { type: 'fridge', front: 'appliance', generated: false } }],
  ['generic-k-dishwasher', 'Geschirrspüler 60 cm', 'appliance', 0.6, 0.6, 0.86, 'k-dishwasher', '#f2f0eb', 450, { kitchen: { type: 'dishwasher', front: 'appliance', generated: false } }],
  ['generic-washer', 'Waschmaschine', 'appliance', 0.6, 0.6, 0.85, 'washer', '#f4f5f6', 450, { tags: ['waschen'] }],
  // bathroom
  ['generic-toilet', 'WC wandhängend', 'bathroom', 0.37, 0.54, 0.8, 'toilet', '#ffffff', 250, { tags: ['wc'] }],
  ['generic-washbasin', 'Waschtisch 60 cm', 'bathroom', 0.6, 0.46, 0.85, 'washbasin', '#ffffff', 220, { tags: ['waschbecken'] }],
  ['generic-bathtub', 'Badewanne 170×75', 'bathroom', 1.7, 0.75, 0.58, 'bathtub', '#ffffff', 400, { tags: ['wanne'] }],
  ['generic-shower', 'Dusche 90×90', 'bathroom', 0.9, 0.9, 2.0, 'shower', '#dfe8ec', 500, { tags: ['dusche'] }],
];

export const GENERIC_CATALOG: CatalogItem[] = DEFS.map(([id, name, category, width, depth, height, shape, color, price, extra]) => ({
  id,
  name,
  category,
  width,
  depth,
  height,
  color,
  model: { type: 'procedural', shape },
  price: price === null ? undefined : est(price),
  approximate: true,
  solid: true,
  tags: [],
  source: 'generic',
  ...extra,
}));

export function findCatalogItem(id: string, extra: CatalogItem[] = []): CatalogItem | undefined {
  return GENERIC_CATALOG.find((c) => c.id === id) ?? extra.find((c) => c.id === id);
}

/** Original colours of a placed item's catalog entry (#187), or undefined when the entry is unknown. */
export function catalogColors(catalogId: string | undefined, extra: CatalogItem[] = []): { color: string; frontColor?: string } | undefined {
  const item = catalogId ? findCatalogItem(catalogId, extra) : undefined;
  return item && { color: item.color, frontColor: item.kitchen?.frontColor };
}
