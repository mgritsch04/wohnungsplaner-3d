import { create } from 'zustand';
import { CATEGORIES } from '../catalog/types';
import type { DerivedPlan } from '../model/derived';
import { hasLeaf } from '../model/operations';
import type { Project } from '../model/schema';
import { formatEuro } from '../model/units';
import { KIND_LABEL } from '../smarthome/catalog';
import { fixtureLabel } from '../model/fixtures';
import { useUiStore, type Selection } from '../store/uiStore';

/**
 * Shared object context menu (#235): one small panel for the chosen object, the same in the
 * 2D plan, the 3D overview and the walkthrough (there at the crosshair); on the phone it opens
 * as a sheet. Opened by right-click, the context-menu key / Shift+F10, F while walking, or the
 * „…“ button of the phone selection bar.
 */

export type ObjectMenuPlace = '2d' | '3d' | 'walk' | 'sheet';

export interface ObjectMenuState {
  target: Selection;
  /** Screen position (client px) the menu is anchored to; ignored for the sheet. */
  x: number;
  y: number;
  place: ObjectMenuPlace;
}

interface ObjectMenuStore {
  menu: ObjectMenuState | null;
  /** Opens the „Details“ sheet on the phone; set by the phone layout. */
  onDetails: (() => void) | null;
  close: () => void;
}

export const useObjectMenuStore = create<ObjectMenuStore>(() => ({ menu: null, onDetails: null, close: () => useObjectMenuStore.setState({ menu: null }) }));

/** Selects `target` (keeps a multi-selection that contains it) and opens the menu for it. */
export function openObjectMenu(target: Selection, x: number, y: number, place: ObjectMenuPlace) {
  const ui = useUiStore.getState();
  const kept = ui.selection?.type === target.type && (ui.selection.id === target.id || (target.type === 'furniture' && ui.multi.includes(target.id)));
  if (!kept) ui.setSelection(target);
  useObjectMenuStore.setState({ menu: { target: kept && ui.selection ? ui.selection : target, x, y, place } });
}

export function closeObjectMenu() {
  if (useObjectMenuStore.getState().menu) useObjectMenuStore.setState({ menu: null });
}

