#!/usr/bin/env node
/**
 * IKEA Österreich: Artikelnummern → Produktliste für den Wohnungsplaner.
 *
 *   node scripts/ikea-products.mjs <liste.txt | "104.099.32, 2x 106.230.36"> [--out ordner] [--models] [--max 25]
 *
 * Ruft für jede Artikelnummer die ÖFFENTLICHE Produktseite ab (www.ikea.com/at/de/p/…,
 * eine Anfrage pro 1,5 s), liest deren schema.org-Daten mit demselben Parser wie die
 * App und schreibt `produktliste.json` (Format „wohnungsplaner-catalog“). Mit --models
 * wird zusätzlich je Produkt die von der Seite deklarierte 3D-Datei (GLB) geladen
 * (web-api.ikea.com/dimma/assets – laut robots.txt erlaubt). In der App:
 * Katalog › „Produktliste importieren“ → JSON und die .glb-Dateien gemeinsam wählen.
 *
 * Grenzen (bewusst): keine Suche, keine Konten/Merklisten, keine internen IKEA-APIs,
 * höchstens --max Artikel pro Lauf. 3D-Modelle und Bilder sind urheberrechtlich
 * geschützt: nur privat nutzen, nicht weitergeben oder ins Repository legen.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const input = args.find((a, i) => !a.startsWith('--') && !['--out', '--max'].includes(args[i - 1]));
if (!input) {
  console.error('Aufruf: node scripts/ikea-products.mjs <datei | "artikelnummern"> [--out ordner] [--models] [--max 25]');
  process.exit(2);
}
const outDir = resolve(opt('--out', 'ikea-import'));
const withModels = args.includes('--models');
const max = Math.min(50, Number(opt('--max', 25)) || 25);
const DELAY_MS = 1500;
const UA = 'wohnungsplaner-3d/0.1 (privates Planungswerkzeug; einzelne Produktseiten auf Nutzeranfrage)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the parser needs a DOM – provide jsdom's DOMParser in Node
globalThis.DOMParser = new JSDOM('').window.DOMParser;

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { parseArticleList, ikeaProductUrl, formatArticle, pageToCatalogEntry } = await vite.ssrLoadModule('/src/catalog/providers/ikeaList.ts');
  const { parseProductPage } = await vite.ssrLoadModule('/src/catalog/providers/structuredData.ts');

  const text = existsSync(input) ? readFileSync(input, 'utf-8') : input;
  const articles = parseArticleList(text);
  if (!articles.length) throw new Error('Keine IKEA-Artikelnummern gefunden (Format z. B. 104.099.32 oder S895.792.19).');
  if (articles.length > max) console.warn(`${articles.length} Artikel gefunden – nur die ersten ${max} werden abgerufen (--max).`);
  mkdirSync(outDir, { recursive: true });

  const items = [];
  const report = [];
  for (const a of articles.slice(0, max)) {
    const art = formatArticle(a);
    const url = ikeaProductUrl(a);
    process.stdout.write(`${art} … `);
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'de-AT' }, redirect: 'follow' });
    await sleep(DELAY_MS);
    if (!res.ok) {
      console.log(`HTTP ${res.status} – übersprungen`);
      report.push({ article: art, ok: false, reason: `HTTP ${res.status}` });
      continue;
    }
    const page = parseProductPage(await res.text(), res.url);
    let modelFile;
    if (withModels && page.modelUrl) {
      const m = await fetch(page.modelUrl, { headers: { 'user-agent': UA } });
      await sleep(DELAY_MS);
      if (m.ok && /gltf-binary|octet-stream/.test(m.headers.get('content-type') ?? '')) {
        modelFile = `${a.combination ? 's' : ''}${a.digits}.glb`;
        writeFileSync(join(outDir, modelFile), Buffer.from(await m.arrayBuffer()));
      } else {
        report.push({ article: art, ok: true, note: `Modell nicht geladen (HTTP ${m.status})` });
      }
    }
    const entry = pageToCatalogEntry(page, modelFile);
    if (!entry) {
      console.log('unvollständige Maße/Name – übersprungen');
      report.push({ article: art, ok: false, reason: 'Maße oder Name fehlen auf der Seite', quality: page.quality });
      continue;
    }
    items.push(entry); // the catalog lists each product once; the quantity is in bericht.json
    console.log(`${entry.name} · ${entry.width}×${entry.depth}×${entry.height} cm · ${entry.price ?? '–'} €${modelFile ? ' · Modell ' + modelFile : page.modelUrl ? ' · Modell verfügbar' : ' · kein Modell'}`);
    report.push({ article: art, ok: true, quantity: a.quantity, name: entry.name, model: modelFile ?? null, modelVariants: page.modelCandidates.length });
  }

  const list = { format: 'wohnungsplaner-catalog', version: 1, name: `IKEA Österreich ${new Date().toISOString().slice(0, 10)}`, units: 'cm', items };
  writeFileSync(join(outDir, 'produktliste.json'), JSON.stringify(list, null, 2));
  writeFileSync(join(outDir, 'bericht.json'), JSON.stringify(report, null, 2));
  console.log(`\n${items.length} Produkt(e) → ${join(outDir, 'produktliste.json')}`);
} finally {
  await vite.close();
}
