import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createSampleProject } from '../model/sample';
import { defaultFigureSpot } from './RefFigure';

describe('reference figure (#263)', () => {
  it('stands in the largest room the walk does not start in', () => {
    const d = derivePlan(createSampleProject());
    const rooms = [...d.rooms.values()].sort((a, b) => b.area - a.area);
    expect(defaultFigureSpot(d, rooms[1].centroid)).toEqual(rooms[0].centroid);
    expect(defaultFigureSpot(d, rooms[0].centroid)).toEqual(rooms[1].centroid);
  });

  it('stands beside the start without rooms', () => {
    expect(defaultFigureSpot({ rooms: new Map() }, { x: 1, y: 2 })).toEqual({ x: 2.5, y: 2 });
  });
});
