import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { buildingSpans, fitCheck, formatCm, formatMeters } from './shopFit';

// Sample flat: living room 5 × 4 m (ceiling 2.6 m) with sofa, TV board, lamp; bedroom 3.5 × 4 m.
describe('Laden-Modus (#361)', () => {
  const project = createSampleProject();
  const rooms = buildingSpans(project);
  const living = rooms.find((r) => r.name === 'Wohnzimmer')!;

  it('lists free wall stretches per room, longest first', () => {
    expect(rooms.map((r) => r.name)).toEqual(['Wohnzimmer', 'Schlafzimmer']);
    expect(living.height).toBeCloseTo(2.6);
    const lengths = living.spans.map((s) => s.length);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
    // the left wall is completely free; the sofa (2.1 m wide) stands 1.8 m from it
    const left = living.spans.find((s) => s.start === 'Ecke' && s.end === 'Ecke')!;
    expect(left.length).toBeCloseTo(4, 1);
    expect(left.depth).toBeCloseTo(1.8, 1);
    expect(left.niche).toBe(false);
  });

  it('names what bounds a niche and cuts furniture out of the wall length', () => {
    const niche = rooms.flatMap((r) => r.spans).find((s) => s.niche)!;
    expect(niche).toBeDefined();
    expect(niche.start).not.toBe('Ecke');
    // the TV board (1.8 m) stands at the top wall: no stretch next to it overlaps it
    expect(living.spans.some((s) => s.start === 'TV-Lowboard' || s.end === 'TV-Lowboard')).toBe(true);
  });

  it('answers whether B × T × H fits, both ways round', () => {
    const slim = fitCheck(rooms, 0.8, 0.3, 1.8);
    expect(slim.fits.length).toBeGreaterThan(0);
    // 0.3 × 0.8: the 0.8 m side may also stand into the room
    const turned = fitCheck(rooms, 0.3, 1.7, 1.0);
    expect(turned.fits.length).toBeGreaterThan(0);
    const huge = fitCheck(rooms, 6, 1, 1);
    expect(huge.fits).toHaveLength(0);
    expect(huge.nearest?.missBy).toBeGreaterThan(0);
  });

  it('refuses things higher than the ceiling', () => {
    const tall = fitCheck(rooms, 0.5, 0.3, 3);
    expect(tall.fits).toHaveLength(0);
    expect(tall.tooHigh).toBe(true);
  });

  it('lets low things stand under a window, tall things not', () => {
    const lowRooms = buildingSpans(project, 0.5);
    const tallRooms = buildingSpans(project, 2);
    const longest = (rs: typeof rooms) => Math.max(...rs.flatMap((r) => r.spans.map((s) => s.length)));
    expect(longest(lowRooms)).toBeGreaterThanOrEqual(longest(tallRooms));
    const windowSpans = (rs: typeof rooms) => rs.flatMap((r) => r.spans).filter((s) => s.start === 'Fenster' || s.end === 'Fenster').length;
    expect(windowSpans(lowRooms)).toBeLessThan(windowSpans(tallRooms));
  });

  it('formats for the shop display', () => {
    expect(formatMeters(2.345)).toBe('2,35 m');
    expect(formatCm(0.8)).toBe('80');
  });
});
