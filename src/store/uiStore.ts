import { create } from 'zustand';
import type { Vec2 } from '../model/vec';

export type SelectionType = 'wall' | 'node' | 'room' | 'opening' | 'furniture' | 'light' | 'device' | 'fixture';
export interface Selection {
  type: SelectionType;
  id: string;
}

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'passage' | 'measure' | 'walkpath' | 'calibrate';
export type ViewMode = '2d' | '3d' | 'split';
export type CameraMode = 'orbit' | 'walk';
export type LeftTab = 'tools' | 'catalog' | 'kitchen' | 'furnish' | 'smarthome' | 'check' | 'import';
export type RightTab = 'properties' | 'budget' | 'project';
export type OtherLevels = 'below' | 'all' | 'none';

export interface View2D {
  /** World point shown in the center of the canvas. */
  cx: number;
  cy: number;
  /** Pixels per meter. */
  zoom: number;
}

export interface Measurement {
  id: string;
  a: Vec2;
  b: Vec2;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface UiStore {
  selection: Selection | null;
  /** Further selected furniture besides `selection` (multi-select, Shift+click / box). */
  multi: string[];
  hover: Selection | null;
  tool: Tool;
  viewMode: ViewMode;
  cameraMode: CameraMode;
  leftTab: LeftTab;
  rightTab: RightTab;
  view2d: View2D;
  /** Increment to ask the 2D editor to zoom to fit. */
  fitRequest: number;
  measurements: Measurement[];
  cursor: Vec2 | null;
  fps: number | null;
  /**
   * Time of day shown while the slider is being dragged (not yet in the project).
   * Kept outside the project so dragging does not clone/re-render the whole app.
   */
  timePreview: number | null;
  /** Furniture currently carried in the first-person walkthrough (#39). */
  walkCarry: string | null;
  /** Crouching in the walkthrough (#20); C toggles it (#47). */
  walkDuck: boolean;
  /** Seated in the walkthrough (#78) – eyes at the seated eye height of settings.bodyHeight. */
  walkSit: boolean;
  /** Cabinets shown open (#85): their inner layout is drawn in 3D and 2D. */
  interiorOpen: string[];
  toggleInteriorOpen: (id: string) => void;
  /** Where the reference figure stands (#263); null = default spot. Placed with P while walking. */
  refFigurePos: Vec2 | null;
  /** Other storeys shown in 3D (#54): the ones below the active storey, all, or none. */
  otherLevels: OtherLevels;
  setOtherLevels: (v: OtherLevels) => void;
  toasts: Toast[];
  setSelection: (s: Selection | null) => void;
  /** Shift+click: add/remove a furniture item to/from the selection. */
  toggleFurnitureSelection: (id: string) => void;
  /** Select exactly these furniture items (first = primary). */
  selectFurniture: (ids: string[]) => void;
  setHover: (s: Selection | null) => void;
  setTool: (t: Tool) => void;
  setViewMode: (v: ViewMode) => void;
  setCameraMode: (m: CameraMode) => void;
  setLeftTab: (t: LeftTab) => void;
  setRightTab: (t: RightTab) => void;
  setView2d: (v: View2D) => void;
  requestFit: () => void;
  addMeasurement: (m: Measurement) => void;
  clearMeasurements: () => void;
  setCursor: (p: Vec2 | null) => void;
  setFps: (fps: number | null) => void;
  setTimePreview: (hour: number | null) => void;
  setWalkCarry: (id: string | null) => void;
  setWalkDuck: (duck: boolean) => void;
  /** C in the walkthrough (#47): crouch / stand up again; ignored while seated. */
  toggleWalkDuck: () => void;
  setWalkSit: (sit: boolean) => void;
  setRefFigurePos: (p: Vec2 | null) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;

export const useUiStore = create<UiStore>((set, get) => ({
  selection: null,
  multi: [],
  hover: null,
  tool: 'select',
  viewMode: 'split',
  cameraMode: 'orbit',
  leftTab: 'tools',
  rightTab: 'properties',
  view2d: { cx: 4, cy: 2, zoom: 60 },
  fitRequest: 1,
  measurements: [],
  cursor: null,
  fps: null,
  timePreview: null,
  walkCarry: null,
  walkDuck: false,
  walkSit: false,
  refFigurePos: null,
  interiorOpen: [],
  toggleInteriorOpen: (id) => set((s) => ({ interiorOpen: s.interiorOpen.includes(id) ? s.interiorOpen.filter((x) => x !== id) : [...s.interiorOpen, id] })),
  otherLevels: 'below',
  setOtherLevels: (otherLevels) => set({ otherLevels }),
  toasts: [],
  setSelection: (selection) => set({ selection, multi: [], rightTab: selection ? 'properties' : get().rightTab }),
  toggleFurnitureSelection: (id) => {
    const { selection, multi } = get();
    if (selection?.type !== 'furniture') return set({ selection: { type: 'furniture', id }, multi: [], rightTab: 'properties' });
    if (selection.id === id) {
      // removing the primary item: the next one becomes primary
      const [next, ...rest] = multi;
      return set({ selection: next ? { type: 'furniture', id: next } : null, multi: rest });
    }
    set({ multi: multi.includes(id) ? multi.filter((x) => x !== id) : [...multi, id] });
  },
  selectFurniture: (ids) => {
    const [first, ...rest] = ids;
    set({ selection: first ? { type: 'furniture', id: first } : null, multi: rest, rightTab: first ? 'properties' : get().rightTab });
  },
  setHover: (hover) => {
    const h = get().hover;
    if (h?.id === hover?.id && h?.type === hover?.type) return;
    set({ hover });
  },
  setTool: (tool) => set({ tool }),
  setViewMode: (viewMode) => set({ viewMode, fitRequest: get().fitRequest + 1 }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  setView2d: (view2d) => set({ view2d }),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
  addMeasurement: (m) => set({ measurements: [...get().measurements, m] }),
  clearMeasurements: () => set({ measurements: [] }),
  setCursor: (cursor) => set({ cursor }),
  setFps: (fps) => set({ fps }),
  setTimePreview: (timePreview) => set({ timePreview }),
  setWalkCarry: (walkCarry) => set({ walkCarry }),
  setWalkDuck: (walkDuck) => set({ walkDuck }),
  toggleWalkDuck: () => set((s) => (s.walkSit ? {} : { walkDuck: !s.walkDuck })),
  // sitting down or standing up (X, buttons, project panel) always ends crouching (#47)
  setWalkSit: (walkSit) => set({ walkSit, walkDuck: false }),
  setRefFigurePos: (refFigurePos) => set({ refFigurePos }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** All selected furniture ids (primary first). */
export function selectedFurnitureIds(s: Pick<UiStore, 'selection' | 'multi'>): string[] {
  return s.selection?.type === 'furniture' ? [s.selection.id, ...s.multi] : [];
}

