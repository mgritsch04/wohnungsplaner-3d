import { describe, expect, it } from 'vitest';
import { lightingAt, stepHour, sunDirection, sunElevationDeg, TIME_PRESETS } from './lighting';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

describe('time-of-day lighting', () => {
  it('has a continuous sun path (no jumps at sunrise/sunset)', () => {
    for (let h = 0; h < 24; h += 0.05) {
      const a = sunDirection(h);
      const b = sunDirection(h + 0.05);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.03);
      expect(Math.abs(lightingAt(h).daylight - lightingAt(h + 0.05).daylight)).toBeLessThan(0.08);
    }
  });

  it('puts the sun at the horizon at 6 and 20 h, highest at noon, below at night', () => {
    expect(sunElevationDeg(6)).toBeCloseTo(0, 6);
    expect(sunElevationDeg(20)).toBeCloseTo(0, 6);
    expect(sunElevationDeg(13)).toBeCloseTo(62, 6);
    expect(sunElevationDeg(1)).toBeLessThan(-40);
    expect(sunDirection(8).x).toBeGreaterThan(0.3); // morning sun from the east
    expect(sunDirection(18).x).toBeLessThan(-0.3); // evening sun from the west
  });

  it('distinguishes all presets plausibly', () => {
    const [morning, noon, afternoon, sunset, evening, night] = TIME_PRESETS.map((p) => lightingAt(p.hour));
    expect(noon.daylight).toBeGreaterThan(0.95);
    expect(morning.daylight).toBeGreaterThan(0.5);
    expect(afternoon.sunStrength).toBeGreaterThan(0.8);
    expect(sunset.twilight).toBeGreaterThan(0.2);
    expect(evening.artificial).toBeGreaterThan(0.5);
    expect(night.daylight).toBe(0);
    expect(night.artificial).toBe(1);
    // night is darker than noon, but exposure compensates so interiors stay visible
    expect(lum(night.background)).toBeLessThan(lum(noon.background) / 3);
    expect(night.exposure).toBeGreaterThan(noon.exposure);
    // sunset is warmer than noon but not extremely orange (blue channel kept)
    const blue = (hex: string) => parseInt(hex.slice(5, 7), 16);
    expect(blue(sunset.sunColor)).toBeLessThan(blue(noon.sunColor));
    expect(blue(sunset.sunColor)).toBeGreaterThan(110);
  });

  it('blends towards a target hour along the shorter way round the clock', () => {
    expect(stepHour(23, 1, 0.5)).toBeCloseTo(23.5, 9);
    expect(stepHour(1, 23, 0.5)).toBeCloseTo(0.5, 9);
    expect(stepHour(10, 10.2, 0.5)).toBe(10.2);
  });
});
