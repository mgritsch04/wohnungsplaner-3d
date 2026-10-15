import type { KitchenModule, ModelRef, Price } from '../model/schema';

export const CATEGORIES = [
  { id: 'sofa', label: 'Sofas & Sessel' },
  { id: 'bed', label: 'Betten' },
  { id: 'table', label: 'Tische' },
  { id: 'chair', label: 'Stühle' },
  { id: 'storage', label: 'Schränke & Regale' },
  { id: 'desk', label: 'Schreibtische' },
  { id: 'lighting', label: 'Beleuchtung' },
  { id: 'textile', label: 'Teppiche & Vorhänge' },
  { id: 'kitchen', label: 'Küche' },
  { id: 'appliance', label: 'Geräte' },
  { id: 'bathroom', label: 'Bad' },
  { id: 'decor', label: 'Deko & Pflanzen' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  width: number;
  depth: number;
  height: number;
  /** Default height of the base above the floor (e.g. wall cabinets). */
  elevation?: number;
  color: string;
  model: ModelRef;
  price?: Price;
  brand?: string;
  retailer?: string;
  productUrl?: string;
  imageUrl?: string;
  /** Geometry is a generic approximation (always true for procedural models). */
  approximate: boolean;
  solid: boolean;
  tags: string[];
  kitchen?: KitchenModule;
  /** Where this catalog entry comes from. */
  source: 'generic' | 'imported';
  /** Identifier of the imported catalog file, if any. */
  sourceName?: string;
  description?: string;
}
