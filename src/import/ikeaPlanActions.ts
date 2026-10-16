import { CATALOG_FORMAT, parseCatalogEntries, type CatalogEntry } from '../catalog/catalogFormat';
import { IkeaPlanError, parseIkeaPlannerJson, placeIkeaPlan, type IkeaPlan } from '../catalog/providers/ikeaPlanner';
import { enrichPlacement } from '../catalog/providers/ikeaPlanProducts';
import { FileFormatError } from '../formats/zodErrors';
import { newId } from '../model/ids';
import { addFurniture, addPolygonRoom } from '../model/operations';
import type { Project } from '../model/schema';
import { boundsOf } from '../model/vec';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { pickFiles } from '../ui/fileUtils';
import { reportError } from '../ui/actions';

/**
 * Add an IKEA planner design (room + frames) to the project, right of the existing
 * plan. Frames are dimensionally exact boxes ("Näherung" in 3D); names, prices and
 * models can be completed via the product list helper (article numbers are kept).
 */
export function applyIkeaPlan(
  d: Project,
  plan: IkeaPlan,
  products: CatalogEntry[] = [],
): { roomId: string | null; furniture: number; named: number; priced: number; notes: string[] } {
  const b = boundsOf([...d.nodes, ...d.furniture.flatMap((f) => furnitureCorners(f))]);
  const origin = b ? { x: Math.ceil(b.maxX + 1.5), y: Math.floor(b.minY) } : { x: 0, y: 0 };
  const placed = placeIkeaPlan(plan, origin, d.settings.defaultWallThickness);
  const roomId = placed.centerline
    ? addPolygonRoom(d, placed.centerline, `IKEA-Planung${plan.code ? ` ${plan.code}` : ''}`, { thickness: d.settings.defaultWallThickness, height: placed.height })
    : null;
  const enriched = products.length ? enrichPlacement(plan, products) : null;
  placed.furniture.forEach((f, i) => {
    const e = enriched?.furniture[i];
    addFurniture(d, {
      id: newId('item'),
      name: (e?.name ?? f.name).slice(0, 200),
      category: 'storage',
      x: f.x,
      y: f.y,
      elevation: f.elevation,
      rotation: f.rotation,
      width: f.width,
      depth: f.depth,
      height: f.height,
      color: '#f2f2f0',
      model: { type: 'procedural', shape: 'wardrobe' },
      quantity: 1,
      brand: 'IKEA',
      retailer: 'IKEA Österreich',
      productUrl: (e?.productUrl ?? f.productUrl).slice(0, 2000),
      imageUrl: e?.imageUrl?.slice(0, 2000),
      price: e?.price ? { amount: e.price.amount, currency: 'EUR', status: e.price.status, recordedAt: e.price.recordedAt } : undefined,
      approximate: true,
      solid: true,
      locked: false,
    });
  });
  return { roomId, furniture: placed.furniture.length, named: enriched?.named ?? 0, priced: enriched?.priced ?? 0, notes: enriched?.notes ?? [] };
}

/**
 * Trennt die gewählten Dateien in genau eine Planung und beliebig viele Produktlisten
 * (Format „wohnungsplaner-catalog“, z. B. von scripts/ikea-products.mjs --plan).
 */
export function splitPlanFiles(texts: { name: string; text: string }[]): { plan: { name: string; text: string }; lists: CatalogEntry[] } {
  const plans: { name: string; text: string }[] = [];
  const lists: CatalogEntry[] = [];
  for (const f of texts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.text);
    } catch {
      throw new FileFormatError(`„${f.name}“ ist kein gültiges JSON.`);
    }
    // a top-level array is never a plan – e.g. bericht.json written next to the product list (#12)
    if (Array.isArray(parsed)) continue;
    const format = (parsed as { format?: unknown } | null)?.format;
    if (format === CATALOG_FORMAT) lists.push(...parseCatalogEntries(f.text).entries);
    else plans.push(f);
  }
  if (plans.length !== 1) throw new FileFormatError(plans.length ? 'Bitte genau eine IKEA-Planung auswählen (und optional die Produktliste dazu).' : 'Keine IKEA-Planung gewählt (nur Produktlisten).');
  return { plan: plans[0], lists };
}

export async function importIkeaPlannerFile() {
  const files = await pickFiles('.json,application/json');
  if (!files.length) return;
  try {
    if (files.length > 5) throw new FileFormatError('Bitte höchstens eine Planung und wenige Produktlisten auswählen.');
    if (files.some((f) => f.size > 20 * 1024 * 1024)) throw new FileFormatError('Eine Datei ist zu groß (max. 20 MB).');
    const { plan: planFile, lists } = splitPlanFiles(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    const plan = parseIkeaPlannerJson(planFile.text);
    let res: ReturnType<typeof applyIkeaPlan> = { roomId: null, furniture: 0, named: 0, priced: 0, notes: [] };
    useProjectStore.getState().apply((d) => void (res = applyIkeaPlan(d, plan, lists)));
    if (res.roomId) useUiStore.getState().setSelection({ type: 'room', id: res.roomId });
    useUiStore.getState().requestFit();
    const info = [
      lists.length ? `${res.named}/${res.furniture} mit Produktnamen, ${res.priced} mit Preis` : 'ohne Produktliste: keine Namen/Preise (Anleitung: docs/IKEA_PLANUNG_JSON.md)',
      ...res.notes,
      ...plan.warnings,
    ];
    useUiStore
      .getState()
      .toast(
        `IKEA-Planung übernommen: ${res.roomId ? 'Raum + ' : ''}${res.furniture} Korpus(se) · ${info.join(' · ')}`,
        res.notes.length || plan.warnings.length ? 'info' : 'success',
      );
  } catch (e) {
    reportError(e instanceof IkeaPlanError ? new FileFormatError(e.message) : e, 'IKEA-Planung konnte nicht übernommen werden');
  }
}
