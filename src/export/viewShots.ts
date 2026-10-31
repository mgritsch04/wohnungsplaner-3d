/**
 * 3D-Bilder für die Einrichtungsmappe: eine Übersicht und je Raum ein Blick von schräg oben
 * (Schnittansicht, Decke weg). Ansicht, Schnitt und Kamera werden danach zurückgesetzt.
 * Ohne 3D-Ansicht (nur 2D, Begehen) gibt es keine Bilder.
 */
import { furnitureRoomLookup } from '../budget/rooms';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { boundsOf } from '../model/vec';
import { useCameraRig } from '../view3d/cameraBookmarks';
import { usePerformanceStore } from '../view3d/performanceStore';
import { useSceneSnap } from '../view3d/sceneSnap';
import { planBounds } from './planExport';

export interface ViewShot {
  label: string;
  url: string;
}

const MAX_SIDE = 1400;
const SETTLE_MS = 700;
const settle = () => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r())), SETTLE_MS));

export function hasSceneSnap(): boolean {
  return !!useSceneSnap.getState().snap && !!useCameraRig.getState().orbit;
}

/** Kameraort für einen Blick auf ein Rechteck (m) unter `elevationDeg` von der Südseite. */
export function viewPose(b: { minX: number; minY: number; maxX: number; maxY: number }, elevationDeg: number, margin = 1.15) {
  const cx = (b.minX + b.maxX) / 2;
  // etwas nach Norden versetzt: der Blick von Süden lässt sonst unten viel leere Fläche
  const cy = (b.minY + b.maxY) / 2 - 0.18 * (b.maxY - b.minY);
  const radius = Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2, 1.2) * margin;
  const el = (elevationDeg * Math.PI) / 180;
  const dist = Math.max(3, radius / Math.sin((25 * Math.PI) / 180));
  return { position: { x: cx, y: dist * Math.sin(el), z: cy + dist * Math.cos(el) }, target: { x: cx, y: 0.3, z: cy } };
}

async function shrink(url: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Bild der 3D-Ansicht nicht lesbar'));
    img.src = url;
  });
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * k);
  canvas.height = Math.round(img.height * k);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas nicht verfügbar');
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** Nimmt die Bilder auf; `null`, wenn gerade keine 3D-Ansicht läuft. */
export async function captureViewShots(project: Project, onProgress?: (done: number, total: number) => void): Promise<ViewShot[] | null> {
  const { snap } = useSceneSnap.getState();
  const orbit = useCameraRig.getState().orbit;
  if (!snap || !orbit) return null;
  const derived = derivePlan(project);
  const roomOf = furnitureRoomLookup(project, derived);
  const targets: { label: string; box: { minX: number; minY: number; maxX: number; maxY: number }; el: number; margin?: number }[] = [];
  const all = planBounds(project, derived);
  if (all) targets.push({ label: 'Übersicht', box: all, el: 70, margin: 1.6 });
  for (const r of project.rooms) {
    const g = derived.rooms.get(r.id);
    if (!g) continue;
    // nur Räume mit Möbeln bekommen ein eigenes Bild
    const box = boundsOf(g.interior);
    if (box && project.furniture.some((f) => roomOf(f)?.id === r.id)) targets.push({ label: r.name, box, el: 65 });
  }
  const perf = usePerformanceStore.getState();
  const before = { cutaway: perf.cutaway, exterior: perf.exterior, pose: orbit.get() };
  const out: ViewShot[] = [];
  try {
    useSceneSnap.setState({ bare: true });
    useCameraRig.setState({ suppressFitUntil: performance.now() + 60_000 });
    usePerformanceStore.getState().setCutaway(true);
    for (const [i, t] of targets.entries()) {
      onProgress?.(i, targets.length);
      const p = viewPose(t.box, t.el, t.margin);
      orbit.set(p.position, p.target);
      await settle();
      out.push({ label: t.label, url: await shrink(snap()) });
    }
    onProgress?.(targets.length, targets.length);
    return out;
  } finally {
    usePerformanceStore.getState().setCutaway(before.cutaway);
    orbit.set(before.pose.position, before.pose.target);
    useCameraRig.setState({ suppressFitUntil: performance.now() + 500 });
    useSceneSnap.setState({ bare: false });
  }
}
