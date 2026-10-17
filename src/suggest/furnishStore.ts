import { create } from 'zustand';
import { useProjectStore } from '../store/projectStore';
import type { FurnishingSuggestion, RoomType, WishItem } from './furnishing';

/**
 * State of the furnishing suggestion (#137): room types and wish lists chosen in the panel
 * (per room id, for this session) and the suggestion currently shown as a preview.
 * The preview is not part of the project: it is drawn as an overlay in 2D and 3D and only
 * becomes furniture when applied.
 */
interface FurnishStore {
  roomTypes: Record<string, RoomType>;
  /** Wish list per room; absent = default list of the room type (minus what is already there). */
  wishes: Record<string, WishItem[]>;
  preview: FurnishingSuggestion | null;
  setRoomType: (roomId: string, type: RoomType) => void;
  setWishes: (roomId: string, wishes: WishItem[] | null) => void;
  setPreview: (s: FurnishingSuggestion | null) => void;
}

export const useFurnishStore = create<FurnishStore>((set) => ({
  roomTypes: {},
  wishes: {},
  preview: null,
  setRoomType: (roomId, type) =>
    set((s) => {
      // a new type starts from its own default list
      const wishes = { ...s.wishes };
      delete wishes[roomId];
      return { roomTypes: { ...s.roomTypes, [roomId]: type }, wishes };
    }),
  setWishes: (roomId, list) =>
    set((s) => {
      const wishes = { ...s.wishes };
      if (list) wishes[roomId] = list;
      else delete wishes[roomId];
      return { wishes };
    }),
  setPreview: (preview) => set({ preview }),
}));

// any change to the project (edit, undo, load, applying the suggestion) makes the preview stale
useProjectStore.subscribe((s, prev) => {
  if (s.revision !== prev.revision && useFurnishStore.getState().preview) useFurnishStore.setState({ preview: null });
});
