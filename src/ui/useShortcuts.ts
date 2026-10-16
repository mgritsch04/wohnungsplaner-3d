import { useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore, type Tool } from '../store/uiStore';
import { deleteSelection, duplicateSelection, nudgeSelection, rotateSelection, saveNow, toggleOpening } from './actions';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', w: 'wall', r: 'room', t: 'door', f: 'window', g: 'passage', m: 'measure' };

/** Global keyboard shortcuts (ignored while typing in form fields). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const ui = useUiStore.getState();
      const ps = useProjectStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // walking keys (G = carry furniture, #39; O = open the door/window in sight, #21) belong to the walkthrough
      if (ui.cameraMode === 'walk' && ui.viewMode !== '2d' && ['w', 'a', 's', 'd', 'g', 'o'].includes(key) && !mod) return;
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        ps.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        ps.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && key === 's') {
        e.preventDefault();
        void saveNow();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ui.selection) {
          e.preventDefault();
          void deleteSelection();
        }
      } else if (e.key === 'Escape') {
        if (ui.tool !== 'select') ui.setTool('select');
        else ui.setSelection(null);
      } else if (!mod && key === 'q') {
        rotateSelection(-Math.PI / 12);
      } else if (!mod && key === 'e') {
        rotateSelection(Math.PI / 12);
      } else if (e.key.startsWith('Arrow') && ui.selection?.type === 'furniture') {
        e.preventDefault();
        const s = e.shiftKey ? 0.1 : 0.01;
        nudgeSelection(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
      } else if (!mod && key === '1' && ui.tool !== 'wall') {
        ui.setViewMode('2d');
      } else if (!mod && key === '2' && ui.tool !== 'wall') {
        ui.setViewMode('split');
      } else if (!mod && key === '3' && ui.tool !== 'wall') {
        ui.setViewMode('3d');
      } else if (!mod && key === 'h') {
        ui.requestFit();
      } else if (!mod && !e.altKey && key === 'o' && ui.selection?.type === 'opening') {
        // open/close the selected door or window (#21)
        toggleOpening(ui.selection.id);
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        ui.setTool(TOOL_KEYS[key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
