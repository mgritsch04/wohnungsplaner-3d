// GitHub-Pages-Build (#179): prüft nach `vite build --mode pages`, dass die installierbare
// Web-App vollständig ist. Exit-Code 1 bei Fehler.
//   node scripts/check-pages.mjs [buildDir]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dir = process.argv[2] ?? 'dist-pages';
const BASE = '/wohnungsplaner-3d/';
const errors = [];
const fail = (msg) => errors.push(msg);

const files = (function walk(d) {
  return readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [relative(dir, join(d, n)).split(sep).join('/')]));
})(dir);

const html = readFileSync(join(dir, 'index.html'), 'utf8');
for (const needle of [`rel="manifest" href="${BASE}manifest.webmanifest"`, `rel="apple-touch-icon" href="${BASE}icons/apple-touch-icon.png"`, 'apple-mobile-web-app-capable', "register('./sw.js')"]) {
  if (!html.includes(needle)) fail(`index.html: fehlt ${needle}`);
}
// alle lokalen Verweise in index.html liegen unter dem Pages-Unterpfad
for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
  if (!url.startsWith(BASE)) fail(`index.html: Pfad ohne Unterpfad ${url}`);
  else if (!existsSync(join(dir, url.slice(BASE.length)))) fail(`index.html: Datei fehlt ${url}`);
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone' || manifest.start_url !== './') fail('manifest: display/start_url');
for (const icon of manifest.icons) if (!existsSync(join(dir, icon.src))) fail(`manifest: Symbol fehlt ${icon.src}`);

const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
const m = sw.match(/const PRECACHE = (\[.*\]);/);
if (!m || sw.includes("'__VERSION__'")) fail('sw.js: Platzhalter nicht ersetzt');
const precache = m ? JSON.parse(m[1]) : [];
for (const p of precache) if (p !== './' && !existsSync(join(dir, p))) fail(`sw.js: vorgeladene Datei fehlt ${p}`);
for (const f of files) if (f !== 'index.html' && f !== 'sw.js' && !precache.includes(f)) fail(`sw.js: nicht vorgeladen ${f}`);

if (errors.length) {
  console.error(`check-pages: ${errors.length} Fehler\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-pages: ok (${files.length} Dateien, ${precache.length} vorgeladen)`);
