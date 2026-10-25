/**
 * The look before handing over (#443) sees a room as the image review does: two pictures of the
 * 3D view, from the main door at a slant, cut at 1.20 m, and uncut from almost straight above.
 * The proposed room is shown as a furnishing preview for the moment of the pictures; the view
 * (preview, cut, camera) is put back afterwards. One room at a time, the run asks for several in
 * parallel. Without a 3D view (2D only, walking camera) there are no pictures and the look reads
 * the plan alone.
 */
import type { CatalogItem } from '../catalog/types';
import { layoutSuggestion } from '../design/apply';
import type { ShotRoom } from '../design/run';
import { useProjectStore } from '../store/projectStore';
import { useFurnishStore } from '../suggest/furnishStore';
import { useCameraRig } from '../view3d/cameraBookmarks';
import { usePerformanceStore } from '../view3d/performanceStore';
import { useSceneSnap } from '../view3d/sceneSnap';
import type { SampleImage } from './claude';

/** Longest side of a picture for Claude (px). */
const MAX_SIDE = 1100;
/** Time for the scene to show the preview and the cut (ms). */
const SETTLE_MS = 700;

let queue: Promise<unknown> = Promise.resolve();

export function roomShots(room: ShotRoom, catalog: CatalogItem[] = []): Promise<SampleImage[] | undefined> {
  const next = queue.then(() => shoot(room, catalog));
  queue = next.catch(() => undefined);
  return next;
}

const settle = () => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r())), SETTLE_MS));

async function shoot(room: ShotRoom, catalog: CatalogItem[]): Promise<SampleImage[] | undefined> {
  const { snap } = useSceneSnap.getState();
  const orbit = useCameraRig.getState().orbit;
  if (!snap || !orbit) return undefined;
  const furnish = useFurnishStore.getState();
  const perf = usePerformanceStore.getState();
  const before = { preview: furnish.preview, cutaway: perf.cutaway, exterior: perf.exterior, pose: orbit.get() };
  const xs = room.analysis.polygon.map((p) => p.x);
  const ys = room.analysis.polygon.map((p) => p.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const radius = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
  // into the room from the main door; without one from the south (as `e2e/designBenchmark.spec.ts`)
  const look = room.analysis.entryView?.dir ?? { x: 0, y: -1 };
  const view = (dist: number, up: number) => ({ x: c.x - look.x * dist * Math.cos(up), y: dist * Math.sin(up), z: c.y - look.y * dist * Math.cos(up) });
  try {
    useSceneSnap.setState({ bare: true });
    useCameraRig.setState({ suppressFitUntil: performance.now() + 10_000 });
    furnish.setPreview(layoutSuggestion(useProjectStore.getState().project, [room], catalog));
    usePerformanceStore.getState().setCutaway(true);
    orbit.set(view(Math.max(3.5, (radius + 0.4) / Math.sin((25 * Math.PI) / 180)), (55 * Math.PI) / 180), { x: c.x, y: 0.3, z: c.y });
    await settle();
    const entry = await shrink(snap(), false);
    usePerformanceStore.getState().setCutaway(false);
    orbit.set(view(Math.max(4.5, (radius + 0.6) / Math.sin((25 * Math.PI) / 180)), (88 * Math.PI) / 180), { x: c.x, y: 0, z: c.y });
    await settle();
    const top = await shrink(snap(), true);
    return [entry, top];
  } finally {
    useFurnishStore.getState().setPreview(before.preview);
    usePerformanceStore.setState({ cutaway: before.cutaway, exterior: before.exterior });
    orbit.set(before.pose.position, before.pose.target);
    useSceneSnap.setState({ bare: false });
  }
}

/** A data URL as a PNG of at most `MAX_SIDE` px; `square` keeps the middle square (the room from above). */
async function shrink(url: string, square: boolean): Promise<SampleImage> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Bild der 3D-Ansicht nicht lesbar'));
    img.src = url;
  });
  const side = Math.min(img.width, img.height);
  const sw = square ? side : img.width;
  const sh = square ? side : img.height;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas nicht verfügbar');
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return { mediaType: 'image/png', data: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '') };
}
