import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES, rulebookMarkdown, rulebookPrompt, rulesFor } from './rulebook';

const DOC = 'docs/EINRICHTUNG_REGELWERK.md';

describe('rule book (#436)', () => {
  it('has unique ids, a reason and a source for every rule', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.why.length, r.id).toBeGreaterThan(10);
      expect(r.source.length, r.id).toBeGreaterThan(3);
      expect(r.use.length, r.id).toBeGreaterThan(0);
    }
  });

  it('gives each room type its own rules plus light, room and style', () => {
    const living = rulesFor('living').map((r) => r.id);
    expect(living).toEqual(expect.arrayContaining(['W2', 'W5', 'L1', 'R1', 'SL2']));
    expect(living).not.toContain('K2');
    expect(rulesFor('kitchen').map((r) => r.id)).toEqual(expect.arrayContaining(['K1', 'K2', 'K5', 'E3']));
    expect(rulesFor('bedroom').map((r) => r.id)).toEqual(expect.arrayContaining(['S1', 'S3', 'S4', 'ST1']));
    // a bath gets no style tips
    expect(rulesFor('bath').some((r) => r.level === 'T')).toBe(false);
    expect(rulebookPrompt('living')).toContain('- W2 Couchtisch 40–45 cm');
  });

  it('is written to docs/EINRICHTUNG_REGELWERK.md', () => {
    const md = rulebookMarkdown();
    if (process.env.WP_WRITE_RULEBOOK) writeFileSync(DOC, md);
    expect(readFileSync(DOC, 'utf8'), 'Regelwerk geändert: WP_WRITE_RULEBOOK=1 npx vitest run src/design/rulebook.test.ts').toBe(md);
  });
});
