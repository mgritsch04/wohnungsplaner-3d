import { create } from 'zustand';

/**
 * Picture of the 3D view for Claude (#443, the look before handing over): the scene registers a
 * function that renders the current frame and returns it as a PNG data URL. `bare` hides what
 * only the editor shows (the outlines of a furnishing preview), so the picture looks like the
 * room after it is applied.
 */
interface SceneSnapStore {
  snap: (() => string) | null;
  bare: boolean;
}

export const useSceneSnap = create<SceneSnapStore>(() => ({ snap: null, bare: false }));
