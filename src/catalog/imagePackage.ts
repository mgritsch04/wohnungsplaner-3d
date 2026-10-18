/**
 * Image package for a part model without extra costs (#273): photos + measurement image + the
 * page's sizes of ONE product page the user sent with the bookmarklet, as a ZIP the user gives a
 * Claude chat (own subscription, no API key). The returned .glb is uploaded by hand in the planner.
 * Photos with other furniture confuse the model and cost the same, so cut-out photos and the
 * measurement image are pre-selected and the user can change the selection before saving.
 */
import { IKEA_HELPER_URL } from './providers/ikeaHelper';

export interface PackImage {
  url: string;
  alt: string;
}

export interface ImagePack {
  key: string;
  name: string;
  productUrl: string;
  retailer?: string;
  price?: number;
  /** cm as stated on the page, null when missing */
  width: number | null;
  depth: number | null;
  height: number | null;
  /** page text lines with sizes, material, colours */
  lines: string[];
  images: PackImage[];
  receivedAt: string;
}

export type ImageKind = 'cutout' | 'measure' | 'room';

export const MAX_SELECTED = 5;

type Fetch = typeof fetch;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined);

export function readPack(v: unknown): ImagePack | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const key = str(p.key, 20);
  const name = str(p.name, 200);
  if (!key || !/^(?:s?\d{8}|mx[0-9a-f]{10})$/.test(key) || !name) return null;
  const images = Array.isArray(p.images)
    ? p.images.filter((i): i is PackImage => !!i && typeof i.url === 'string' && /^https:\/\//.test(i.url)).map((i) => ({ url: i.url, alt: typeof i.alt === 'string' ? i.alt.slice(0, 200) : '' }))
    : [];
  return {
    key,
    name,
    productUrl: str(p.productUrl, 2000) ?? '',
    retailer: str(p.retailer, 100),
    price: num(p.price) ?? undefined,
    width: num(p.width),
    depth: num(p.depth),
    height: num(p.height),
    lines: Array.isArray(p.lines) ? p.lines.filter((l): l is string => typeof l === 'string').map((l) => l.slice(0, 160)).slice(0, 60) : [],
    images: images.slice(0, 30),
    receivedAt: str(p.receivedAt, 40) ?? '',
  };
}

