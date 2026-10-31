import { describe, expect, it } from 'vitest';
import { roomSun, roomSunLabel, sunPosition } from './sunPath';

describe('sun path', () => {
  it('has the sun due south and high at solar noon in summer, low in winter', () => {
    const s = sunPosition('summer', 13.1);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(2);
    expect(s.elevation).toBeGreaterThan(62);
    expect(s.elevation).toBeLessThan(67);
    const w = sunPosition('winter', 12.1);
    expect(w.elevation).toBeGreaterThan(16);
    expect(w.elevation).toBeLessThan(21);
  });
  it('rises in the east and sets in the west', () => {
    expect(sunPosition('equinox', 8).azimuth).toBeGreaterThan(90);
    expect(sunPosition('equinox', 8).azimuth).toBeLessThan(130);
    expect(sunPosition('equinox', 17).azimuth).toBeGreaterThan(230);
  });
  it('gives south rooms more sun than north rooms and more in summer for east/west', () => {
    expect(roomSun([180], 'summer').hours).toBeGreaterThan(roomSun([0], 'winter').hours);
    expect(roomSun([0], 'winter').hours).toBe(0);
    expect(roomSun([90], 'summer').from!).toBeLessThan(7);
    expect(roomSun([270], 'winter').to!).toBeLessThan(18);
  });
  it('labels', () => {
    expect(roomSunLabel(roomSun([0], 'winter'))).toBe('keine direkte Sonne');
    expect(roomSunLabel(roomSun([180], 'equinox'))).toMatch(/Std\. direkte Sonne/);
  });
});
