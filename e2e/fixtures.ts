import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

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
