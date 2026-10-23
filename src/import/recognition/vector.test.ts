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

  it('window frame lines make a window, also with a sash swing drawn (windows are not doors)', () => {
    const frame = [S(200, 387, 290, 387), S(200, 393, 290, 393)];
    // thin frame lines are symbol lines: pass them as non-wall lines like the PDF import does
    const isWallLine = (n: number) => n < room().length;
    const window = detectVectorWalls([...room(), ...frame], mpp, { oblique: false, isWallLine }).openings[0];
    expect(window.kind).toBe('window');
    // sash drawn open like a leaf, with a swing arc: still a window (the hinge is kept)
    const sash = detectVectorWalls([...room(), ...frame, S(290, 380, 290, 290), ...arc(290, 380, 90, Math.PI, 1.5 * Math.PI)], mpp, { oblique: false, isWallLine }).openings[0];
    expect(sash.kind).toBe('window');
    expect(sash.hingeSide!.x).toBeGreaterThan(0);
  });

  it('in a plan with curves, straight lines never count as a swing arc', () => {
    // straight pieces around the gap end at about the gap width (like hatching) and a real curve elsewhere
    const fake: VectorSegment[] = [];
    for (let k = 0; k < 6; k++) {
      const s = Math.PI + (k * Math.PI) / 12;
      const t = Math.PI + ((k + 1) * Math.PI) / 12;
      fake.push(S(290 + 90 * Math.cos(s), 380 + 90 * Math.sin(s), 290 + 90 * Math.cos(t), 380 + 90 * Math.sin(t)));
    }
    expect(gapOpening([...room(), ...fake])?.kind).toBe('door'); // a plan without curves: polyline arcs count
    expect(gapOpening([...room(), ...fake, ...arc(100, 100, 30, 0, Math.PI / 2)])?.kind).toBe('passage');
  });
});

