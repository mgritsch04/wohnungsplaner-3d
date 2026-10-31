import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalize, searchEntries } from './match';
import { buildFeatures, SECTIONS } from './features';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.tsx') ? [readFileSync(p, 'utf8')] : [];
  });
}

describe('feature search (#461)', () => {
  const features = buildFeatures();
  const titles = (q: string) => searchEntries(features, q).map((f) => f.title);

  it('ignores case and umlauts', () => {
    expect(normalize('Küche Größe')).toBe('kueche groesse');
    expect(titles('kuche')).toContain('Küche');
    expect(titles('kueche')).toContain('Küche');
    expect(titles('KÜCHE')).toContain('Küche');
  });

  it('puts title hits first and finds functions by keyword', () => {
    expect(titles('begehen')[0]).toBe('Begehen (Ich-Perspektive)');
    expect(titles('rundgang')).toContain('Begehen (Ich-Perspektive)');
    expect(titles('dunkelmodus')).toContain('Oberfläche');
    expect(titles('übergabe')[0]).toMatch(/Übergabeprotokoll/);
  });

  it('needs every word of the query', () => {
    expect(titles('plan drucken')).toContain('Plan drucken / PDF / PNG');
    expect(titles('plan xyzzy')).toEqual([]);
  });

  it('has unique ids', () => {
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
  });

  it('every section entry exists as a panel heading', () => {
    const all = sources(join(__dirname, '..', '..')).join('\n');
    for (const s of SECTIONS) expect(all, s.title).toContain(`title="${s.title}"`);
  });
});
