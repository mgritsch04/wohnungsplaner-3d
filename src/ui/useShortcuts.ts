import { useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useDialogStore } from './dialogStore';
import { TOOL_KEYS } from './shortcutCatalog';
import { BOOKMARK_KEYS, jumpToBookmarkIndex } from '../view3d/cameraBookmarks';
import { useTapeStore } from '../view3d/tapeStore';
import { notifyCompareLocked, showCompareSide, stopCompare, toggleCompareSide, useCompareStore } from '../versions/compareStore';
import { groupSelection, ungroupSelection } from './groupActions';
import { goToNeighbourLevel } from './levelActions';
import { orbitKeyMoves } from '../view3d/orbitKeys';
import { openMenuForSelection } from './objectMenu';
import { copySelection, deleteSelection, duplicateSelection, nudgeSelection, pasteClipboard, rotateSelection, saveNow, toggleOpening, toggleUnderlayVisible } from './actions';


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
      // walking keys (G = carry furniture #39, C = crouch #20, F/O = open the door/window in sight #21/#107/#257,
      // P = place the reference figure #263) belong to the walkthrough; Q/E still rotate the selection there (#257)
      if (ui.cameraMode === 'walk' && ui.viewMode !== '2d' && ['w', 'a', 's', 'd', 'g', 'c', 'o', 'f', 'p'].includes(key) && !mod) return;
      // W A S D / arrow keys move the 3D overview camera (#132) – handled in Scene3D, so W is not the wall tool there
      const furnitureSelected = ui.selection?.type === 'furniture';
      const comparing = useCompareStore.getState().session !== null;
      if (!mod && !e.altKey && orbitKeyMoves(e.code, { viewMode: ui.viewMode, cameraMode: ui.cameraMode, furnitureSelected, comparing })) return;
      // Alt+1 … Alt+9: camera bookmarks (#55). Matched by e.code, so it works with every layout
      // (Option+digit types other characters on macOS); only while the 3D view is visible.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && e.altKey && !mod && !e.shiftKey) {
        e.preventDefault();
        const n = Number(digit[1]);
        if (ui.viewMode !== '2d' && n <= BOOKMARK_KEYS && !jumpToBookmarkIndex(n - 1)) ui.toast(`Keine gespeicherte Ansicht ${n} (Menü „Ansichten“ in der 3D-Ansicht)`, 'info');
        return;
      }
      // before/after comparison (#76): read-only preview – only the comparison keys work
      if (useCompareStore.getState().session) {
        if (useDialogStore.getState().modal) return; // e.g. the keyboard overview is open
        if (e.key === ' ' && !mod && !e.altKey) {
          e.preventDefault();
          // a focused button would also "click" on key release – take the focus away first
          if (t?.tagName === 'BUTTON') t.blur();
          toggleCompareSide();
        } else if (!mod && !e.altKey && (key === 'a' || key === 'b')) {
          showCompareSide(key);
        } else if (e.key === 'Escape') {
          stopCompare();
        } else if (!mod && e.key === '?') {
          useDialogStore.getState().openModal('help');
        } else if (mod && key === 's') {
          e.preventDefault(); // nothing to save: the project is unchanged
        } else if ((mod && ['z', 'y', 'd', 'v', 'g'].includes(key)) || e.key === 'Delete' || e.key === 'Backspace' || (!mod && (key === 'q' || key === 'e'))) {
          if (mod) e.preventDefault();
          notifyCompareLocked();
        }
        return;
      }
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !mod && !e.altKey && ps.project.levels.length > 1) {
        // storeys (#54): Bild auf / Bild ab = the storey above / below
        e.preventDefault();
        if (!goToNeighbourLevel(e.key === 'PageUp' ? 1 : -1)) ui.toast(e.key === 'PageUp' ? 'Keine Etage darüber.' : 'Keine Etage darunter.', 'info');
      } else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        ps.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        ps.redo();
      } else if (mod && key === 'c' && !window.getSelection()?.toString()) {
        if (copySelection()) e.preventDefault();
      } else if (mod && key === 'v') {
        e.preventDefault();
        pasteClipboard();
      } else if (mod && key === 'a' && ui.viewMode !== '3d') {
        // select all furniture
        e.preventDefault();
        ui.selectFurniture(ps.project.furniture.map((f) => f.id));
      } else if (mod && key === 'g') {
        // furniture groups (#65): Strg+G groups the selection, Strg+Umschalt+G dissolves it
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
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
      } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        // context menu of the selection (#235); right-click opens it at the pointer
        if (openMenuForSelection()) e.preventDefault();
      } else if (e.key === 'Escape') {
        const tape = useTapeStore.getState();
        // 3D tape measure (#88): Esc first removes the measurements
        if (tape.items.length || tape.pending) tape.clear();
        else if (ui.tool !== 'select') ui.setTool('select');
        else ui.setSelection(null);
      } else if (!mod && !e.altKey && key === 'k' && ui.viewMode !== '2d') {
        useTapeStore.getState().toggle();
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
      } else if (!mod && e.key === '?') {
        // keyboard overview (#59)
        useDialogStore.getState().openModal('help');
      } else if (!mod && key === 'h') {
        ui.requestFit();
      } else if (!mod && !e.altKey && key === 'p' && ui.viewMode !== '3d') {
        // show/hide the imported plan background (#258)
        toggleUnderlayVisible();
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
