import { describe, expect, it } from 'vitest';
import { rotationForSide } from '../coords';
import type { ProgramItem, RoomProgram, Side } from '../types';
import { intentProblems } from './intent';

const item = (id: string, catalogId: string, x: number, y: number, face: Side): ProgramItem => ({ id, catalogId, zone: 'z', hint: { x, y, rotation: rotationForSide(face) }, why: '' });
const program = (items: ProgramItem[], kitchen?: RoomProgram['kitchen']): RoomProgram => ({ roomId: 'r', reading: '', zones: [], items, relations: [], walk: '', check: [], ...(kitchen ? { kitchen } : {}) });

describe('the programme keeps its own rules before anything is placed (#436)', () => {
  it('a television opposite the sofa at a good distance is fine', () => {
    expect(intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N'), item('tv', 'generic-tv', 2.5, 1.4, 'S')]))).toEqual([]);
  });
  it('a television beside the sofa is named (W5)', () => {
    const p = intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N'), item('tv', 'generic-tv', 4.8, 3.3, 'W')]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/nicht gegenüber.*Norden.*Osten/);
  });
  it('a television far from the sofa is named with the distance (W5)', () => {
    const p = intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 4.0, 'N'), item('tv', 'generic-tv', 2.5, 0.3, 'S')]));
    expect(p[0]).toMatch(/3,3 m.*1,3 bis 2,2 m/);
  });
  it('a sofa looking at the kitchen run is named, beside or behind it is fine (W10)', () => {
    const kitchen = [{ wall: 'W1', from: { x: 1, y: 0 }, to: { x: 4, y: 0 }, modules: ['generic-k-sink-80'] }];
    expect(intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N')], kitchen))[0]).toMatch(/Küchenzeile \(W10\)/);
    expect(intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 2.0, 'S')], kitchen))).toEqual([]);
    expect(intentProblems(program([item('sofa', 'generic-sofa-3', 0.5, 2.5, 'O')], kitchen))).toEqual([]);
  });
  it('a fitted kitchen in the room counts as well, a television in front of it hides it', () => {
    const fitted = [{ id: 'k1', catalogId: 'generic-k-sink-80', name: 'Spüle', category: 'kitchen', x: 2.5, y: 0.3, rotation: rotationForSide('S'), width: 0.8, depth: 0.6, height: 0.86, elevation: 0, kitchen: { type: 'sink' } }] as never[];
    expect(intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N')]), fitted)).toHaveLength(1);
    expect(intentProblems(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N'), item('tv', 'generic-tv', 2.5, 1.4, 'S')]), fitted)).toEqual([]);
  });
});
