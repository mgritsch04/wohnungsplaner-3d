/*
 * Einkaufsliste des Laden-Modus (#361): die Möbel und Geräte des Projekts mit Maßen, nach Raum
 * gruppiert, und die Haken. Die Haken sind eine Geräte-Einstellung (localStorage, je Projekt) –
 * sie funktionieren offline und werden nicht in die Projektdatei geschrieben.
 */
import { computeBudget } from '../budget/budget';
import { buildingFurniture } from '../budget/rooms';
import { buildingDevices } from '../budget/purchasePlan';
import { KIND_LABEL } from '../smarthome/catalog';
import type { Project } from '../model/schema';

export interface ShopItem {
  id: string;
  name: string;
  quantity: number;
  /** "B × T × H" in cm; empty for devices. */
  size: string;
  retailer: string;
}

export interface ShopGroup {
  label: string;
  items: ShopItem[];
}

export const DEVICE_GROUP = 'Smart Home';

/** What is to be bought, grouped by room (fitted objects that came with the flat are left out); devices form their own group. */
export function shoppingGroups(project: Project): ShopGroup[] {
  const { furniture, roomOf } = buildingFurniture(project);
  const budget = computeBudget(furniture, roomOf);
  const groups = new Map<string, ShopItem[]>();
  for (const room of budget.byRoom) groups.set(room.label, []);
  for (const l of budget.lines) {
    groups.get(l.room)?.push({ id: l.id, name: l.name, quantity: l.quantity, size: l.size, retailer: l.retailer === 'Ohne Händler' ? '' : l.retailer });
  }
  const out: ShopGroup[] = [...groups].filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items }));
  const devices = buildingDevices(project).map((d): ShopItem => ({ id: d.id, name: d.name || KIND_LABEL[d.kind], quantity: 1, size: '', retailer: '' }));
  if (devices.length) out.push({ label: DEVICE_GROUP, items: devices });
  return out;
}

const KEY_PREFIX = 'wohnungsplaner-shop-checked:';

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadChecked(projectId: string, storage: Storage | null = defaultStorage()): Set<string> {
  try {
    const raw = storage?.getItem(KEY_PREFIX + projectId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveChecked(projectId: string, checked: ReadonlySet<string>, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (checked.size === 0) storage.removeItem(KEY_PREFIX + projectId);
    else storage.setItem(KEY_PREFIX + projectId, JSON.stringify([...checked]));
  } catch {
    /* blocked storage: the ticks then only last until reload */
  }
}

/** "3 von 7 erledigt" counts items that still exist; ticks of deleted items are ignored. */
export function progress(groups: ShopGroup[], checked: ReadonlySet<string>): { done: number; total: number } {
  const items = groups.flatMap((g) => g.items);
  return { done: items.filter((i) => checked.has(i.id)).length, total: items.length };
}
