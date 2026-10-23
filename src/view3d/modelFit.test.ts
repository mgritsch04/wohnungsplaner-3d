import { describe, expect, it } from 'vitest';
import { deskewAngle, fitModel } from './modelFit';

describe('fitting retailer models into their box (#350)', () => {
  it('keeps a model that matches its dimensions', () => {
    expect(fitModel({ x: 1.4, y: 0.75, z: 0.7 }, { width: 1.4, depth: 0.7, height: 0.75 })).toEqual({ turn: false, height: 0.75, heightFromModel: false });
  });

  it('turns a model whose width runs along z (would be squashed sideways otherwise)', () => {
    expect(fitModel({ x: 0.7, y: 0.75, z: 1.4 }, { width: 1.4, depth: 0.7, height: 0.75 }).turn).toBe(true);
  });

  it('office chair stored with its seat height: drawn with the model height, not squashed', () => {
    const f = fitModel({ x: 0.68, y: 1.12, z: 0.68 }, { width: 0.68, depth: 0.68, height: 0.45 });
    expect(f.heightFromModel).toBe(true);
    expect(f.height).toBeCloseTo(1.12, 2);
  });

  it('desk stored with the thickness of its top: drawn standing on its legs, not flat on the floor', () => {
    // model in centimetres: only the proportions count
    const f = fitModel({ x: 140, y: 75, z: 70 }, { width: 1.4, depth: 0.7, height: 0.04 });
    expect(f.height).toBeCloseTo(0.75, 2);
  });

  it('a rug stays flat', () => {
    expect(fitModel({ x: 2, y: 0.01, z: 3 }, { width: 2, depth: 3, height: 0.01 }).height).toBe(0.01);
  });

  it('straightens a model standing askew in its box', () => {
    const a = (25 * Math.PI) / 180;
    const rect = [];
    for (const [x, z] of [[-0.8, -1], [0.8, -1], [0.8, 1], [-0.8, 1], [0, -1], [0, 1]]) rect.push({ x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) });
    const back = deskewAngle(rect);
    expect(Math.abs(Math.abs(back) - a) < 0.02 || Math.abs(Math.abs(back) - (Math.PI / 2 - a)) < 0.02).toBe(true);
    expect(deskewAngle([{ x: -0.8, z: -1 }, { x: 0.8, z: -1 }, { x: 0.8, z: 1 }, { x: -0.8, z: 1 }])).toBe(0);
  });

  it('leaves round and L-shaped footprints alone', () => {
    const circle = Array.from({ length: 36 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 18), z: Math.sin((i * Math.PI) / 18) }));
    expect(deskewAngle(circle)).toBe(0);
    const l = [{ x: 0, z: 0 }, { x: 2.6, z: 0 }, { x: 2.6, z: 0.9 }, { x: 0.9, z: 0.9 }, { x: 0.9, z: 1.8 }, { x: 0, z: 1.8 }];
    expect(deskewAngle(l)).toBe(0);
  });
});
