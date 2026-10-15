import type { Material } from './schema';

/** Built-in material library. Ids are stable and referenced from projects. */
export const DEFAULT_MATERIALS: Material[] = [
  { id: 'mat_wall_white', name: 'Wandfarbe Weiß', kind: 'paint', color: '#f2efe9', roughness: 0.9, metalness: 0, textureScale: 1 },
  { id: 'mat_wall_warmgrey', name: 'Wandfarbe Warmgrau', kind: 'paint', color: '#d8d2c8', roughness: 0.9, metalness: 0, textureScale: 1 },
  { id: 'mat_wall_sage', name: 'Wandfarbe Salbei', kind: 'paint', color: '#b9c4ad', roughness: 0.9, metalness: 0, textureScale: 1 },
  { id: 'mat_wall_blue', name: 'Wandfarbe Taubenblau', kind: 'paint', color: '#9fb1c2', roughness: 0.9, metalness: 0, textureScale: 1 },
  { id: 'mat_wall_terracotta', name: 'Wandfarbe Terrakotta', kind: 'paint', color: '#c98b6b', roughness: 0.9, metalness: 0, textureScale: 1 },
  { id: 'mat_concrete', name: 'Sichtbeton', kind: 'concrete', color: '#a7a6a2', roughness: 0.85, metalness: 0, textureScale: 1.2 },
  { id: 'mat_floor_oak', name: 'Parkett Eiche', kind: 'wood', color: '#c49a6c', roughness: 0.55, metalness: 0, textureScale: 1.2 },
  { id: 'mat_floor_walnut', name: 'Parkett Nuss', kind: 'wood', color: '#7a5636', roughness: 0.5, metalness: 0, textureScale: 1.2 },
  { id: 'mat_floor_tile_light', name: 'Fliese hell 60×60', kind: 'tile', color: '#e4e1db', roughness: 0.35, metalness: 0, textureScale: 0.6 },
  { id: 'mat_floor_tile_dark', name: 'Fliese anthrazit 30×60', kind: 'tile', color: '#4d4f52', roughness: 0.4, metalness: 0, textureScale: 0.6 },
  { id: 'mat_floor_stone', name: 'Naturstein', kind: 'stone', color: '#b8b1a5', roughness: 0.6, metalness: 0, textureScale: 0.8 },
  { id: 'mat_floor_carpet', name: 'Teppichboden grau', kind: 'carpet', color: '#8d8f93', roughness: 1, metalness: 0, textureScale: 1 },
  { id: 'mat_ceiling_white', name: 'Decke Weiß', kind: 'paint', color: '#fbfaf7', roughness: 0.95, metalness: 0, textureScale: 1 },
];

export const DEFAULT_WALL_MATERIAL_ID = 'mat_wall_white';
export const DEFAULT_FLOOR_MATERIAL_ID = 'mat_floor_oak';
export const DEFAULT_CEILING_MATERIAL_ID = 'mat_ceiling_white';

export function materialById(materials: Material[], id: string | undefined, fallbackId: string): Material {
  return (
    materials.find((m) => m.id === id) ??
    materials.find((m) => m.id === fallbackId) ??
    DEFAULT_MATERIALS.find((m) => m.id === fallbackId) ??
    DEFAULT_MATERIALS[0]
  );
}
