import { describe, expect, it } from 'vitest';
import { checkInterior, columnWidth, innerHeight, presetInterior, summarizeInterior } from './interior';
import { InteriorSchema, type Interior } from './schema';

const wardrobe = { width: 1.5, depth: 0.6, height: 2.2 };
const kinds = (f: typeof wardrobe, i: Interior) => checkInterior(f, i).map((x) => x.kind);

describe('Schrankinnenaufteilung (#85)', () => {
  it('rechnet Innenmaße ohne Bretter', () => {
    expect(innerHeight(wardrobe)).toBeCloseTo(2.16);
    expect(columnWidth(wardrobe, 2)).toBeCloseTo(0.72);
  });

  it('Voreinstellungen sind gültig und ohne Befund', () => {
    for (const preset of ['wardrobe', 'shelves', 'rod'] as const) {
      for (const f of [wardrobe, { width: 1, depth: 0.6, height: 2 }, { width: 2, depth: 0.6, height: 2.2 }]) {
        const i = presetInterior(f, preset);
        expect(InteriorSchema.safeParse(i).success).toBe(true);
        expect(checkInterior(f, i)).toEqual([]);
      }
    }
    expect(summarizeInterior(presetInterior(wardrobe, 'wardrobe'))).toMatchObject({ rods: 1, drawers: 2 });
  });

  it('meldet zu niedrige Schubladen und zu schmale Spalten', () => {
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'drawer', column: 0, z: 0, h: 0.08 }] })).toEqual(['drawer-height']);
    expect(kinds({ width: 0.5, depth: 0.6, height: 2 }, { columns: 2, parts: [{ kind: 'drawer', column: 0, z: 0, h: 0.2 }] })).toContain('drawer-width');
    expect(kinds({ width: 1, depth: 0.3, height: 2 }, { columns: 1, parts: [{ kind: 'drawer', column: 0, z: 0, h: 0.2 }] })).toContain('drawer-depth');
  });

  it('prüft Kleiderstangen: Breite, Tiefe, Hängelänge, Luft darüber', () => {
    expect(kinds({ width: 0.7, depth: 0.6, height: 2 }, { columns: 2, parts: [{ kind: 'rod', column: 0, z: 1.8 }] })).toContain('rod-width');
    expect(kinds({ width: 1, depth: 0.4, height: 2 }, { columns: 1, parts: [{ kind: 'rod', column: 0, z: 1.8 }] })).toContain('rod-depth');
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'rod', column: 0, z: 0.4 }] })).toEqual(['rod-hang']);
    // Boden unter der Stange kürzt die Hängelänge
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'rod', column: 0, z: 1.8 }, { kind: 'shelf', column: 0, z: 1.4 }] })).toEqual(['rod-hang']);
    // Fachboden unmittelbar über der Stange
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'rod', column: 0, z: 1.8 }, { kind: 'shelf', column: 0, z: 1.82 }] })).toEqual(['rod-hang']);
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'rod', column: 0, z: 1.8 }, { kind: 'shelf', column: 0, z: 1.9 }] })).toEqual([]);
  });

  it('erkennt Überschneidung, zu kleine Abstände und Teile außerhalb', () => {
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'drawer', column: 0, z: 0, h: 0.2 }, { kind: 'shelf', column: 0, z: 0.1 }] })).toEqual(['overlap']);
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'shelf', column: 0, z: 0.5 }, { kind: 'shelf', column: 0, z: 0.58 }] })).toEqual(['gap']);
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'shelf', column: 0, z: 2.5 }] })).toEqual(['range']);
    expect(kinds(wardrobe, { columns: 1, parts: [{ kind: 'shelf', column: 1, z: 0.5 }] })).toContain('range');
  });

  it('Teile in verschiedenen Spalten stören sich nicht', () => {
    expect(kinds(wardrobe, { columns: 2, parts: [{ kind: 'shelf', column: 0, z: 0.5 }, { kind: 'shelf', column: 1, z: 0.5 }] })).toEqual([]);
  });
});
