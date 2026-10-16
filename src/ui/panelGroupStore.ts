import { create } from 'zustand';

/**
 * Open/closed state of the collapsible groups in the properties panel (#99).
 *
 * Only the user's choices are stored (`group key → open`); a group without an entry
 * shows its default. Keys name the kind of group (e.g. `furniture.product`), not the
 * object, so the state survives selecting another object. Additionally remembered in
 * localStorage (device setting, not part of the project); storage errors are ignored.
 */
export const PANEL_GROUPS_STORAGE_KEY = 'wohnungsplaner-panel-groups';

/** Stored choices; invalid or unreadable storage yields no choices. */
export function readStoredPanelGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(PANEL_GROUPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeStored(open: Record<string, boolean>) {
  try {
    localStorage.setItem(PANEL_GROUPS_STORAGE_KEY, JSON.stringify(open));
  } catch {
    // private mode / blocked storage: keep the state for this session only
  }
}

interface PanelGroupStore {
  open: Record<string, boolean>;
  setOpen: (key: string, open: boolean) => void;
  /** Forget all choices (back to the defaults). */
  reset: () => void;
}

export const usePanelGroupStore = create<PanelGroupStore>((set, get) => ({
  open: readStoredPanelGroups(),
  setOpen: (key, value) => {
    const open = { ...get().open, [key]: value };
    set({ open });
    writeStored(open);
  },
  reset: () => {
    set({ open: {} });
    writeStored({});
  },
}));

/** Whether the group `key` is open (the user's last choice, otherwise `defaultOpen`). */
export function usePanelGroupOpen(key: string, defaultOpen: boolean): boolean {
  return usePanelGroupStore((s) => s.open[key] ?? defaultOpen);
}
