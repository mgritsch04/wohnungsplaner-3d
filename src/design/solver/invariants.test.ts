/**
 * Invariants on random rooms (#440): rectangles and L-shapes with random doors and windows,
 * furnished from a random programme. Ways between the doors and door swings stay free, no piece
 * overlaps another, a bedroom of 7 m² and more keeps its bed, the same seed gives the same layout.
 */
import { describe, expect, it } from 'vitest';
import { analyzeFlat } from '../analysis';
import { door, finish, newFlat, room, window, type P } from '../fixtures/build';
import type { RoomAnalysis } from '../types';
import { Rng } from './rng';
import { randomProgram, type Kind } from './testPrograms';
import { solveRoom } from './solve';
import { independentCheck } from './verify';

const props = { thickness: 0.12, height: 2.6 };


function randomRoom(seed: number): { analysis: RoomAnalysis; kind: Kind } {
  const rng = new Rng(seed);
  const r = (a: number, b: number) => a + (b - a) * rng.next();
  const w = Math.round(r(3.0, 5.6) * 20) / 20;
  const h = Math.round(r(2.9, 4.6) * 20) / 20;
  const lShape = rng.next() < 0.35;
  const cx = Math.round(r(0.45, 0.65) * w * 20) / 20;
  const cy = Math.round(r(0.45, 0.65) * h * 20) / 20;
  const pts: P[] = lShape ? [[0, 0], [w, 0], [w, cy], [cx, cy], [cx, h], [0, h]] : [[0, 0], [w, 0], [w, h], [0, h]];
  const p = newFlat(`Zufall ${seed}`);
  room(p, 'Raum', pts, props);
  // openings on random edges, at least 0.35 m from the corners and from each other
  const edges = pts.map((a, i) => [a, pts[(i + 1) % pts.length]] as const);
  const used: { e: number; t0: number; t1: number }[] = [];
  const place = (width: number): { at: P; into: P } | null => {
    for (let tries = 0; tries < 30; tries++) {
      const e = Math.floor(rng.next() * edges.length);
      const [a, b] = edges[e];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < width + 0.8) continue;
      const t = r(0.35 + width / 2, len - 0.35 - width / 2);
      if (used.some((u) => u.e === e && t + width / 2 > u.t0 - 0.3 && t - width / 2 < u.t1 + 0.3)) continue;
      used.push({ e, t0: t - width / 2, t1: t + width / 2 });
      const dx = (b[0] - a[0]) / len;
      const dy = (b[1] - a[1]) / len;
      const at: P = [a[0] + dx * t, a[1] + dy * t];
      // inside is to the right of a clockwise edge on screen: normal (−dy, dx)
      const into: P = [at[0] - dy * 0.5, at[1] + dx * 0.5];
      return { at, into };
    }
    return null;
  };
  const kind = (['living', 'bedroom', 'dining', 'office'] as const)[Math.floor(rng.next() * 4)];
  const doors = 1 + Math.floor(rng.next() * (kind === 'bedroom' ? 2 : 3));
  for (let i = 0; i < doors; i++) {
    const d = place(rng.next() < 0.5 ? 0.8 : 0.9);
    if (!d) continue;
    // swing into the room or out of it
    const out: P = [2 * d.at[0] - d.into[0], 2 * d.at[1] - d.into[1]];
    door(p, d.at, 0.85, rng.next() < 0.7 ? d.into : out);
  }
  const windows = Math.floor(rng.next() * 3);
  for (let i = 0; i < windows; i++) {
    const d = place(1.2);
    if (d) window(p, d.at, 1.2);
  }
  const flat = analyzeFlat(finish(p, `r${seed}`));
  return { analysis: flat.rooms[0], kind };
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('solver invariants on random rooms', () => {
  it.each(SEEDS)('room %i: ways and door swings stay free, nothing overlaps', (seed) => {
    const { analysis, kind } = randomRoom(seed);
    const program = randomProgram(analysis, kind, seed);
    const layout = solveRoom(analysis, program, { seed });
    expect(layout.unsolved).toEqual([]);
    expect(independentCheck(analysis, layout, [])).toEqual([]);
    // every piece is placed or left out with a reason, never lost
    const ids = new Set([...layout.items.map((i) => i.id), ...layout.dropped.map((d) => d.id)]);
    for (const it of program.items) expect(ids.has(it.id), it.id).toBe(true);
    if (kind === "bedroom" && analysis.area >= 7) expect(layout.items.some((i) => i.catalogId.startsWith("generic-bed")), JSON.stringify({ area: analysis.area, dropped: layout.dropped, doors: analysis.walls.map((w) => [w.id, w.length.toFixed(2), w.openings.map((o) => o.id + ":" + o.t0.toFixed(2) + "-" + o.t1.toFixed(2) + (o.swingsIn ? "in" : ""))]) })).toBe(true);
  });

  it('gives the same layout for the same seed', () => {
    const { analysis, kind } = randomRoom(3);
    const program = randomProgram(analysis, kind, 3);
    expect(JSON.stringify(solveRoom(analysis, program, { seed: 4 }))).toBe(JSON.stringify(solveRoom(analysis, program, { seed: 4 })));
  });
});
