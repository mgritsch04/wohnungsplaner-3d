import { FileFormatError } from '../formats/zodErrors';
import { useUiStore } from '../store/uiStore';
import { reportError } from '../ui/actions';
import { pickFiles, pickFolder } from '../ui/fileUtils';
import { db } from '../persistence/db';
import { newId } from '../model/ids';
import { checkModelBlob, compareDimensions } from './providers/modelFetch';
import { CATALOG_FORMAT, parseCatalogCsv, parseCatalogJsonWithModels } from './catalogFormat';
import { useCatalogStore } from './catalogStore';
import type { CatalogItem } from './types';

/** Largest relative deviation between model and product dimensions that is still accepted silently. */
const DIM_TOLERANCE = 0.1;

export interface AttachResult {
  items: CatalogItem[];
  attached: number;
  warnings: string[];
}

/**
 * Attach .glb files chosen together with a product list to the entries that name
 * them (`modelFile`). Each file is validated (glTF header, loadable, bounding box)
 * and compared with the listed dimensions; the listed dimensions stay authoritative
 * (the renderer scales the model to them). Missing or invalid files keep the
 * dimensionally correct procedural substitute.
 */
export async function attachModelFiles(
  items: CatalogItem[],
  modelFiles: Map<string, string>,
  files: File[],
  store: (blob: Blob) => Promise<string>,
  check: typeof checkModelBlob = checkModelBlob,
): Promise<AttachResult> {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const warnings: string[] = [];
  let attached = 0;
  const out: CatalogItem[] = [];
  for (const item of items) {
    const wanted = modelFiles.get(item.id);
    if (!wanted) {
      out.push(item);
      continue;
    }
    const file = byName.get(wanted.toLowerCase());
    if (!file) {
      warnings.push(`„${item.name}“: Modelldatei ${wanted} wurde nicht mit ausgewählt – Näherungsmodell verwendet.`);
      out.push(item);
      continue;
    }
    try {
      const { info } = await check(file);
      const cmp = compareDimensions(info.size, { width: item.width * 100, depth: item.depth * 100, height: item.height * 100 });
      if (cmp.rotated) warnings.push(`„${item.name}“: Modell scheint um 90° gedreht zu sein (Breite/Tiefe vertauscht) – bitte in 3D prüfen.`);
      else if (cmp.maxDeviation > DIM_TOLERANCE)
        warnings.push(`„${item.name}“: Modellmaße weichen um ${Math.round(cmp.maxDeviation * 100)} % von den Produktmaßen ab – es wird auf die Produktmaße skaliert.`);
      const shape = item.model.type === 'procedural' ? item.model.shape : item.model.fallbackShape;
      const assetId = await store(file);
      out.push({ ...item, model: { type: 'gltf', assetId, fallbackShape: shape }, approximate: false, tags: [...item.tags, 'glb'] });
      attached++;
    } catch (e) {
      warnings.push(`„${item.name}“: ${wanted} ist kein gültiges Modell (${e instanceof Error ? e.message : String(e)}).`);
      out.push(item);
    }
  }
  return { items: out, attached, warnings };
}

export interface ImportFileSet {
  /** The product list (JSON in the catalog format, or CSV), if one was chosen. */
  list?: File;
  glbs: File[];
  /** Other files that were chosen along (e.g. bericht.json from the IKEA script) and are skipped. */
  ignored: string[];
}

/**
 * Sort the files chosen for a product list import. Users often pick a whole
 * folder (e.g. `ikea-import` with produktliste.json, bericht.json and .glb
 * files), so JSON files that are not product lists are skipped instead of
 * failing the import.
 */
export async function classifyImportFiles(files: File[]): Promise<ImportFileSet> {
  const lists: File[] = [];
  const glbs: File[] = [];
  const ignored: string[] = [];
  for (const f of files) {
    if (/\.glb$/i.test(f.name)) glbs.push(f);
    else if (/\.csv$/i.test(f.name)) lists.push(f);
    else if (/\.json$/i.test(f.name) && f.size <= 10 * 1024 * 1024 && (await looksLikeCatalog(f))) lists.push(f);
    else ignored.push(f.name);
  }
  if (lists.length > 1) throw new FileFormatError(`Bitte nur eine Produktliste auswählen (gefunden: ${lists.map((f) => f.name).join(', ')}).`);
  return { list: lists[0], glbs, ignored };
}

