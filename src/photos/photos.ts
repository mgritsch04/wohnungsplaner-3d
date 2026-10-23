import { newId } from '../model/ids';
import type { DerivedPlan } from '../model/derived';
import type { Photo, Project } from '../model/schema';
import { pointInPolygon } from '../model/vec';
import { db } from '../persistence/db';
import { useProjectStore } from '../store/projectStore';

/**
 * Reference photos on walls (#86). Pictures are scaled down and stored only in the local asset
 * store of the browser (like imported plans and models); the project holds just the placement.
 * Every operation is one undo step.
 */

const store = () => useProjectStore.getState();

/** Longest side of a stored photo (px); keeps the local store and project packages small. */
export const MAX_PHOTO_PX = 2048;
export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

export const photoHeight = (p: Pick<Photo, 'width' | 'aspect'>) => p.width / p.aspect;

export function photosOfWall(project: Project, wallId: string): Photo[] {
  return project.photos.filter((p) => p.wallId === wallId);
}

/** Start position of a new photo: centred on the wall, its middle at eye level, never wider than the wall. */
export function defaultPlacement(wallLength: number, wallHeight: number, aspect: number): Pick<Photo, 'width' | 'along' | 'bottom'> {
  const maxWidth = Math.max(0.1, wallLength * 0.9);
  const maxHeightWidth = Math.max(0.1, wallHeight * 0.6 * aspect);
  const width = Math.round(Math.min(0.8, maxWidth, maxHeightWidth) * 100) / 100;
  const height = width / aspect;
  const bottom = Math.max(0, Math.min(1.5 - height / 2, wallHeight - height));
  return { width, along: Math.round(((wallLength - width) / 2) * 100) / 100, bottom: Math.round(bottom * 100) / 100 };
}

/** Name of the room on one side of a wall, if there is one (for the side selector). */
export function sideRoomName(project: Project, derived: DerivedPlan, wallId: string, side: 'left' | 'right'): string | null {
  const fp = derived.footprints.get(wallId);
  if (!fp) return null;
  const k = (side === 'left' ? 1 : -1) * (fp.thickness / 2 + 0.2);
  const pt = { x: (fp.a.x + fp.b.x) / 2 + fp.normal.x * k, y: (fp.a.y + fp.b.y) / 2 + fp.normal.y * k };
  for (const r of project.rooms) {
    const g = derived.rooms.get(r.id);
    if (g && pointInPolygon(pt, g.interior)) return r.name || 'Raum';
  }
  return null;
}

/** Scale an image file down to MAX_PHOTO_PX and re-encode it; throws a German message for non-images. */
async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Bitte ein Bild (JPG, PNG oder WebP) wählen.');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Das Bild konnte nicht gelesen werden.');
  }
  const k = Math.min(1, MAX_PHOTO_PX / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * k));
  const height = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  return { blob, width, height };
}

/** Hang a photo on the left side of a wall; returns its id. */
export async function addPhotoToWall(wallId: string, file: File, side: 'left' | 'right' = 'left'): Promise<string> {
  const project = store().project;
  const wall = project.walls.find((w) => w.id === wallId);
  const a = project.nodes.find((n) => n.id === wall?.a);
  const b = project.nodes.find((n) => n.id === wall?.b);
  if (!wall || !a || !b) throw new Error('Die Wand gibt es nicht mehr.');
  const { blob, width, height } = await prepareImage(file);
  const id = newId('photo');
  const assetId = `photo-${id}`;
  await db.putAsset(assetId, blob);
  const aspect = Math.min(20, Math.max(0.05, width / height));
  const place = defaultPlacement(Math.hypot(b.x - a.x, b.y - a.y), wall.height, aspect);
  store().apply((d) => {
    d.photos.push({ id, wallId, side, assetId, fileName: file.name.slice(0, 300), aspect, visible: true, opacity: 1, ...place });
  });
  return id;
}

export function updatePhoto(id: string, fn: (p: Photo) => void) {
  store().apply((d) => {
    const p = d.photos.find((x) => x.id === id);
    if (p) fn(p);
  });
}

/** Removes the placement; the stored image stays so that undo and saved states keep working. */
export function deletePhoto(id: string) {
  store().apply((d) => {
    d.photos = d.photos.filter((p) => p.id !== id);
  });
}

/** Show or hide all photos of a wall (one undo step). */
export function setWallPhotosVisible(wallId: string, visible: boolean) {
  store().apply((d) => {
    for (const p of d.photos) if (p.wallId === wallId) p.visible = visible;
  });
}

/** World placement of a photo (plan metres; y is height) or null when its wall is gone. */
export function photoPlacement(photo: Photo, derived: DerivedPlan) {
  const fp = derived.footprints.get(photo.wallId);
  if (!fp) return null;
  const h = photoHeight(photo);
  const s = photo.side === 'left' ? 1 : -1;
  const t = photo.along + photo.width / 2;
  const off = fp.thickness / 2 + 0.004;
  const nx = fp.normal.x * s;
  const nz = fp.normal.y * s;
  return {
    x: fp.a.x + fp.dir.x * t + nx * off,
    y: photo.bottom + h / 2,
    z: fp.a.y + fp.dir.y * t + nz * off,
    /** Rotation about the vertical axis so the front of the plane faces away from the wall. */
    rotY: Math.atan2(nx, nz),
    width: photo.width,
    height: h,
  };
}
