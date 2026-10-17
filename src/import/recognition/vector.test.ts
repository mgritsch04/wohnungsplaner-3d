import { describe, expect, it } from 'vitest';
import { detectVectorWalls, type VectorSegment } from './vector';
import { detectVectorWallsFromPdf, lightPartitions } from './recognizers';

// 100 px = 1 m. A 5 × 4 m room (wall faces), 20 cm walls; the bottom wall has a 90 cm gap at x = 200–290.
const mpp = 0.01;
const S = (x1: number, y1: number, x2: number, y2: number, extra: Partial<VectorSegment> = {}): VectorSegment => ({ x1, y1, x2, y2, ...extra });
function room(): VectorSegment[] {
  return [
    S(0, 0, 500, 0), S(20, 20, 480, 20), // top
    S(0, 0, 0, 400), S(20, 20, 20, 380), // left
    S(500, 0, 500, 400), S(480, 20, 480, 380), // right
    S(0, 400, 200, 400), S(20, 380, 200, 380), S(290, 400, 500, 400), S(290, 380, 480, 380), // bottom, gap 200–290
  ];
}
/** Quarter arc around (cx, cy) from angle a0 to a1, as curve pieces (as the PDF import splits Bézier curves). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 4): VectorSegment[] {
  const out: VectorSegment[] = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    const t = a0 + ((a1 - a0) * (i + 1)) / n;
    out.push(S(cx + r * Math.cos(s), cy + r * Math.sin(s), cx + r * Math.cos(t), cy + r * Math.sin(t), { curve: true }));
  }
  return out;
}
const gapOpening = (segs: VectorSegment[]) => {
  const out = detectVectorWalls(segs, mpp, { oblique: false });
  return out.openings.find((o) => Math.abs(o.center.x - 245) < 10 && Math.abs(o.center.y - 390) < 10);
};

describe('door symbols in vector plans (#37)', () => {
  it('a leaf and a swing arc make a door; hinge and swing side follow the symbol', () => {
    // hinge at the left gap end, leaf drawn open into the room (upwards), arc back to the other gap end
    const o = gapOpening([...room(), S(200, 380, 200, 290), ...arc(200, 380, 90, -Math.PI / 2, 0)]);
    expect(o?.kind).toBe('door');
    expect(o!.hingeSide!.x).toBeLessThan(0); // towards the left gap end
    expect(o!.swingSide!.y).toBeLessThan(0); // into the room (up)
  });

  it('an arc alone is enough, a hinge on the right swings outwards', () => {
    const o = gapOpening([...room(), ...arc(290, 400, 90, Math.PI / 2, Math.PI)]);
    expect(o?.kind).toBe('door');
    expect(o!.hingeSide!.x).toBeGreaterThan(0);
    expect(o!.swingSide!.y).toBeGreaterThan(0);
  });

  it('hatching, labels or furniture lines next to a gap do not make a door', () => {
    const hatch: VectorSegment[] = [];
    for (let k = 0; k < 12; k++) hatch.push(S(150 + k * 15, 300, 230 + k * 15, 380)); // 45° hatching above the gap
    hatch.push(S(210, 330, 260, 330), S(260, 330, 260, 360), S(300, 420, 330, 450)); // short symbol strokes
    const o = gapOpening([...room(), ...hatch]);
    expect(o?.kind).not.toBe('door');
  });

  it('window frame lines without a leaf stay a window; with a leaf the opening is a glazed door', () => {
    const frame = [S(200, 387, 290, 387), S(200, 393, 290, 393)];
    // thin frame lines are symbol lines: pass them as non-wall lines like the PDF import does
    const isWallLine = (n: number) => n < room().length;
    const window = detectVectorWalls([...room(), ...frame], mpp, { oblique: false, isWallLine }).openings[0];
    expect(window.kind).toBe('window');
    const glazed = detectVectorWalls([...room(), ...frame, S(290, 380, 290, 290)], mpp, { oblique: false, isWallLine }).openings[0];
    expect(glazed.kind).toBe('door');
  });
});

describe('light partition walls (#37)', () => {
  it('a thin light-grey filled strip becomes a wall, a floor area does not', () => {
    const fill = (x0: number, y0: number, x1: number, y1: number, path: number) =>
      [S(x0, y0, x1, y0), S(x1, y0, x1, y1), S(x1, y1, x0, y1), S(x0, y1, x0, y0)].map((s) => ({ ...s, areaFill: true, path, width: 0 }));
    const strip = fill(300, 20, 308, 380, 1); // 8 cm drywall from the top to the bottom wall
    const floor = fill(40, 40, 200, 200, 2);
    expect(lightPartitions([...strip, ...floor], mpp)).toHaveLength(1);
    const walls = room().map((s) => ({ ...s, width: 2 }));
    const out = detectVectorWallsFromPdf([...walls, ...strip, ...floor], mpp);
    const partition = out.walls.find((w) => Math.abs(w.a.x - 304) < 3 && Math.abs(w.b.x - 304) < 3);
    expect(partition).toBeDefined();
    expect(partition!.thickness).toBeCloseTo(8, 0);
  });
});
