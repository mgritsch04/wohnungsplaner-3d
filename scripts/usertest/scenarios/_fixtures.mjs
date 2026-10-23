// Lädt die synthetischen Test-Fixtures aus e2e/fixtures.ts (TypeScript) für die User-Test-Szenarien: bündelt sie einmal mit rolldown.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let cached;
export async function loadFixtures() {
  if (cached) return cached;
  const root = resolve(new URL('../../..', import.meta.url).pathname);
  const out = join(mkdtempSync(join(tmpdir(), 'wp-fixtures-')), 'fixtures.mjs');
  execFileSync('npx', ['rolldown', 'e2e/fixtures.ts', '-f', 'esm', '--platform', 'node', '-o', out, '--external', '@playwright/test'], { cwd: root, stdio: 'ignore' });
  cached = await import(pathToFileURL(out).href);
  return cached;
}
