import { describe, expect, it } from 'vitest';
import { frontOf } from '../suggest/roomGeometry';
import { fromRoomCm, parseSide, rotationForSide, sideOfRotation, sideOfVector, SIDE_VECTOR, SIDES, toRoomCm, wallSide } from './coords';

describe('room coordinates for Claude', () => {
  const origin = { x: 2.26, y: 0.06 };

  it('count whole cm from the north-west corner, x east and y south', () => {
    expect(toRoomCm(origin, { x: 2.26, y: 0.06 })).toEqual({ x: 0, y: 0 });
    expect(toRoomCm(origin, { x: 4.364, y: 1.857 })).toEqual({ x: 210, y: 180 });
    const p = fromRoomCm(origin, 210, 298);
    expect(p.x).toBeCloseTo(4.36);
    expect(p.y).toBeCloseTo(3.04);
  });
});

describe('sides', () => {
  it('a piece facing a side has its front towards it', () => {
    for (const s of SIDES) {
      const f = frontOf({ rotation: rotationForSide(s) });
      expect(f.x).toBeCloseTo(SIDE_VECTOR[s].x);
      expect(f.y).toBeCloseTo(SIDE_VECTOR[s].y);
      expect(sideOfRotation(rotationForSide(s))).toBe(s);
    }
  });

  it('round a rotation to the nearest side', () => {
    expect(sideOfRotation(rotationForSide('O') + 0.3)).toBe('O');
    expect(sideOfRotation(rotationForSide('W') - 0.6)).toBe('W');
  });

  it('name a wall after where it lies: the north wall faces south', () => {
    expect(wallSide({ x: 0, y: 1 })).toBe('N');
    expect(wallSide({ x: -1, y: 0 })).toBe('O');
    expect(wallSide({ x: 0, y: -1 })).toBe('S');
    expect(wallSide({ x: 1, y: 0 })).toBe('W');
    // a bay wall at about 30° off the axes has no side
    expect(wallSide({ x: Math.sin(0.55), y: Math.cos(0.55) })).toBeNull();
    expect(sideOfVector({ x: 1, y: 1.05 })).toBe('S');
    expect(sideOfVector({ x: 0, y: 0 })).toBeNull();
  });

  it('read the ways Claude writes a side', () => {
    expect(['N', 'o', 'E', 'Süd', 'west', 'Osten', ' S '].map(parseSide)).toEqual(['N', 'O', 'O', 'S', 'W', 'O', 'S']);
    expect(parseSide('NO')).toBeNull();
  });
});
