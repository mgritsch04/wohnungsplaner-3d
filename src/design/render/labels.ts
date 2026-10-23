/**
 * Label placement for the room image (#442): each label goes to the first of its candidate
 * places that does not cover an earlier label or marker and stays inside the image; when none
 * is free it takes the first one anyway.
 */
import { textWidth } from './svg';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Placed {
  /** Centre of the text. */
  x: number;
  y: number;
  box: Box;
  /** Took a free place (false: covers something). */
  free: boolean;
}

const PAD = 1.5;

export const boxAround = (x: number, y: number, w: number, h: number): Box => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });

const hits = (a: Box, b: Box) => a.x0 < b.x1 + PAD && b.x0 < a.x1 + PAD && a.y0 < b.y1 + PAD && b.y0 < a.y1 + PAD;

export class LabelLayer {
  private readonly boxes: Box[] = [];

  constructor(private readonly bounds: Box) {}

  /** Keeps labels off this area (finding markers, the title). */
  block(b: Box): void {
    this.boxes.push(b);
  }

  /** Size of a one-line label in px. */
  static size(text: string, size: number, bold = false): { w: number; h: number } {
    return { w: textWidth(text, size, bold) + 2, h: size * 1.2 };
  }

  place(text: string, size: number, bold: boolean, candidates: readonly { x: number; y: number }[]): Placed {
    const { w, h } = LabelLayer.size(text, size, bold);
    const inside = (b: Box) => b.x0 >= this.bounds.x0 && b.y0 >= this.bounds.y0 && b.x1 <= this.bounds.x1 && b.y1 <= this.bounds.y1;
    for (const c of candidates) {
      const box = boxAround(c.x, c.y, w, h);
      if (inside(box) && !this.boxes.some((b) => hits(b, box))) {
        this.boxes.push(box);
        return { x: c.x, y: c.y, box, free: true };
      }
    }
    const c = candidates[0];
    const box = boxAround(c.x, c.y, w, h);
    this.boxes.push(box);
    return { x: c.x, y: c.y, box, free: false };
  }
}
