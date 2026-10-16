// Claude-Artefakt-Build (#129): listet nach `vite build --mode artifact` alle Dateien aus
// dist-artifact/ als „veröffentlichter Pfad → Quelldatei (+ Medientyp)“ und prüft die
// Grenzen eines Artefakts. Exit-Code 1 bei Verstoß.
//
//   node scripts/artifact-manifest.mjs [buildDir] [manifestFile]
//
// Ausgabe (JSON, Standard: artifact-manifest.json im Projektordner):
//   page   – absolute Quelle der Seite (index.html, wird als Seite veröffentlicht)
//   files  – { "assets/x.js": { from: "/abs/…", contentType: "text/javascript" }, … }
//            (alle übrigen Dateien; Pfade relativ, ohne führenden Schrägstrich)
//   stats  – Anzahl, Gesamtgröße, größte Datei
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const MB = 1024 * 1024;
export const LIMITS = {
  pageBytes: 16 * MB,
  textFileBytes: 16 * MB,
  binaryFileBytes: 15 * MB,
  totalBytes: 64 * MB,
  maxFiles: 255,
};

/** Nur gängige Web-Medientypen; alles andere ist ein Verstoß. */
const TYPES = {
  '.html': ['text/html', true],
  '.js': ['text/javascript', true],
  '.css': ['text/css', true],
  '.json': ['application/json', true],
  '.svg': ['image/svg+xml', true],
  '.txt': ['text/plain', true],
  '.wasm': ['application/wasm', false],
  '.png': ['image/png', false],
  '.jpg': ['image/jpeg', false],
  '.jpeg': ['image/jpeg', false],
  '.webp': ['image/webp', false],
  '.gif': ['image/gif', false],
  '.ico': ['image/x-icon', false],
  '.woff2': ['font/woff2', false],
  '.woff': ['font/woff', false],
  '.glb': ['model/gltf-binary', false],
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

const fmt = (n) => `${(n / MB).toFixed(2)} MB`;

export function buildManifest(buildDir) {
  const root = resolve(buildDir);
  const errors = [];
  const page = join(root, 'index.html');
  const files = {};
  let totalBytes = 0;
  let largest = { path: '', bytes: 0 };
  let count = 0;

  let all;
  try {
    all = walk(root).sort();
  } catch {
    return { manifest: null, errors: [`Build-Ordner ${root} fehlt – zuerst „npm run build:artifact“ ausführen.`] };
  }
  if (!all.includes(page)) errors.push('index.html fehlt im Build.');

  for (const abs of all) {
    const published = relative(root, abs).split(sep).join('/');
    const bytes = statSync(abs).size;
    const ext = extname(abs).toLowerCase();
    const type = TYPES[ext];
    count++;
    totalBytes += bytes;
    if (bytes > largest.bytes) largest = { path: published, bytes };
    if (!type) {
      errors.push(`${published}: Endung „${ext || '(keine)'}“ ist kein unterstützter Web-Medientyp.`);
      continue;
    }
    const [contentType, isText] = type;
    const limit = abs === page ? LIMITS.pageBytes : isText ? LIMITS.textFileBytes : LIMITS.binaryFileBytes;
    if (bytes > limit) errors.push(`${published}: ${fmt(bytes)} > ${fmt(limit)}.`);
    // the artifact service refuses text files with raw control characters (scripts/escape-control-chars.mjs)
    if (isText && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(readFileSync(abs, 'latin1')))
      errors.push(`${published}: enthält Steuerzeichen – „node scripts/escape-control-chars.mjs“ ausführen.`);
    if (abs !== page) files[published] = { from: abs, contentType };
  }
  if (count > LIMITS.maxFiles) errors.push(`${count} Dateien > ${LIMITS.maxFiles}.`);
  if (totalBytes > LIMITS.totalBytes) errors.push(`Gesamt ${fmt(totalBytes)} > ${fmt(LIMITS.totalBytes)}.`);

  // Die Seite darf nur relative Pfade und keine fremden Skripte/Stylesheets referenzieren.
  if (all.includes(page)) {
    const html = readFileSync(page, 'utf8');
    for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const ref = m[1];
      if (ref.startsWith('/')) errors.push(`index.html: absoluter Pfad „${ref}“ (muss relativ sein).`);
      else if (/^[a-z]+:/i.test(ref) && !ref.startsWith('data:')) errors.push(`index.html: externe Referenz „${ref}“.`);
      else if (!ref.startsWith('data:') && !ref.startsWith('#')) {
        const target = resolve(root, ref.split(/[?#]/)[0]);
        if (!all.includes(target)) errors.push(`index.html: „${ref}“ fehlt im Build.`);
      }
    }
  }

  return {
    manifest: {
      root,
      page,
      files,
      stats: { count, totalBytes, totalMB: Number((totalBytes / MB).toFixed(2)), largest },
      limits: LIMITS,
    },
    errors,
  };
}

const buildDir = process.argv[2] ?? 'dist-artifact';
const outFile = resolve(process.argv[3] ?? 'artifact-manifest.json');
const { manifest, errors } = buildManifest(buildDir);
if (manifest) {
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Artefakt-Manifest: ${outFile}`);
  console.log(`  ${manifest.stats.count} Dateien, ${fmt(manifest.stats.totalBytes)} gesamt; größte: ${manifest.stats.largest.path} (${fmt(manifest.stats.largest.bytes)})`);
}
if (errors.length) {
  console.error('Artefakt-Grenzen verletzt:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('  Alle Artefakt-Grenzen eingehalten.');
