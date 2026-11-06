import type { Furniture, TableBase } from '../model/schema';
import { newId } from '../model/ids';
import type { CatalogItem } from './types';

/**
 * Own objects (#493): things that are not from IKEA or Möbelix – the bike, a desk of another
 * maker, a metal poster, a chair by a design brand. The user states name, size and colour; the
 * plan draws a stand-in of the chosen form. Sizes are what the user enters (or typical values the
 * templates offer, always as a hint to measure) – nothing is taken from a shop.
 */

/** A form the stand-in can take, with its everyday name and sensible start values (m). */
export interface OwnShape {
  shape: string;
  label: string;
  category: string;
  width: number;
  depth: number;
  height: number;
  /** Height of the base above the floor (wall objects). */
  elevation?: number;
  color: string;
  /** Does it block walking (a lamp stand, picture or rug does not)? */
  solid: boolean;
  /** Extra inputs the form offers. */
  options?: ('base' | 'secondary' | 'frameless' | 'photo')[];
}

export const OWN_SHAPES: OwnShape[] = [
  { shape: 'bike', label: 'Fahrrad', category: 'sport', width: 1.75, depth: 0.6, height: 1.05, color: '#2f5d8a', solid: true, options: ['secondary'] },
  { shape: 'desk', label: 'Schreibtisch', category: 'desk', width: 1.4, depth: 0.7, height: 0.74, color: '#e2dbd0', solid: true, options: ['base', 'secondary'] },
  { shape: 'table', label: 'Tisch (eckig)', category: 'table', width: 1.4, depth: 0.85, height: 0.75, color: '#b8946a', solid: true, options: ['base', 'secondary'] },
  { shape: 'table-round', label: 'Tisch (rund)', category: 'table', width: 1.0, depth: 1.0, height: 0.75, color: '#b8946a', solid: true, options: ['base', 'secondary'] },
  { shape: 'chair', label: 'Stuhl', category: 'chair', width: 0.45, depth: 0.52, height: 0.86, color: '#a88a68', solid: true, options: ['secondary'] },
  { shape: 'office-chair', label: 'Bürostuhl', category: 'chair', width: 0.65, depth: 0.65, height: 1.1, color: '#333538', solid: true },
  { shape: 'stool', label: 'Hocker', category: 'chair', width: 0.42, depth: 0.42, height: 0.5, color: '#3d3f42', solid: true },
  { shape: 'sofa', label: 'Sofa', category: 'sofa', width: 2.1, depth: 0.9, height: 0.82, color: '#7d8a96', solid: true, options: ['secondary'] },
  { shape: 'armchair', label: 'Sessel', category: 'sofa', width: 0.8, depth: 0.82, height: 0.85, color: '#a07858', solid: true, options: ['secondary'] },
  { shape: 'bed', label: 'Bett', category: 'bed', width: 1.65, depth: 2.08, height: 0.95, color: '#d9d4cc', solid: true },
  { shape: 'shelf', label: 'Regal', category: 'storage', width: 0.8, depth: 0.3, height: 1.9, color: '#e5ddd0', solid: true },
  { shape: 'wardrobe', label: 'Schrank', category: 'storage', width: 1.0, depth: 0.6, height: 2.0, color: '#ece8e1', solid: true },
  { shape: 'cabinet', label: 'Sideboard / Kommode', category: 'storage', width: 1.6, depth: 0.45, height: 0.8, color: '#c8b59a', solid: true },
  { shape: 'floor-lamp', label: 'Stehlampe', category: 'lighting', width: 0.35, depth: 0.35, height: 1.6, color: '#2d2d2d', solid: false },
  { shape: 'table-lamp', label: 'Tischlampe', category: 'lighting', width: 0.25, depth: 0.25, height: 0.45, elevation: 0.75, color: '#e7e2d8', solid: false },
  { shape: 'picture', label: 'Wandbild / Poster', category: 'decor', width: 0.5, depth: 0.03, height: 0.7, elevation: 1.35, color: '#c9a27e', solid: false, options: ['frameless', 'photo'] },
  { shape: 'panel', label: 'Spiegel / Glasplatte', category: 'decor', width: 0.6, depth: 0.03, height: 1.6, elevation: 0.3, color: '#cfd8dc', solid: false },
  { shape: 'wall-shelf', label: 'Wandregal', category: 'decor', width: 0.8, depth: 0.2, height: 0.25, elevation: 1.45, color: '#c8b59a', solid: false },
  { shape: 'rug', label: 'Teppich', category: 'textile', width: 1.6, depth: 2.3, height: 0.01, color: '#9aa5a0', solid: false },
  { shape: 'plant', label: 'Pflanze', category: 'decor', width: 0.4, depth: 0.4, height: 1.2, color: '#4f7a43', solid: false },
  { shape: 'pouf', label: 'Pouf / Sitzsack', category: 'chair', width: 0.55, depth: 0.55, height: 0.42, color: '#c9b79c', solid: true },
  { shape: 'cylinder', label: 'Zylinder (rund, z. B. Trommel, Eimer, Ständer)', category: 'decor', width: 0.4, depth: 0.4, height: 0.5, color: '#8d8579', solid: true },
  { shape: 'box', label: 'Quader (beliebiges Teil)', category: 'decor', width: 0.6, depth: 0.4, height: 0.5, color: '#b0a898', solid: true },
];

