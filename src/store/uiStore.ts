import { create } from 'zustand';
import type { Vec2 } from '../model/vec';

export type SelectionType = 'wall' | 'node' | 'room' | 'opening' | 'furniture' | 'light';
export interface Selection {
  type: SelectionType;
  id: string;
}

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'passage' | 'measure' | 'calibrate';
export type ViewMode = '2d' | '3d' | 'split';
export type CameraMode = 'orbit' | 'walk';
export type LeftTab = 'tools' | 'catalog' | 'kitchen' | 'import';
export type RightTab = 'properties' | 'budget' | 'project';

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
  toasts: Toast[];
  setSelection: (s: Selection | null) => void;
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
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;

export const useUiStore = create<UiStore>((set, get) => ({
  selection: null,
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
  toasts: [],
  setSelection: (selection) => set({ selection, rightTab: selection ? 'properties' : get().rightTab }),
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
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