describe('wall details in vector plans (#37)', () => {
  const wallAt = (out: ReturnType<typeof detectVectorWalls>, o: 'h' | 'v', c: number) =>
    out.walls.filter((w) => (o === 'h' ? Math.abs(w.a.y - c) < 3 && Math.abs(w.b.y - c) < 3 : Math.abs(w.a.x - c) < 3 && Math.abs(w.b.x - c) < 3));

  it('a light partition drawn with dashed lines is a wall', () => {
    const dashed: VectorSegment[] = [];
    for (let y = 20; y < 380; y += 30) dashed.push(S(300, y, 300, Math.min(380, y + 20)), S(312, y, 312, Math.min(380, y + 20)));
    const out = detectVectorWalls([...room(), ...dashed], mpp, { oblique: false });
    const partition = wallAt(out, 'v', 306);
    expect(partition).toHaveLength(1);
    expect(partition[0].thickness).toBeCloseTo(12, 0);
    // dashes of a single line (furniture, lines above) stay symbols
    expect(wallAt(detectVectorWalls([...room(), ...dashed.filter((s) => s.x1 === 300)], mpp, { oblique: false }), 'v', 300)).toHaveLength(0);
  });

  it('a thin wall runs on through a shaft block beside it – no opening into the shaft', () => {
    // partition (10 cm, y 195–205) from the left wall to a 50 cm shaft block (y 196–246) at the right wall
    const segs = [...room(), S(20, 195, 290, 195), S(20, 205, 290, 205), S(300, 196, 480, 196), S(300, 246, 480, 246)];
    const out = detectVectorWalls(segs, mpp, { oblique: false });
    const partition = wallAt(out, 'h', 200);
    expect(partition).toHaveLength(1);
    expect(Math.max(partition[0].a.x, partition[0].b.x)).toBeGreaterThan(480);
    expect(wallAt(out, 'h', 221)).toHaveLength(1); // the shaft itself
    expect(out.openings.filter((o) => o.center.y > 150 && o.center.y < 260)).toEqual([]);
  });

  it('a shaft block in line with a wall (beside a bathtub) stays a block of its own', () => {
    // left wall (20 cm) with a 50 cm deep, 1.2 m long shaft block at its top end
    const segs = [
      ...room().filter((s) => !(s.x1 === s.x2 && s.x1 <= 20)),
      ...[S(0, 0, 0, 140), S(50, 20, 50, 140), S(0, 140, 50, 140)], // block outline
      ...[S(-3, 145, -3, 400), S(17, 145, 17, 380)], // wall faces below it (slightly offset, as drawn in CAD plans)
    ];
    const out = detectVectorWalls(segs, mpp, { oblique: false });
    const block = wallAt(out, 'v', 25);
    expect(block).toHaveLength(1);
    expect(block[0].thickness).toBeCloseTo(50, 0);
    expect(Math.max(block[0].a.y, block[0].b.y)).toBeLessThan(150);
    // the wall itself still runs from corner to corner
    const wall = out.walls.find((w) => Math.abs(w.a.x - w.b.x) < 1 && Math.abs(w.a.y - w.b.y) > 350 && w.thickness < 40);
    expect(wall).toBeDefined();
    // with its own thickness, not mixed with the block's
    expect(wall!.thickness).toBeCloseTo(20, 0);
  });

  it('a hollow shaft drawn as a closed outline keeps its outer size', () => {
    // as above, but the 50 cm block is a hollow shaft: a frame of 12 cm around a cavity, open towards the top wall
    const segs = [
      ...room().filter((s) => !(s.x1 === s.x2 && s.x1 <= 20)),
      ...[S(0, 20, 0, 140), S(50, 20, 50, 140), S(0, 140, 50, 140)], // outline
      ...[S(12, 20, 12, 128), S(38, 20, 38, 128), S(12, 128, 38, 128)], // cavity
      ...[S(-3, 145, -3, 400), S(17, 145, 17, 380)],
    ];
    const out = detectVectorWalls(segs, mpp, { oblique: false });
    const block = wallAt(out, 'v', 25);
    expect(block).toHaveLength(1);
    expect(block[0].thickness).toBeCloseTo(50, 0);
    // down to the outline's end, not only to the cavity's
    expect(Math.max(block[0].a.y, block[0].b.y)).toBeCloseTo(140, 0);
  });

  it('a hollow shaft box spans its whole outline, not only the cavity', () => {
    // a 60 cm deep, 1.6 m wide shaft box against the room's top wall: frame lines all round, a cavity inside
    const segs = [
      ...room(),
      ...[S(100, 20, 260, 20), S(100, 80, 260, 80), S(100, 20, 100, 80), S(260, 20, 260, 80)], // outline
      ...[S(115, 35, 245, 35), S(115, 55, 245, 55), S(115, 35, 115, 55), S(245, 35, 245, 55)], // cavity
    ];
    const out = detectVectorWalls(segs, mpp, { oblique: false });
    const shaft = out.walls.find((w) => Math.abs(w.a.y - w.b.y) < 1 && Math.abs(w.a.y - 50) < 3);
    expect(shaft).toBeDefined();
    expect(shaft!.thickness).toBeCloseTo(60, 0);
    expect(Math.min(shaft!.a.x, shaft!.b.x)).toBeCloseTo(100, 0);
    expect(Math.max(shaft!.a.x, shaft!.b.x)).toBeCloseTo(260, 0);
  });

  it('a second line beside a wall (a neighbouring shaft face) is no wall and gets no doors', () => {
    // a 20 cm layer outside the left wall, from y = 100 to 300, sharing the wall's outer face line
    const out = detectVectorWalls([...room(), S(-20, 100, -20, 300)], mpp, { oblique: false });
    expect(out.walls.filter((w) => w.a.x < -5 && w.b.x < -5)).toEqual([]);
    expect(out.openings.filter((o) => o.center.x < 30)).toEqual([]);
  });

  it('a wide gap without a door or window symbol is no opening: the walls end there (open corridor)', () => {
    const segs = [...room().slice(0, 6), S(0, 400, 150, 400), S(20, 380, 150, 380), S(330, 400, 500, 400), S(330, 380, 480, 380)];
    const out = detectVectorWalls(segs, mpp, { oblique: false });
    expect(out.openings.filter((o) => o.center.y > 300)).toEqual([]);
    expect(wallAt(out, 'h', 390)).toHaveLength(2);
    // a narrow gap still is a passage
    expect(gapOpening(room())?.kind).toBe('passage');
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

describe('short wall piece beside a door (#267)', () => {
  // bottom wall: long piece 0–370, door gap 370–460, 20 cm piece between jamb and right wall (460–480 inside, 500 outside)
  const withStub = (): VectorSegment[] => [
    S(0, 0, 500, 0), S(20, 20, 480, 20),
    S(0, 0, 0, 400), S(20, 20, 20, 380),
    S(500, 0, 500, 400), S(480, 20, 480, 380),
    S(0, 400, 370, 400), S(20, 380, 370, 380),
    S(460, 400, 500, 400), S(460, 380, 480, 380),
  ];
  it('keeps the piece as wall, so the opening is the real 90 cm gap', () => {
    const out = detectVectorWalls(withStub(), mpp, { oblique: false });
    const o = out.openings.find((x) => Math.abs(x.center.y - 390) < 10);
    expect(o).toBeDefined();
    expect(o!.width).toBeGreaterThan(85);
    expect(o!.width).toBeLessThan(95);
    expect(o!.center.x).toBeGreaterThan(405);
    expect(o!.center.x).toBeLessThan(425);
  });
  it('a short pair of lines without a door gap stays a symbol', () => {
    const segs = [...room(), S(100, 400, 120, 400), S(100, 380, 120, 380)];
    expect(detectVectorWalls(segs, mpp, { oblique: false }).walls.length).toBe(detectVectorWalls(room(), mpp, { oblique: false }).walls.length);
  });
});
