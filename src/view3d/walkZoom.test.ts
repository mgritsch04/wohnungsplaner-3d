import { describe, expect, it } from 'vitest';
import { nextWalkFov, trueScaleFov, WALK_FOV, WALK_FOV_MIN, wheelPixels, zoomLookFactor } from './walkZoom';

describe('walkthrough wheel zoom (#228)', () => {
  it('wheel forward narrows the field of view down to the limit, back widens it up to 70°', () => {
    let fov = WALK_FOV;
    fov = nextWalkFov(fov, -100);
    expect(fov).toBeLessThan(WALK_FOV);
    for (let i = 0; i < 40; i++) fov = nextWalkFov(fov, -100);
    expect(fov).toBe(WALK_FOV_MIN);
    for (let i = 0; i < 40; i++) fov = nextWalkFov(fov, 100);
    expect(fov).toBe(WALK_FOV);
  });

  it('scales line and page wheel deltas to pixels', () => {
    expect(wheelPixels(-3, 1)).toBe(-99);
    expect(wheelPixels(1, 2)).toBe(800);
    expect(wheelPixels(-100, 0)).toBe(-100);
  });

  it('turns slower when zoomed in, unchanged at normal view', () => {
    expect(zoomLookFactor(WALK_FOV)).toBeCloseTo(1);
    expect(zoomLookFactor(WALK_FOV_MIN)).toBeLessThan(0.3);
  });
});

describe('true-scale field of view (#256)', () => {
  const screen = { screenWidthPx: 1920, screenHeightPx: 1080 };
  it('matches the angle the view covers: a full 24" screen seen from 60 cm is about 28°', () => {
    const fov = trueScaleFov({ diagonalInch: 24, distance: 0.6, viewHeightPx: 1080, ...screen });
    // 24" 16:9 → 29.9 cm high; 2·atan(14.95 / 60) ≈ 28°
    expect(fov).toBeCloseTo(28, 0);
  });

  it('a larger screen or a closer seat widens it, a smaller 3D view narrows it; always within 20–70°', () => {
    const at = (diagonalInch: number, distance: number, viewHeightPx = 1080) => trueScaleFov({ diagonalInch, distance, viewHeightPx, ...screen });
    expect(at(32, 0.6)).toBeGreaterThan(at(24, 0.6));
    expect(at(24, 0.4)).toBeGreaterThan(at(24, 0.6));
    expect(at(24, 0.6, 700)).toBeLessThan(at(24, 0.6));
    expect(at(13, 3)).toBe(WALK_FOV_MIN);
    expect(at(100, 0.3)).toBe(WALK_FOV);
  });

  it('the wheel zoom works from the base value: back stops at the base, forward at the same share', () => {
    const base = 30;
    let fov = base;
    for (let i = 0; i < 40; i++) fov = nextWalkFov(fov, -100, base);
    expect(fov).toBeCloseTo((base * WALK_FOV_MIN) / WALK_FOV);
    for (let i = 0; i < 40; i++) fov = nextWalkFov(fov, 100, base);
    expect(fov).toBe(base);
    expect(zoomLookFactor(base, base)).toBeCloseTo(1);
  });
});
