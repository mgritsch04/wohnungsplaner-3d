import type { FurnitureFinish } from './schema';

/** Surface type of a furniture body (#63); absent on an item = the model's built-in look. */
export const FURNITURE_FINISHES: { id: FurnitureFinish; label: string }[] = [
  { id: 'fabric', label: 'Stoff' },
  { id: 'leather', label: 'Leder' },
  { id: 'wood', label: 'Holz' },
  { id: 'lacquer', label: 'Lack' },
  { id: 'metal', label: 'Metall' },
  { id: 'stone', label: 'Stein' },
];

/** Small standard selection: material plus a typical colour, applied together with one click. */
export const FURNITURE_FINISH_PRESETS: { id: string; label: string; finish: FurnitureFinish; color: string }[] = [
  { id: 'fabric-grey', label: 'Stoff Grau', finish: 'fabric', color: '#8e9096' },
  { id: 'fabric-sand', label: 'Stoff Sand', finish: 'fabric', color: '#cdbb9c' },
  { id: 'velvet-green', label: 'Samt Grün', finish: 'fabric', color: '#3f6150' },
  { id: 'leather-cognac', label: 'Leder Cognac', finish: 'leather', color: '#8a4f2a' },
  { id: 'leather-black', label: 'Leder Schwarz', finish: 'leather', color: '#2b2a2a' },
  { id: 'wood-oak', label: 'Eiche hell', finish: 'wood', color: '#c9a477' },
  { id: 'wood-walnut', label: 'Nussbaum', finish: 'wood', color: '#6e4b31' },
  { id: 'lacquer-white', label: 'Weiß lackiert', finish: 'lacquer', color: '#f1f0ec' },
  { id: 'lacquer-black', label: 'Schwarz matt', finish: 'lacquer', color: '#2e2f31' },
  { id: 'metal-steel', label: 'Edelstahl', finish: 'metal', color: '#b7bbbf' },
  { id: 'stone-marble', label: 'Marmor Weiß', finish: 'stone', color: '#e6e3dd' },
];