/** Center of the visible 2D or 3D pane (client px) – the crosshair while walking. */
export function paneCenter(pane: '2d' | '3d'): { x: number; y: number } {
  const el = document.querySelector(pane === '3d' ? '.pane-3d' : '.pane-2d') ?? document.querySelector('.workspace');
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Context-menu key / Shift+F10: the menu of the current selection, centred on the visible pane. */
export function openMenuForSelection(): boolean {
  const ui = useUiStore.getState();
  if (!ui.selection) return false;
  const pane = ui.viewMode === '3d' ? '3d' : '2d';
  const c = paneCenter(pane);
  openObjectMenu(ui.selection, c.x, c.y, pane);
  return true;
}

export type ObjectActionId =
  | 'rotate-left'
  | 'rotate-right'
  | 'duplicate'
  | 'carry'
  | 'drop'
  | 'toggle-open'
  | 'toggle-light'
  | 'toggle-device'
  | 'trigger-device'
  | 'delete'
  | 'properties';

export interface ObjectAction {
  id: ObjectActionId;
  label: string;
  /** Tooltip, e.g. the matching keyboard shortcut. */
  hint?: string;
  danger?: boolean;
}

export interface ObjectMenuModel {
  title: string;
  /** Short facts shown under the title – only data the object actually has. */
  details: string[];
  actions: ObjectAction[];
}

export interface ObjectMenuContext {
  walking: boolean;
  /** Furniture currently carried in the walkthrough. */
  carrying: string | null;
  /** Number of selected furniture items (multi-selection). */
  count: number;
  /** Device status line (from the simulation), computed by the caller. */
  deviceStatus?: { label: string; on: boolean };
}

const cm = (m: number) => String(Math.round(m * 1000) / 10).replace('.', ',');
const m2 = (a: number) => (Math.round(a * 10) / 10).toFixed(1).replace('.', ',');
const OPENING_LABEL = { door: 'Tür', window: 'Fenster', passage: 'Durchgang' } as const;

const properties: ObjectAction = { id: 'properties', label: 'Eigenschaften', hint: 'Alle Einstellungen im Panel rechts' };
const del: ObjectAction = { id: 'delete', label: 'Löschen', hint: 'Entf', danger: true };

/** What the context menu shows for `target`; null if the object no longer exists. */
export function objectMenuModel(p: Project, d: DerivedPlan, target: Selection, ctx: ObjectMenuContext): ObjectMenuModel | null {
  switch (target.type) {
    case 'furniture': {
      const f = p.furniture.find((x) => x.id === target.id);
      if (!f) return null;
      const details: string[] = [];
      const category = CATEGORIES.find((c) => c.id === f.category)?.label;
      if (category) details.push(category);
      details.push(`${cm(f.width)} × ${cm(f.depth)} × ${cm(f.height)} cm (B × T × H)`);
      if (f.price) details.push(`${formatEuro(f.price.amount * (f.quantity ?? 1))}${f.quantity > 1 ? ` (${f.quantity} Stk.)` : ''}${f.price.status === 'estimate' ? ' · Schätzung' : ''}`);
      const seller = [f.brand, f.retailer].filter(Boolean).join(' · ');
      if (seller) details.push(seller);
      if (f.locked) details.push('Gesperrt – erst in den Eigenschaften entsperren');
      const actions: ObjectAction[] = [];
      if (ctx.carrying === f.id) actions.push({ id: 'drop', label: 'Absetzen', hint: 'G oder Klick' });
      else {
        if (!f.locked && !ctx.walking) {
          actions.push({ id: 'rotate-left', label: '↺ 90°', hint: 'Nach links drehen (Q: 15°)' });
          actions.push({ id: 'rotate-right', label: '↻ 90°', hint: 'Nach rechts drehen (E: 15°)' });
        }
        actions.push({ id: 'duplicate', label: 'Duplizieren', hint: 'Strg+D' });
        if (ctx.walking && !f.locked && ctx.count <= 1) actions.push({ id: 'carry', label: 'Tragen', hint: 'G – mit dem Blick verschieben' });
        actions.push(del);
      }
      actions.push(properties);
      return { title: ctx.count > 1 ? `${f.name} (+${ctx.count - 1} weitere)` : f.name, details, actions };
    }
    case 'opening': {
      const o = p.openings.find((x) => x.id === target.id);
      if (!o) return null;
      const details = [`${cm(o.width)} × ${cm(o.height)} cm (B × H)`];
      if (hasLeaf(o)) details.push(o.open ? 'offen' : 'geschlossen');
      const actions: ObjectAction[] = [];
      if (hasLeaf(o)) actions.push({ id: 'toggle-open', label: o.open ? 'Schließen' : 'Öffnen', hint: ctx.walking ? 'E oder O' : 'O oder Doppelklick in 3D' });
      actions.push(del, properties);
      return { title: OPENING_LABEL[o.kind], details, actions };
    }
    case 'device': {
      const dev = p.devices.find((x) => x.id === target.id);
      if (!dev) return null;
      const details = [KIND_LABEL[dev.kind]];
      if (ctx.deviceStatus) details.push(`Status: ${ctx.deviceStatus.label}`);
      const actions: ObjectAction[] = [];
      if (dev.kind === 'light' || dev.kind === 'plug') actions.push({ id: 'toggle-device', label: ctx.deviceStatus?.on ? 'Ausschalten' : 'Einschalten' });
      if (dev.kind === 'motion' || dev.kind === 'presence') actions.push({ id: 'trigger-device', label: 'Auslösen (testen)', hint: 'Meldet sofort „Bewegung“' });
      if (dev.kind === 'contact' && dev.openingId) actions.push({ id: 'toggle-device', label: ctx.deviceStatus?.on ? 'Schließen' : 'Öffnen' });
      actions.push(del, properties);
      return { title: dev.name, details, actions };
    }
    case 'light': {
      const l = p.lights.find((x) => x.id === target.id);
      if (!l) return null;
      return {
        title: l.name,
        details: [`${l.temperature} K`, l.on ? 'eingeschaltet' : 'ausgeschaltet'],
        actions: [{ id: 'toggle-light', label: l.on ? 'Ausschalten' : 'Einschalten' }, del, properties],
      };
    }
    case 'wall': {
      const fp = d.footprints.get(target.id);
      if (!fp) return null;
      return { title: 'Wand', details: [`${cm(fp.length)} cm lang · ${cm(fp.thickness)} cm dick`], actions: [del, properties] };
    }
    case 'room': {
      const r = p.rooms.find((x) => x.id === target.id);
      if (!r) return null;
      const geom = [...d.rooms.values()].find((g) => g.roomId === r.id);
      return { title: r.name || 'Raum', details: geom ? [`${m2(geom.area)} m²`] : [], actions: [del, properties] };
    }
    case 'node': {
      if (!p.nodes.some((n) => n.id === target.id)) return null;
      return { title: 'Ecke', details: [`${p.walls.filter((w) => w.a === target.id || w.b === target.id).length} Wände angeschlossen`], actions: [del, properties] };
    }
    case 'fixture': {
      const f = p.fixtures.find((x) => x.id === target.id);
      if (!f) return null;
      const details = [`Höhe ${cm(f.elevation)} cm`];
      if (f.note) details.push(f.note);
      return { title: fixtureLabel(f), details, actions: [del, properties] };
    }
  }
}
