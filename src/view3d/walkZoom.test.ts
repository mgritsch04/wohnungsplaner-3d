import { describe, expect, it } from 'vitest';
import { nextWalkFov, WALK_FOV, WALK_FOV_MIN, wheelPixels, zoomLookFactor } from './walkZoom';

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