export const ownShapeOf = (shape: string): OwnShape => OWN_SHAPES.find((s) => s.shape === shape) ?? OWN_SHAPES[OWN_SHAPES.length - 1];

/** Typical sizes to start from – always a hint to measure the real piece. No product data. */
export interface OwnTemplate {
  id: string;
  label: string;
  shape: string;
  /** Size in cm. */
  width: number;
  depth: number;
  height: number;
  elevation?: number;
  frameless?: boolean;
}

export const OWN_TEMPLATES: OwnTemplate[] = [
  { id: 'bike-city', label: 'Fahrrad (City / Trekking)', shape: 'bike', width: 175, depth: 62, height: 105 },
  { id: 'bike-road', label: 'Rennrad', shape: 'bike', width: 170, depth: 42, height: 100 },
  { id: 'bike-e', label: 'E-Bike / Lastenrad', shape: 'bike', width: 190, depth: 65, height: 110 },
  { id: 'desk-standing', label: 'Höhenverstellbarer Schreibtisch 160×80', shape: 'desk', width: 160, depth: 80, height: 75 },
  { id: 'chair-office', label: 'Bürostuhl (Designer-Stuhl)', shape: 'office-chair', width: 68, depth: 68, height: 105 },
  { id: 'chair-dining', label: 'Esszimmerstuhl', shape: 'chair', width: 48, depth: 52, height: 82 },
  { id: 'poster-s', label: 'Poster 30×40 cm', shape: 'picture', width: 30, depth: 2, height: 40, elevation: 140 },
  { id: 'poster-m', label: 'Poster 50×70 cm', shape: 'picture', width: 50, depth: 2, height: 70, elevation: 130 },
  { id: 'poster-l', label: 'Poster 70×100 cm', shape: 'picture', width: 70, depth: 2, height: 100, elevation: 120 },
  { id: 'poster-metal', label: 'Metall-Poster ohne Rahmen 32×45 cm', shape: 'picture', width: 32, depth: 1, height: 45, elevation: 140, frameless: true },
];

/** What the user types into the dialog (lengths in cm, price in euro). */
export interface OwnForm {
  name: string;
  shape: string;
  category: string;
  width: number;
  depth: number;
  height: number;
  /** Mounting height above the floor, cm. */
  elevation: number;
  color: string;
  secondaryColor: string;
  base: TableBase | '';
  frameless: boolean;
  /** Photo for a picture, cropped to the picture's proportions (data URL). */
  texture: string;
  brand: string;
  productUrl: string;
  imageUrl: string;
  priceEur: string;
  note: string;
  fixed: boolean;
  owned: boolean;
}

