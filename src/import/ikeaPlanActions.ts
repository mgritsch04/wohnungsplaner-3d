import { IkeaPlanError, parseIkeaPlannerJson, placeIkeaPlan, type IkeaPlan } from '../catalog/providers/ikeaPlanner';
import { FileFormatError } from '../formats/zodErrors';
import { newId } from '../model/ids';
import { addFurniture, addPolygonRoom } from '../model/operations';
import type { Project } from '../model/schema';
import { boundsOf } from '../model/vec';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { pickFile } from '../ui/fileUtils';
import { reportError } from '../ui/actions';

/**
 * Add an IKEA planner design (room + frames) to the project, right of the existing
 * plan. Frames are dimensionally exact boxes ("Näherung" in 3D); names, prices and
 * models can be completed via the product list helper (article numbers are kept).
 */
export function applyIkeaPlan(d: Project, plan: IkeaPlan): { roomId: string | null; furniture: number } {
  const b = boundsOf([...d.nodes, ...d.furniture.flatMap((f) => furnitureCorners(f))]);
  const origin = b ? { x: Math.ceil(b.maxX + 1.5), y: Math.floor(b.minY) } : { x: 0, y: 0 };
  const placed = placeIkeaPlan(plan, origin, d.settings.defaultWallThickness);
  const roomId = placed.centerline
    ? addPolygonRoom(d, placed.centerline, `IKEA-Planung${plan.code ? ` ${plan.code}` : ''}`, { thickness: d.settings.defaultWallThickness, height: placed.height })
    : null;
  for (const f of placed.furniture) {
    addFurniture(d, {
      id: newId('item'),
      name: f.name.slice(0, 200),
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
      productUrl: f.productUrl,
      approximate: true,
      solid: true,
      locked: false,
    });
  }
  return { roomId, furniture: placed.furniture.length };
}

export async function importIkeaPlannerFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new FileFormatError('Die Datei ist zu groß (max. 20 MB).');
    const plan = parseIkeaPlannerJson(await file.text());
    let res = { roomId: null as string | null, furniture: 0 };
    useProjectStore.getState().apply((d) => void (res = applyIkeaPlan(d, plan)));
    if (res.roomId) useUiStore.getState().setSelection({ type: 'room', id: res.roomId });
    useUiStore.getState().requestFit();
    useUiStore
      .getState()
      .toast(
        `IKEA-Planung übernommen: ${res.roomId ? 'Raum + ' : ''}${res.furniture} Korpus(se)${plan.warnings.length ? ` · ${plan.warnings.join(' ')}` : ''}`,
        plan.warnings.length ? 'info' : 'success',
      );
  } catch (e) {
    reportError(e instanceof IkeaPlanError ? new FileFormatError(e.message) : e, 'IKEA-Planung konnte nicht übernommen werden');
  }
}
