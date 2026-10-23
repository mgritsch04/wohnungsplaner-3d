import { readdirSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';

function collisions(dir: string, out: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collisions(full, out);
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(name)) continue;
    // Importe ohne Endung lösen auf ts/tsx auf; Windows/macOS ignorieren zusätzlich die Groß-/Kleinschreibung.
    const key = parse(name).name.toLowerCase();
    const other = seen.get(key);
    if (other) out.push(`${full} <-> ${other}`);
    seen.set(key, full);
  }
  return out;
}

describe('Modulnamen', () => {
  it('kein Ordner enthält Module, die sich nur durch Groß-/Kleinschreibung oder Endung unterscheiden', () => {
    const dups = collisions(join(__dirname));
    expect(dups).toEqual([]);
  });
});