export function emptyForm(shape = 'desk'): OwnForm {
  const s = ownShapeOf(shape);
  return {
    name: '',
    shape: s.shape,
    category: s.category,
    width: Math.round(s.width * 100),
    depth: Math.round(s.depth * 100),
    height: Math.round(s.height * 100),
    elevation: Math.round((s.elevation ?? 0) * 100),
    color: s.color,
    secondaryColor: '',
    base: '',
    frameless: false,
    texture: '',
    brand: '',
    productUrl: '',
    imageUrl: '',
    priceEur: '',
    note: '',
    fixed: true,
    owned: false,
  };
}

/** Switching the form keeps what the user typed, but takes the new form's start sizes while they were still the old ones. */
export function formWithShape(form: OwnForm, shape: string): OwnForm {
  const from = ownShapeOf(form.shape);
  const to = ownShapeOf(shape);
  const untouched = Math.round(from.width * 100) === form.width && Math.round(from.depth * 100) === form.depth && Math.round(from.height * 100) === form.height;
  return {
    ...form,
    shape: to.shape,
    category: form.category === from.category ? to.category : form.category,
    ...(untouched ? { width: Math.round(to.width * 100), depth: Math.round(to.depth * 100), height: Math.round(to.height * 100), elevation: Math.round((to.elevation ?? 0) * 100) } : {}),
    color: form.color === from.color ? to.color : form.color,
    base: '',
    frameless: to.options?.includes('frameless') ? form.frameless : false,
    texture: to.options?.includes('photo') ? form.texture : '',
  };
}

