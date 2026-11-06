import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildParts } from '../view3d/ProceduralModel';
import { FurnitureSchema } from '../model/schema';
import { budgetOf } from './ownTestHelpers';
import { coverCrop } from './ownImage';
import { createFurnitureFromCatalog } from './instantiate';
import { emptyForm, formFromOwnItem, formFromTemplate, formWithShape, OWN_SHAPES, OWN_TEMPLATES, ownItemFromForm, ownItemFromFurniture, ownShapeOf, validateOwnForm } from './own';
import { CATEGORIES } from './types';

const sizeOf = (shape: string, w: number, d: number, h: number, look = {}) => {
  const parts = buildParts(shape, w, d, h, '#4477aa', undefined, undefined, look);
  const bb = new THREE.Box3();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geo);
    m.position.set(...p.p);
    m.scale.set(...p.s);
    if (p.r) m.rotation.set(...p.r);
    m.updateMatrixWorld();
    bb.union(new THREE.Box3().setFromObject(m));
  }
  return { parts, size: bb.getSize(new THREE.Vector3()), min: bb.min, max: bb.max };
};

describe('own objects (#493)', () => {
  it('every form builds a model that fits its sizes', () => {
    for (const s of OWN_SHAPES) {
      const { parts, size, min, max } = sizeOf(s.shape, s.width, s.depth, s.height);
      expect(parts.length, s.shape).toBeGreaterThan(0);
      expect(size.x, s.shape).toBeLessThanOrEqual(s.width + 0.12);
      expect(size.z, s.shape).toBeLessThanOrEqual(s.depth + 0.12);
      expect(max.y, s.shape).toBeLessThanOrEqual(s.height + 0.12);
      expect(min.y, s.shape).toBeGreaterThanOrEqual(-1e-6);
      expect(size.x, s.shape).toBeGreaterThan(s.width * 0.6);
    }
  });

  it('every bike template draws wheels, frame and handlebar within its size', () => {
    for (const t of OWN_TEMPLATES.filter((x) => x.shape === 'bike')) {
      const { parts, size, max } = sizeOf('bike', t.width / 100, t.depth / 100, t.height / 100);
      expect(parts.length, t.id).toBeGreaterThan(20);
      expect(size.x, t.id).toBeGreaterThan((t.width / 100) * 0.85);
      expect(size.z, t.id).toBeGreaterThan((t.depth / 100) * 0.6);
      expect(max.y, t.id).toBeGreaterThan((t.height / 100) * 0.8);
    }
  });

  it('a picture shows the own photo, with or without a frame', () => {
    const framed = sizeOf('picture', 0.5, 0.03, 0.7, { photo: true });
    expect(framed.parts.filter((p) => p.textured)).toHaveLength(1);
    const bare = sizeOf('picture', 0.32, 0.01, 0.45, { photo: true, frameless: true });
    expect(bare.parts).toHaveLength(1);
    expect(bare.parts[0].textured).toBe(true);
    // without a photo: the drawn motif, nothing textured
    expect(sizeOf('picture', 0.5, 0.03, 0.7).parts.some((p) => p.textured)).toBe(false);
    expect(sizeOf('picture', 0.32, 0.01, 0.45, { frameless: true }).parts.some((p) => p.textured)).toBe(false);
  });

  it('form → catalog entry → placed piece keeps sizes, colour, form and flags', () => {
    const form = { ...emptyForm('desk'), name: ' Schreibtisch Eiche ', width: 160, depth: 80, height: 75, color: '#AA8855', secondaryColor: '#222222', base: 'sled' as const, brand: 'Hersteller X', productUrl: 'https://example.com/t', priceEur: '499,90', fixed: true, owned: false };
    expect(validateOwnForm(form)).toEqual([]);
    const item = ownItemFromForm(form, 'own-1');
    expect(item).toMatchObject({ id: 'own-1', name: 'Schreibtisch Eiche', category: 'desk', width: 1.6, depth: 0.8, height: 0.75, color: '#aa8855', source: 'own', fixed: true, brand: 'Hersteller X', solid: true });
    expect(item.model).toEqual({ type: 'procedural', shape: 'desk', secondaryColor: '#222222', base: 'sled' });
    expect(item.price).toMatchObject({ amount: 499.9, currency: 'EUR', status: 'user' });
    expect(item.owned).toBeUndefined();
    const f = createFurnitureFromCatalog(item, { x: 1, y: 2 });
    expect(FurnitureSchema.safeParse(f).success).toBe(true);
    expect(f).toMatchObject({ fixed: true, existing: false, name: 'Schreibtisch Eiche', catalogId: 'own-1' });
    // editing the entry gives the same form back
    expect(formFromOwnItem(item)).toMatchObject({ name: 'Schreibtisch Eiche', width: 160, depth: 80, height: 75, base: 'sled', secondaryColor: '#222222', priceEur: '499.9', fixed: true });
  });

  it('"habe ich schon" keeps it out of the budget; a loose piece is not fixed', () => {
    const own = createFurnitureFromCatalog(ownItemFromForm({ ...emptyForm('bike'), name: 'Fahrrad', owned: true, priceEur: '800' }), { x: 0, y: 0 });
    const bought = createFurnitureFromCatalog(ownItemFromForm({ ...emptyForm('office-chair'), name: 'Designer-Stuhl', priceEur: '1200' }), { x: 1, y: 1 });
    const loose = createFurnitureFromCatalog(ownItemFromForm({ ...emptyForm('chair'), name: 'Stuhl', fixed: false }), { x: 2, y: 2 });
    expect(own.existing).toBe(true);
    expect(bought.existing).toBe(false);
    expect(loose.fixed).toBeUndefined();
    expect(budgetOf([own, bought, loose])).toBe(1200);
  });

  it('wall objects keep their mounting height; a photo only counts for pictures', () => {
    const poster = ownItemFromForm({ ...emptyForm('picture'), name: 'Poster', texture: 'data:image/jpeg;base64,AAAA', frameless: true });
    expect(poster.elevation).toBeCloseTo(1.35);
    expect(poster.model).toMatchObject({ type: 'procedural', shape: 'picture', texture: 'data:image/jpeg;base64,AAAA', frameless: true });
    const chair = ownItemFromForm({ ...emptyForm('chair'), name: 'Stuhl', texture: 'data:image/jpeg;base64,AAAA', frameless: true });
    expect(chair.model).toEqual({ type: 'procedural', shape: 'chair' });
  });

  it('switching the form takes the new start sizes only while the old ones are untouched', () => {
    const fresh = emptyForm('desk');
    expect(formWithShape(fresh, 'bike')).toMatchObject({ shape: 'bike', category: 'sport', width: 175, depth: 60, height: 105 });
    const typed = { ...emptyForm('desk'), width: 123 };
    expect(formWithShape(typed, 'bike')).toMatchObject({ shape: 'bike', width: 123, category: 'sport' });
    expect(formWithShape({ ...emptyForm('desk'), category: 'storage' }, 'chair').category).toBe('storage');
  });

  it('templates fill the form and name it without the size', () => {
    const t = OWN_TEMPLATES.find((x) => x.id === 'poster-metal')!;
    expect(formFromTemplate(t)).toMatchObject({ shape: 'picture', width: 32, depth: 1, height: 45, elevation: 140, frameless: true });
    expect(formFromTemplate(OWN_TEMPLATES.find((x) => x.id === 'bike-city')!).name).toBe('Fahrrad');
    expect(formFromTemplate(OWN_TEMPLATES.find((x) => x.id === 'desk-standing')!).name).toBe('Höhenverstellbarer Schreibtisch');
    for (const tpl of OWN_TEMPLATES) {
      expect(OWN_SHAPES.some((s) => s.shape === tpl.shape), tpl.id).toBe(true);
      expect(CATEGORIES.some((c) => c.id === ownShapeOf(tpl.shape).category), tpl.id).toBe(true);
    }
  });

  it('asks for what is missing or wrong', () => {
    expect(validateOwnForm(emptyForm())).toEqual(['Bitte einen Namen eingeben.']);
    const bad = { ...emptyForm(), name: 'x', width: 0, productUrl: 'ftp://x', priceEur: 'abc', color: 'rot' };
    const problems = validateOwnForm(bad).join(' | ');
    expect(problems).toContain('Breite');
    expect(problems).toContain('http');
    expect(problems).toContain('Preis');
    expect(problems).toContain('Farbe');
  });

  it('a placed piece can be kept as an own object and placed again', () => {
    const f = createFurnitureFromCatalog(ownItemFromForm({ ...emptyForm('table-round'), name: 'Tisch rund', fixed: true, owned: true }), { x: 0, y: 0 });
    f.width = f.depth = 1.2;
    const again = ownItemFromFurniture(f);
    expect(again).toMatchObject({ name: 'Tisch rund', width: 1.2, source: 'own', fixed: true, owned: true });
    expect(again.id).not.toBe(f.catalogId);
    expect(createFurnitureFromCatalog(again, { x: 3, y: 3 })).toMatchObject({ width: 1.2, fixed: true, existing: true });
  });

  it('crops a photo to the picture proportions, centred', () => {
    expect(coverCrop(1000, 500, 0.5, 0.5)).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 });
    expect(coverCrop(500, 1000, 1, 1)).toEqual({ sx: 0, sy: 250, sw: 500, sh: 500 });
    expect(coverCrop(640, 480, 0.32, 0.45)).toMatchObject({ sy: 0, sh: 480 });
  });
});
