import { describe, expect, it } from 'vitest';
import { viewPose } from './viewShots';

describe('viewPose', () => {
  it('schaut auf die Mitte und steht südlich und oberhalb', () => {
    const p = viewPose({ minX: 0, minY: 0, maxX: 4, maxY: 3 }, 55);
    expect(p.target).toEqual({ x: 2, y: 0.3, z: 1.5 - 0.18 * 3 });
    expect(p.position.x).toBe(2);
    expect(p.position.z).toBeGreaterThan(0.9);
    expect(p.position.y).toBeGreaterThan(2);
  });
  it('hält Mindestabstand bei winzigen Räumen', () => {
    const p = viewPose({ minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 }, 60);
    expect(Math.hypot(p.position.y, p.position.z + 0.009)).toBeGreaterThanOrEqual(3);
  });
});
