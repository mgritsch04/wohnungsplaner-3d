import { FileFormatError } from '../formats/zodErrors';
import { useUiStore } from '../store/uiStore';
import { reportError } from '../ui/actions';
import { pickFiles } from '../ui/fileUtils';
import { db } from '../persistence/db';
import { newId } from '../model/ids';
import { checkModelBlob, compareDimensions } from './providers/modelFetch';
import { parseCatalogCsv, parseCatalogJsonWithModels } from './catalogFormat';
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

/**
 * Import a product list (JSON/CSV). Several files may be chosen at once: one list
 * plus the .glb files its entries reference via `modelFile`.
 */
export async function importCatalogFile() {
  const files = await pickFiles('.json,.csv,.glb,application/json,text/csv,model/gltf-binary');
  if (!files.length) return;
  try {
    const lists = files.filter((f) => /\.(json|csv)$/i.test(f.name));
    if (lists.length !== 1) throw new FileFormatError(lists.length ? 'Bitte genau eine Produktliste (JSON oder CSV) auswählen.' : 'Keine Produktliste (JSON oder CSV) ausgewählt.');
    const file = lists[0];
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
    const glbs = files.filter((f) => /\.glb$/i.test(f.name));
    const res = await attachModelFiles(items, modelFiles, glbs, async (blob) => {
      const id = newId('asset');
      await db.putAsset(id, blob);
      return id;
    });
    const count = await useCatalogStore.getState().addItems(res.items);
    const notes = [...errors.map((e) => `Zeile übersprungen: ${e}`), ...res.warnings];
    useUiStore
      .getState()
      .toast(
        `${count} Produkt(e) importiert${res.attached ? `, ${res.attached} mit 3D-Modell` : ''}${notes.length ? `. Hinweise (${notes.length}): ${notes.slice(0, 2).join(' ')}` : '.'}`,
        notes.length ? 'info' : 'success',
      );
  } catch (e) {
    reportError(e, 'Produktliste konnte nicht importiert werden');
  }
}