async function looksLikeCatalog(file: File): Promise<boolean> {
  try {
    const raw = JSON.parse(await file.text()) as { format?: unknown };
    return raw?.format === CATALOG_FORMAT;
  } catch {
    return false;
  }
}

const storeAsset = async (blob: Blob) => {
  const id = newId('asset');
  await db.putAsset(id, blob);
  return id;
};

/**
 * Import a product list (JSON/CSV). Several files may be chosen at once – one list
 * plus the .glb files its entries reference via `modelFile`, or simply the whole
 * folder. .glb files chosen without a list are attached to already imported
 * products that reference them.
 */
export async function importCatalogFile(opts: { folder?: boolean } = {}) {
  const files = opts.folder ? await pickFolder() : await pickFiles('.json,.csv,.glb,application/json,text/csv,model/gltf-binary');
  if (!files.length) return;
  try {
    const { list: file, glbs, ignored } = await classifyImportFiles(files);
    if (!file) {
      if (!glbs.length) throw new FileFormatError('Keine Produktliste (JSON im Format „wohnungsplaner-catalog“ oder CSV) ausgewählt.');
      await attachToImported(glbs);
      return;
    }
    if (file.size > 10 * 1024 * 1024) throw new FileFormatError('Die Produktliste ist zu groß (max. 10 MB).');
    const text = await file.text();
    let errors: string[] = [];
    let items: CatalogItem[];
    let modelFiles = new Map<string, string>();
    if (file.name.toLowerCase().endsWith('.csv')) {
      const res = parseCatalogCsv(text, file.name);
      errors = res.errors;
      items = res.items;
    } else {
      ({ items, modelFiles } = parseCatalogJsonWithModels(text, file.name));
    }
    const res = await attachModelFiles(items, modelFiles, glbs, storeAsset);
    const count = await useCatalogStore.getState().addItems(res.items);
    const missing = modelFiles.size - res.attached;
    // without any .glb chosen, one hint replaces the per-product "model file missing" warnings
    const notes = [...errors.map((e) => `Zeile übersprungen: ${e}`), ...(glbs.length ? res.warnings : [])];
    const hint =
      missing > 0 && !glbs.length
        ? ` ${missing} Produkt(e) haben eine 3D-Modelldatei: am einfachsten „Ordner importieren“ wählen oder die .glb-Dateien jetzt nachträglich über denselben Knopf auswählen.`
        : '';
    useUiStore
      .getState()
      .toast(
        `${count} Produkt(e) importiert${res.attached ? `, ${res.attached} mit 3D-Modell` : ''}${ignored.length ? ` (übersprungen: ${ignored.join(', ')})` : ''}.${hint}${notes.length ? ` Hinweise (${notes.length}): ${notes.slice(0, 2).join(' ')}` : ''}`,
        notes.length || hint ? 'info' : 'success',
      );
  } catch (e) {
    reportError(e, 'Produktliste konnte nicht importiert werden');
  }
}

/** Attach .glb files chosen on their own to imported products whose list named them. */
async function attachToImported(glbs: File[]) {
  const catalog = useCatalogStore.getState().items;
  const targets = catalog.filter((i) => i.modelFile && i.model.type === 'procedural');
  const names = new Set(glbs.map((f) => f.name.toLowerCase()));
  const matching = targets.filter((i) => names.has(i.modelFile!.toLowerCase()));
  if (!matching.length)
    throw new FileFormatError('Kein importiertes Produkt ohne 3D-Modell verweist auf diese .glb-Datei(en). Bitte zuerst die Produktliste importieren (oder den ganzen Ordner).');
  const res = await attachModelFiles(matching, new Map(matching.map((i) => [i.id, i.modelFile!])), glbs, storeAsset);
  await useCatalogStore.getState().addItems(res.items);
  useUiStore
    .getState()
    .toast(
      `${res.attached} von ${matching.length} Produkt(en) mit 3D-Modell ergänzt.${res.warnings.length ? ` Hinweise: ${res.warnings.slice(0, 2).join(' ')}` : ''}`,
      res.warnings.length || res.attached < matching.length ? 'info' : 'success',
    );
}
