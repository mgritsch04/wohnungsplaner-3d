import { describe, expect, it } from 'vitest';
import { approachHour, lampLevel, lightingAt, sunDirection, sunElevationDeg, TIME_PRESETS } from './lighting';

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
    // night is darker than noon; only slight eye adaptation (no longer enough to cancel the darkness)
    expect(lum(night.background)).toBeLessThan(lum(noon.background) / 3);
    expect(night.exposure).toBeGreaterThan(noon.exposure);
    expect(night.exposure).toBeLessThan(1.2);
    // sunset is warmer than noon but not extremely orange (blue channel kept)
    const blue = (hex: string) => parseInt(hex.slice(5, 7), 16);
    expect(blue(sunset.sunColor)).toBeLessThan(blue(noon.sunColor));
    expect(blue(sunset.sunColor)).toBeGreaterThan(110);
  });
});

describe('time-of-day smoothing', () => {
  it('approaches the target frame-rate independently, the short way round the clock', () => {
    // same elapsed time in one big frame or many small frames ends (almost) at the same hour
    let a = 8;
    for (let i = 0; i < 60; i++) a = approachHour(a, 20, 1 / 600, 0.05);
    const b = approachHour(8, 20, 0.1, 0.05);
    expect(a).toBeCloseTo(b, 6);
    // after 0.25 s (5 τ) the 12-hour jump is practically complete; at 1 FPS it is immediate
    let c = 8;
    for (let i = 0; i < 15; i++) c = approachHour(c, 20, 1 / 60, 0.05);
    expect(Math.abs(c - 20)).toBeLessThan(0.1);
    expect(approachHour(8, 20, 1, 0.05)).toBeCloseTo(20, 6);
    // 23 → 1 goes via midnight
    const d = approachHour(23, 1, 0.02, 0.05);
    expect(d > 23 || d < 1).toBe(true);
  });

  it('keeps getting darker after 21:00 instead of saturating at dusk (#7)', () => {
    const at = (h: number) => lightingAt(h);
    const hours = [19.5, 20.5, 21, 21.5, 22]; // full night from about 22:30
    for (let i = 1; i < hours.length; i++) {
      expect(at(hours[i]).ambientStrength).toBeLessThan(at(hours[i - 1]).ambientStrength);
      expect(lum(at(hours[i]).background)).toBeLessThanOrEqual(lum(at(hours[i - 1]).background));
    }
    expect(at(21).night).toBeGreaterThan(0.2);
    expect(at(21).night).toBeLessThan(1);
    expect(at(23.5).night).toBe(1);
    expect(at(23.5).ambientStrength).toBeLessThan(0.02); // moonlight level
    // the ambient night/day ratio leaves room for lamps to make a visible difference
    expect(at(23.5).ambientStrength / at(13).ambientStrength).toBeLessThan(0.02);
  });

  it('switches lamps automatically at dusk, or always on/off', () => {
    expect(lampLevel('auto', lightingAt(13))).toBe(0);
    expect(lampLevel('auto', lightingAt(23.5))).toBe(1);
    expect(lampLevel('auto', lightingAt(21))).toBe(1);
    const dusk = lampLevel('auto', lightingAt(19.75));
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(lampLevel('on', lightingAt(13))).toBe(1);
    expect(lampLevel('off', lightingAt(23.5))).toBe(0);
  });
});
