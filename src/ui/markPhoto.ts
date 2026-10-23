import { newId } from '../model/ids';
import { db } from '../persistence/db';
import { pickFile } from './fileUtils';

const MAX_SIDE = 1400;

/** Scale a photo down (long side ≤ 1400 px) and re-encode it as JPEG, so it stays small in the local store. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const f = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * f));
  canvas.height = Math.max(1, Math.round(bmp.height * f));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Foto konnte nicht umgewandelt werden'))), 'image/jpeg', 0.82));
}

/** Let the user pick a photo and store it in the local asset store only; resolves with its asset id. */
export async function pickMarkPhoto(): Promise<string | null> {
  const file = await pickFile('image/*');
  if (!file) return null;
  return storeMarkPhoto(file);
}

export async function storeMarkPhoto(file: File | Blob): Promise<string> {
  const blob = await shrink(file as File);
  const id = newId('photo');
  await db.putAsset(id, blob);
  return id;
}