/** Pages the bookmarklet sent that have no 3D model, newest first. */
export async function fetchPacks(base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<ImagePack[]> {
  const res = await f(`${base}/bildpakete`);
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { items?: unknown };
  return (Array.isArray(body.items) ? body.items : []).map(readPack).filter((p): p is ImagePack => !!p).reverse();
}

export async function fetchPackImage(key: string, index: number, base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<Blob> {
  const res = await f(`${base}/bildpaket/${key}/${index}`);
  if (!res.ok) throw new Error(`Foto ${index + 1}: HTTP ${res.status}`);
  return res.blob();
}

const MEASURE_WORDS = /ma(ß|ss)(e|bild|skizze|zeichnung)?\b|abmessung|skizze|zeichnung|dimension|technische/i;

/**
 * Kind of photo from small RGBA pixels: a cut-out photo has a large light background connected
 * to the border; a measurement image is almost all background with thin grey lines; everything
 * else is treated as a room photo (other furniture, decor).
 */
export function classifyImage(pixels: Uint8ClampedArray | number[], w: number, h: number, alt = '', url = ''): ImageKind {
  if (MEASURE_WORDS.test(alt) || MEASURE_WORDS.test(decodeURIComponent(url.split('/').pop() ?? ''))) return 'measure';
  const at = (x: number, y: number) => (y * w + x) * 4;
  const light = (i: number) => pixels[i] > 225 && pixels[i + 1] > 225 && pixels[i + 2] > 225;
  // flood fill of the light background from the border
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let count = 0;
  while (stack.length) {
    const p = stack.pop() as number;
    if (bg[p] || !light(p * 4)) continue;
    bg[p] = 1;
    count++;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  const share = count / (w * h);
  if (share < 0.3) return 'room';
  // ink: what is not light; a drawing has little of it and no colour
  let ink = 0;
  let colourful = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (light(i)) continue;
      ink++;
      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (max - min > 40) colourful++;
    }
  if (ink / (w * h) < 0.08 && colourful < ink * 0.15) return 'measure';
  return 'cutout';
}

/** Pre-selection: the first measurement image, then cut-out photos in page order, at most MAX_SELECTED; a room photo only when nothing else exists. */
export function preselect(kinds: (ImageKind | null)[]): boolean[] {
  const sel = kinds.map(() => false);
  const measure = kinds.indexOf('measure');
  let n = 0;
  if (measure >= 0) {
    sel[measure] = true;
    n++;
  }
  kinds.forEach((k, i) => {
    if (k === 'cutout' && n < MAX_SELECTED) {
      sel[i] = true;
      n++;
    }
  });
  if (n === 0) {
    const first = kinds.findIndex((k) => k !== null);
    if (first >= 0) sel[first] = true;
  }
  return sel;
}

const cm = (v: number | null) => (v === null ? '?' : `${Math.round(v * 10) / 10} cm`);

/** Instructions + request text for the Claude chat, inside the package. */
export function packageReadme(pack: ImagePack, files: { name: string; kind: ImageKind | null }[]): string {
  const kindLabel = (k: ImageKind | null) => (k === 'measure' ? 'Maßbild' : k === 'cutout' ? 'Produktfoto' : 'Foto');
  return [
    `Bildpaket für den Wohnungsplaner: ${pack.name}`,
    '',
    'SO GEHT ES',
    '1. Diese ZIP-Datei in einem Claude-Chat hochladen (z. B. im Projekt-Thread) und den Text unter „AUFTRAG“ dazuschreiben.',
    '2. Claude liefert eine .glb-Datei.',
    '3. Im Planer das Möbel auswählen › Eigenschaften › „3D-Modell importieren…“ und die .glb wählen.',
    '',
    'AUFTRAG',
    `Bitte baue aus den Fotos und Maßen in diesem Paket ein einfaches 3D-Teilemodell von „${pack.name}“ als .glb-Datei:`,
    '- Einheit Meter, Y zeigt nach oben, Ursprung = Mitte der Grundfläche auf dem Boden, Vorderseite zeigt nach +Z.',
    `- Gesamtmaße genau: Breite ${cm(pack.width)} (X), Tiefe ${cm(pack.depth)} (Z), Höhe ${cm(pack.height)} (Y).`,
    '- Teile (Platte, Beine/Gestell, Korpus, Polster …) als einfache Körper mit Maßen aus Maßbild und Seitentext; was nur geschätzt ist, mit „ca.“ dazusagen.',
    '- Farben aus den Fotos; Holz darf eine Foto-Textur bekommen.',
    '- Andere Möbel oder Deko auf den Fotos gehören nicht zum Produkt.',
    '',
    'PRODUKT',
    `Name: ${pack.name}`,
    `Seite: ${pack.productUrl}`,
    ...(pack.retailer ? [`Händler: ${pack.retailer}`] : []),
    ...(pack.price ? [`Preis: ${pack.price} €`] : []),
    `Maße laut Seite: B ${cm(pack.width)} × T ${cm(pack.depth)} × H ${cm(pack.height)}`,
    '',
    'BILDER',
    ...files.map((f) => `${f.name}: ${kindLabel(f.kind)}`),
    '',
    'ANGABEN VON DER SEITE',
    ...(pack.lines.length ? pack.lines : ['(keine)']),
    '',
    'Fotos und Texte stammen von der Produktseite des Händlers und sind urheberrechtlich geschützt: nur privat nutzen.',
    '',
  ].join('\n');
}

/** File name in the ZIP from the content type. */
export function imageFileName(index: number, kind: ImageKind | null, type: string): string {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `${String(index + 1).padStart(2, '0')}-${kind === 'measure' ? 'massbild' : 'foto'}.${ext}`;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP (stored, no compression – photos are compressed already). */
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    local.push(new Uint8Array(head.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Kind of a photo blob (browser): decoded small, then classified. */
export async function kindOfImage(blob: Blob, img: PackImage): Promise<ImageKind | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  try {
    const k = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return classifyImage(ctx.getImageData(0, 0, w, h).data, w, h, img.alt, img.url);
  } finally {
    bitmap.close();
  }
}
