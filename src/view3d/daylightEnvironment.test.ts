import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDaylightEnvironment, envHour, envKey, environmentTint, unitLuminance } from './daylightEnvironment';
import { lightingAt } from './lighting';

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('environment following the time of day (#192)', () => {
  it('is rebuilt only in steps of the hour', () => {
    expect(envHour(13.1, 0.5)).toBe(13);
    expect(envHour(13.3, 0.5)).toBe(13.5);
    expect(envHour(23.9, 0.5)).toBe(0);
    expect(envKey(13.1, 0, 0.5)).toBe(envKey(13.2, 0.05, 0.5));
    expect(envKey(13.1, 0, 0.5)).not.toBe(envKey(14, 0, 0.5));
    expect(envKey(23, 0, 0.5)).not.toBe(envKey(23, 1, 0.5));
  });

  it('tints change colour, not brightness', () => {
    expect(lum(unitLuminance('#e9c9b0'))).toBeCloseTo(1, 3);
    for (const h of [8, 13, 19.5, 23.5]) {
      const t = environmentTint(lightingAt(h), 1);
      expect(lum(t.panel)).toBeCloseTo(1, 1);
    }
  });

  it('noon is cooler than sunset; at night with lamps on it is warm; the sun spot only by day', () => {
    const noon = environmentTint(lightingAt(13), 0);
    const sunset = environmentTint(lightingAt(19.5), 0);
    const night = environmentTint(lightingAt(23.5), 1);
    const warmth = (c: THREE.Color) => c.r / c.b;
    expect(warmth(sunset.panel)).toBeGreaterThan(warmth(noon.panel));
    expect(warmth(night.panel)).toBeGreaterThan(warmth(noon.panel));
    expect(noon.sun).toBeGreaterThan(0.9);
    expect(night.sun).toBe(0);
  });

  it('builds a tinted room with a sun spot by day', () => {
    const count = (s: THREE.Scene) => {
      let n = 0;
      s.traverse((o) => void (o instanceof THREE.Mesh && n++));
      return n;
    };
    const day = createDaylightEnvironment(13, 0);
    const night = createDaylightEnvironment(23.5, 1);
    expect(count(day)).toBe(count(night) + 1);
    day.dispose();
    night.dispose();
  });
});
