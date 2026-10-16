import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { doorArc, renderSyntheticPlan } from '../src/import/recognition/syntheticPlans';

/** Encode an 8-bit grayscale image as PNG (no external dependencies). */
export function encodeGrayPng(width: number, height: number, pixel: (x: number, y: number) => number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf: Buffer) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A synthetic floor plan: 100 px = 1 m. One room 5 m × 4 m (wall centerlines),
 * walls 20 px (= 20 cm) thick, with a 1 m gap (door) in the bottom wall.
 */
export function syntheticPlanPng(): Buffer {
  const W = 700;
  const H = 600;
  const x0 = 100;
  const y0 = 100;
  const x1 = 600;
  const y1 = 500;
  const t = 10;
  return encodeGrayPng(W, H, (x, y) => {
    const inH = (yy: number) => Math.abs(y - yy) <= t && x >= x0 - t && x <= x1 + t;
    const inV = (xx: number) => Math.abs(x - xx) <= t && y >= y0 - t && y <= y1 + t;
    const door = Math.abs(y - y1) <= t && x >= 250 && x <= 350;
    return (inH(y0) || (inH(y1) && !door) || inV(x0) || inV(x1)) ? 20 : 255;
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
type WP = {
  useProjectStore: { getState: () => any };
  useUiStore: { getState: () => any };
  useImportStore: { getState: () => any };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Screen coordinates of a plan point (meters) in the 2D editor. */
export async function planToScreen(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const wp = (window as unknown as { __wp: WP }).__wp;
      const v = wp.useUiStore.getState().view2d;
      const svg = document.querySelector('[data-testid="editor2d"] svg')!.getBoundingClientRect();
      return { x: svg.left + (px - v.cx) * v.zoom + svg.width / 2, y: svg.top + (py - v.cy) * v.zoom + svg.height / 2 };
    },
    [x, y] as const,
  );
}

export async function getProject(page: Page) {
  return page.evaluate(() => (window as unknown as { __wp: WP }).__wp.useProjectStore.getState().project);
}

export async function getSelection(page: Page) {
  return page.evaluate(() => (window as unknown as { __wp: WP }).__wp.useUiStore.getState().selection);
}

/**
 * Minimal multi-page vector PDF. Page 2 contains a floor plan drawn as stroked
 * double lines (A4 landscape, 1:100 → 1 m = 28.35 pt): a 5 m × 4 m room, 20 cm walls.
 */
export function vectorPlanPdf(): Buffer {
  const m = 28.3465; // points per metre at 1:100
  const ox = 100;
  const oy = 100;
  const line = (x1: number, y1: number, x2: number, y2: number) => `${(ox + x1 * m).toFixed(2)} ${(oy + y1 * m).toFixed(2)} m ${(ox + x2 * m).toFixed(2)} ${(oy + y2 * m).toFixed(2)} l S`;
  const t = 0.1;
  const plan = [
    '0.8 w 0 G',
    // outer and inner outline of each wall (y up in PDF space – irrelevant for the test)
    line(-t, -t, 5 + t, -t), line(t, t, 5 - t, t),
    line(-t, 4 + t, 5 + t, 4 + t), line(t, 4 - t, 5 - t, 4 - t),
    line(-t, -t, -t, 4 + t), line(t, t, t, 4 - t),
    line(5 + t, -t, 5 + t, 4 + t), line(5 - t, t, 5 - t, 4 - t),
  ].join('\n');
  const cover = 'BT /F1 24 Tf 100 400 Td (Deckblatt) Tj ET';
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  objects.push(`<< /Length ${cover.length} >>\nstream\n${cover}\nendstream`);
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 6 0 R >>');
  objects.push(`<< /Length ${plan.length} >>\nstream\n${plan}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Screen position of a 3D world point (Y up) in the 3D canvas. */
export async function worldToScreen3d(page: Page, x: number, y: number, z: number) {
  return page.evaluate(
    ([wx, wy, wz]) => {
      const t = (window as unknown as { __wp: { three: { camera: { position: { clone: () => { set: (a: number, b: number, c: number) => { project: (c: unknown) => { x: number; y: number } } } } }; canvas: HTMLCanvasElement } } }).__wp.three;
      const v = t.camera.position.clone().set(wx, wy, wz).project(t.camera);
      const r = t.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    [x, y, z] as const,
  );
}

const C30 = Math.cos(Math.PI / 6);
const S30 = Math.sin(Math.PI / 6);
const on30 = (d: number) => ({ x: 5 + C30 * d, y: 1 + S30 * d });

/**
 * Geometry (metres, 100 px = 1 m, 20 cm walls) of a synthetic plan with a sloped wall:
 * a 2 m × 4 m room on the left and a room whose upper right wall runs at 30° (3 m long),
 * with a 90 cm door in the sloped wall and a 90 cm passage in the interior wall.
 */
export const slopedPlan = {
  outline: [{ x: 1, y: 1 }, { x: 5, y: 1 }, on30(3), { x: 5 + 3 * C30, y: 5 }, { x: 1, y: 5 }],
  interiorWall: [{ x: 3, y: 1 }, { x: 3, y: 5 }] as [{ x: number; y: number }, { x: number; y: number }],
  slopedDoor: [on30(1), on30(1.9)] as [{ x: number; y: number }, { x: number; y: number }],
  interiorDoor: [{ x: 3, y: 3 }, { x: 3, y: 3.9 }] as [{ x: number; y: number }, { x: number; y: number }],
};

/** The plan above as PNG, with the door arc of the sloped door drawn as a thin line. */
export function slopedPlanPng(): Buffer {
  const img = renderSyntheticPlan({
    width: 900,
    height: 600,
    pxPerM: 100,
    thickness: 0.2,
    outline: slopedPlan.outline,
    walls: [slopedPlan.interiorWall],
    gaps: [slopedPlan.slopedDoor, slopedPlan.interiorDoor],
    thinLines: [doorArc(on30(1), 0.9, Math.PI / 6, Math.PI / 6 + Math.PI / 2)],
  });
  return encodeGrayPng(img.width, img.height, (x, y) => img.gray[y * img.width + x]);
}
