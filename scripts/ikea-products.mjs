#!/usr/bin/env node
/**
 * IKEA Österreich: Artikelnummern → Produktliste für den Wohnungsplaner.
 *
 *   node scripts/ikea-products.mjs <liste.txt | "104.099.32, 2x 106.230.36"> [--out ordner] [--models] [--max 25]
 *   node scripts/ikea-products.mjs --plan <planung.json> [--out ordner] [--max 50]
 *
 * Ruft für jede Artikelnummer die ÖFFENTLICHE Produktseite ab (www.ikea.com/at/de/p/…,
 * eine Anfrage pro 1,5 s), liest deren schema.org-Daten mit demselben Parser wie die
 * App und schreibt `produktliste.json` (Format „wohnungsplaner-catalog“). Mit --models
 * wird zusätzlich je Produkt die von der Seite deklarierte 3D-Datei (GLB) geladen
 * (web-api.ikea.com/dimma/assets – laut robots.txt erlaubt). In der App:
 * Katalog › „Produktliste importieren“ → JSON und die .glb-Dateien gemeinsam wählen.
 *
 * Mit --plan werden die Artikelnummern aus einer gespeicherten IKEA-Planung (PAX-Planer,
 * siehe docs/IKEA_PLANUNG_JSON.md) gelesen; die entstehende produktliste.json wird in der App
 * gemeinsam mit der Planungs-JSON importiert (Namen und Preise der Korpusse).
 *
 * Grenzen (bewusst): keine Suche, keine Konten/Merklisten, keine internen IKEA-APIs,
 * höchstens --max Artikel pro Lauf. 3D-Modelle und Bilder sind urheberrechtlich
 * geschützt: nur privat nutzen, nicht weitergeben oder ins Repository legen.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchArticle, loadIkeaModules, politeFetcher } from './lib/ikea-fetch.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const planFile = opt('--plan', null);
const input = args.find((a, i) => !a.startsWith('--') && !['--out', '--max', '--plan'].includes(args[i - 1]));
if (!input && !planFile) {
  console.error('Aufruf: node scripts/ikea-products.mjs <datei | "artikelnummern"> [--out ordner] [--models] [--max 25]\n    oder: node scripts/ikea-products.mjs --plan <planung.json> [--out ordner]');
  process.exit(2);
}
const outDir = resolve(opt('--out', 'ikea-import'));
const withModels = args.includes('--models');
const max = Math.min(50, Number(opt('--max', planFile ? 50 : 25)) || 25);

const mods = await loadIkeaModules();
const { vite } = mods;
try {
  let articles;
  if (planFile) {
    const { parseIkeaPlannerJson } = await vite.ssrLoadModule('/src/catalog/providers/ikeaPlanner.ts');
    const { planArticles } = await vite.ssrLoadModule('/src/catalog/providers/ikeaPlanProducts.ts');
    articles = planArticles(parseIkeaPlannerJson(readFileSync(planFile, 'utf-8')));
    console.log(`${articles.length} verschiedene Artikel in der Planung.`);
  } else {
    const text = existsSync(input) ? readFileSync(input, 'utf-8') : input;
    articles = mods.parseArticleList(text);
  }
  if (!articles.length) throw new Error('Keine IKEA-Artikelnummern gefunden (Format z. B. 104.099.32 oder S895.792.19).');
  if (articles.length > max) console.warn(`${articles.length} Artikel gefunden – nur die ersten ${max} werden abgerufen (--max).`);
  mkdirSync(outDir, { recursive: true });

  const get = politeFetcher();
  const items = [];
  const report = [];
  for (const a of articles.slice(0, max)) {
    process.stdout.write(`${mods.formatArticle(a)} … `);
    const r = await fetchArticle(mods, get, a, { withModel: withModels });
    if (r.model) writeFileSync(join(outDir, r.model.file), r.model.bytes);
    if (!r.entry) {
      console.log(`${r.reason} – übersprungen`);
      report.push({ article: r.article, ok: false, reason: r.reason, quality: r.page?.quality });
      continue;
    }
    const entry = r.entry;
    items.push(entry); // the catalog lists each product once; the quantity is in bericht.json
    console.log(`${entry.name} · ${entry.width}×${entry.depth}×${entry.height} cm · ${entry.price ?? '–'} €${r.model ? ' · Modell ' + r.model.file : r.page.modelUrl ? ' · Modell verfügbar' : ' · kein Modell'}`);
    if (r.note) report.push({ article: r.article, ok: true, note: r.note });
    report.push({ article: r.article, ok: true, quantity: a.quantity, name: entry.name, model: r.model?.file ?? null, modelVariants: r.page.modelCandidates.length });
  }

  const list = { format: 'wohnungsplaner-catalog', version: 1, name: `IKEA Österreich ${new Date().toISOString().slice(0, 10)}`, units: 'cm', items };
  writeFileSync(join(outDir, 'produktliste.json'), JSON.stringify(list, null, 2));
  writeFileSync(join(outDir, 'bericht.json'), JSON.stringify(report, null, 2));
  console.log(`\n${items.length} Produkt(e) → ${join(outDir, 'produktliste.json')}`);
  if (planFile) console.log('In der App: Import › „IKEA-Planung (JSON) importieren“ → Planungs-JSON UND produktliste.json gemeinsam auswählen.');
} finally {
  await vite.close();
}
