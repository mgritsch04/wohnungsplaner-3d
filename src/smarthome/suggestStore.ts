import { create } from 'zustand';
import { newId } from '../model/ids';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { productById } from './catalog';
import type { SmartHomeSuggestion } from './suggest';

/**
 * Smart-home suggestion currently shown as a preview (#225). Like the furnishing preview it
 * is not part of the project: it is drawn as an overlay in 2D and only becomes devices when
 * applied; any change of the project (edit, undo, load, applying) makes it stale.
 */
interface SuggestStore {
  preview: SmartHomeSuggestion | null;
  setPreview: (s: SmartHomeSuggestion | null) => void;
}

export const useSmartSuggestStore = create<SuggestStore>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}));

useProjectStore.subscribe((s, prev) => {
  if (s.revision !== prev.revision && useSmartSuggestStore.getState().preview) useSmartSuggestStore.setState({ preview: null });
});

/** Add all proposed devices in ONE undo step; bulbs link to their existing light. Returns the number of devices. */
export function applySmartHomeSuggestion(s: SmartHomeSuggestion): number {
  if (!s.items.length) return 0;
  useProjectStore.getState().apply((d) => {
    for (const it of s.items) {
      const l = it.lightId ? d.lights.find((x) => x.id === it.lightId) : undefined;
      if (it.lightId && !l) continue;
      const kelvin = productById(it.productId)?.kelvin;
      if (l && kelvin) l.temperature = Math.min(Math.max(l.temperature, kelvin[0]), kelvin[1]);
      d.devices.push({ id: newId('dev'), name: it.name, kind: it.kind, productId: it.productId, x: it.x, y: it.y, elevation: it.elevation, rotation: it.rotation, openingId: it.openingId, lightId: it.lightId, speakerType: it.speakerType });
    }
  });
  useSmartSuggestStore.getState().setPreview(null);
  useUiStore.getState().toast(`${s.items.length} Smart-Home-Geräte übernommen – Strg+Z macht alles in einem Schritt rückgängig.`, 'success');
  return s.items.length;
}