export function formFromTemplate(t: OwnTemplate): OwnForm {
  const s = ownShapeOf(t.shape);
  return { ...emptyForm(t.shape), name: t.label.replace(/\s*\(.*\)$/, '').replace(/ \d+×\d+( cm)?$/, ''), width: t.width, depth: t.depth, height: t.height, elevation: t.elevation ?? Math.round((s.elevation ?? 0) * 100), frameless: t.frameless ?? false };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Problems that keep the dialog from saving; empty = fine. */
export function validateOwnForm(f: OwnForm): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push('Bitte einen Namen eingeben.');
  const dims: [string, number][] = [
    ['Breite', f.width],
    ['Tiefe', f.depth],
    ['Höhe', f.height],
  ];
  for (const [label, v] of dims) if (!Number.isFinite(v) || v < 0.1 || v > 2000) out.push(`${label}: bitte zwischen 0,1 und 2000 cm eingeben.`);
  if (!Number.isFinite(f.elevation) || f.elevation < 0 || f.elevation > 1000) out.push('Höhe über dem Boden: bitte zwischen 0 und 1000 cm eingeben.');
  if (!HEX.test(f.color)) out.push('Farbe ungültig.');
  if (f.productUrl.trim() && !/^https?:\/\//i.test(f.productUrl.trim())) out.push('Der Link muss mit http:// oder https:// beginnen.');
  if (f.imageUrl.trim() && !/^https?:\/\//i.test(f.imageUrl.trim())) out.push('Die Bildadresse muss mit http:// oder https:// beginnen.');
  if (f.priceEur.trim() && !(Number(f.priceEur.replace(',', '.')) >= 0)) out.push('Preis: bitte eine Zahl eingeben.');
  return out;
}

const cmToM = (v: number) => Math.round(v * 10) / 1000;

/** The catalog entry for a form; `id` keeps the id when an entry is edited. */
export function ownItemFromForm(f: OwnForm, id = newId('own')): CatalogItem {
  const s = ownShapeOf(f.shape);
  const price = Number(f.priceEur.replace(',', '.'));
  const elevation = cmToM(f.elevation);
  const option = (o: NonNullable<OwnShape['options']>[number]) => s.options?.includes(o) ?? false;
  return {
    id,
    name: f.name.trim().slice(0, 200),
    category: f.category,
    width: cmToM(f.width),
    depth: cmToM(f.depth),
    height: cmToM(f.height),
    ...(elevation > 0 ? { elevation } : {}),
    color: f.color.toLowerCase(),
    model: {
      type: 'procedural',
      shape: f.shape,
      ...(option('secondary') && HEX.test(f.secondaryColor) ? { secondaryColor: f.secondaryColor.toLowerCase() } : {}),
      ...(option('base') && f.base ? { base: f.base } : {}),
      ...(option('frameless') && f.frameless ? { frameless: true } : {}),
      ...(option('photo') && f.texture ? { texture: f.texture } : {}),
    },
    ...(f.priceEur.trim() && Number.isFinite(price) && price >= 0 ? { price: { amount: price, currency: 'EUR' as const, status: 'user' as const, recordedAt: new Date().toISOString().slice(0, 10) } } : {}),
    ...(f.brand.trim() ? { brand: f.brand.trim().slice(0, 100) } : {}),
    ...(f.productUrl.trim() ? { productUrl: f.productUrl.trim().slice(0, 2000) } : {}),
    ...(f.imageUrl.trim() ? { imageUrl: f.imageUrl.trim().slice(0, 2000) } : {}),
    approximate: true,
    solid: s.solid,
    tags: ['eigenes', s.label.toLowerCase()],
    source: 'own',
    sourceName: 'Eigene Objekte',
    ...(f.note.trim() ? { description: f.note.trim().slice(0, 500) } : {}),
    ...(f.fixed ? { fixed: true } : {}),
    ...(f.owned ? { owned: true } : {}),
  };
}

const toCm = (m: number) => Math.round(m * 1000) / 10;

/** Back from a catalog entry to the dialog (to edit it). */
export function formFromOwnItem(i: CatalogItem): OwnForm {
  const m = i.model.type === 'procedural' ? i.model : null;
  const shape = i.model.type === 'procedural' ? i.model.shape : i.model.fallbackShape;
  return {
    ...emptyForm(),
    shape,
    name: i.name,
    category: i.category,
    width: toCm(i.width),
    depth: toCm(i.depth),
    height: toCm(i.height),
    elevation: toCm(i.elevation ?? 0),
    color: i.color,
    secondaryColor: m?.secondaryColor ?? '',
    base: m?.base ?? '',
    frameless: m?.frameless ?? false,
    texture: m?.texture ?? '',
    brand: i.brand ?? '',
    productUrl: i.productUrl ?? '',
    imageUrl: i.imageUrl ?? '',
    priceEur: i.price ? String(i.price.amount) : '',
    note: i.description ?? '',
    fixed: i.fixed === true,
    owned: i.owned === true,
  };
}

/** A placed piece as a catalog entry of its own, so it can be placed again (e.g. the desk from another maker). */
export function ownItemFromFurniture(f: Furniture): CatalogItem {
  return {
    id: newId('own'),
    name: f.name,
    category: f.category,
    width: f.width,
    depth: f.depth,
    height: f.height,
    ...(f.elevation > 0 ? { elevation: f.elevation } : {}),
    color: f.color,
    model: structuredClone(f.model),
    ...(f.price ? { price: { ...f.price } } : {}),
    ...(f.brand ? { brand: f.brand } : {}),
    ...(f.retailer ? { retailer: f.retailer } : {}),
    ...(f.productUrl ? { productUrl: f.productUrl } : {}),
    ...(f.imageUrl ? { imageUrl: f.imageUrl } : {}),
    approximate: f.approximate,
    solid: f.solid,
    tags: ['eigenes'],
    source: 'own',
    sourceName: 'Eigene Objekte',
    ...(f.fixed ? { fixed: true } : {}),
    ...(f.existing ? { owned: true } : {}),
  };
}

/** Longest side of a picture photo kept in the project and the size limit of the stored text (`ModelRef.texture`). */
export const PHOTO_MAX_SIDE = 480;
export const PHOTO_MAX_CHARS = 78_000;
