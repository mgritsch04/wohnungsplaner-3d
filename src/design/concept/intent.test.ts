import { describe, expect, it } from 'vitest';
import { rotationForSide } from '../coords';
import type { ProgramItem, RoomProgram, Side } from '../types';
import { rectRoom } from '../review/testkit';
import { intentProblems } from './intent';

const item = (id: string, catalogId: string, x: number, y: number, face: Side): ProgramItem => ({ id, catalogId, zone: 'z', hint: { x, y, rotation: rotationForSide(face) }, why: '' });
const check = (p: RoomProgram, existing: never[] = [], room?: { polygon: { x: number; y: number }[] }) => intentProblems(p, room, existing);
const program = (items: ProgramItem[], kitchen?: RoomProgram['kitchen']): RoomProgram => ({ roomId: 'r', reading: '', zones: [], items, relations: [], walk: '', check: [], ...(kitchen ? { kitchen } : {}) });

describe('the programme keeps its own rules before anything is placed (#436)', () => {
  it('a television opposite the sofa at a good distance is fine', () => {
    expect(check(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N'), item('tv', 'generic-tv', 2.5, 1.4, 'S')]))).toEqual([]);
  });
  it('a television beside the sofa is named (W5)', () => {
    const p = check(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N'), item('tv', 'generic-tv', 4.8, 3.3, 'W')]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/nicht gegenüber.*Norden.*Osten/);
  });
  it('a television far from the sofa is named with the distance (W5)', () => {
    const p = check(program([item('sofa', 'generic-sofa-3', 2.5, 4.0, 'N'), item('tv', 'generic-tv', 2.5, 0.3, 'S')]));
    expect(p[0]).toMatch(/3,3 m.*1,3 bis 2,2 m/);
  });
  it('a sofa looking at the kitchen run is named, beside or behind it is fine (W10)', () => {
    const kitchen = [{ wall: 'W1', from: { x: 1, y: 0 }, to: { x: 4, y: 0 }, modules: ['generic-k-sink-80'] }];
    expect(check(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N')], kitchen))[0]).toMatch(/Küchenzeile \(W10\)/);
    expect(check(program([item('sofa', 'generic-sofa-3', 2.5, 2.0, 'S')], kitchen))).toEqual([]);
    expect(check(program([item('sofa', 'generic-sofa-3', 0.5, 2.5, 'O')], kitchen))).toEqual([]);
  });
  it('a fitted kitchen in the room counts as well, a television in front of it hides it', () => {
    const fitted = [{ id: 'k1', catalogId: 'generic-k-sink-80', name: 'Spüle', category: 'kitchen', x: 2.5, y: 0.3, rotation: rotationForSide('S'), width: 0.8, depth: 0.6, height: 0.86, elevation: 0, kitchen: { type: 'sink' } }] as never[];
    expect(check(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N')]), fitted)).toHaveLength(1);
    expect(check(program([item('sofa', 'generic-sofa-3', 2.5, 3.5, 'N'), item('tv', 'generic-tv', 2.5, 1.4, 'S')]), fitted)).toEqual([]);
  });
  it('dining chairs need room behind them to the wall (E2)', () => {
    const room = { polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] };
    const set = (ty: number) => program([item('table', 'generic-dining-table-4', 2, ty, 'S'), item('c1', 'generic-chair', 2, ty - 0.6, 'S'), item('c2', 'generic-chair', 2, ty + 0.6, 'N')]);
    expect(check(set(1.5), [], room)).toEqual([]);
    const tight = check(set(0.8), [], room);
    expect(tight).toHaveLength(1);
    expect(tight[0]).toMatch(/nördlichen Seite.*38 cm.*\(E2\)/);
  });
  it('the rug under the bed shows 40 cm on both sides, else a larger rug is named (S5)', () => {
    const bed = item('bed', 'generic-bed-160', 2, 1.1, 'S');
    // 160×230 across a 160 bed (165 cm with its frame): 32 cm each side
    const small = check(program([bed, item('rug', 'generic-rug-160', 2, 1.6, 'O')]));
    expect(small).toHaveLength(1);
    expect(small[0]).toMatch(/zu klein.*selbst quer.*32 cm.*\(S5\).*mindestens 245 cm.*generic-rug-200/);
    // 200×300 lengthwise under the bed: turn it
    expect(check(program([bed, item('rug', 'generic-rug-200', 2, 1.6, 'S')]))[0]).toMatch(/längs.*18 cm.*quer.*je 68 cm/);
    // 200×300 across: 67 cm each side
    expect(check(program([bed, item('rug', 'generic-rug-200', 2, 1.6, 'O')]))).toEqual([]);
    // long enough but pushed to one side
    expect(check(program([bed, item('rug', 'generic-rug-200', 2.5, 1.6, 'O')]))[0]).toMatch(/nicht mittig.*18 cm.*118 cm/);
    // a runner beside the bed is not under it
    expect(check(program([bed, item('mat', 'generic-runner', 3.3, 1.1, 'S')]))).toEqual([]);
  });
  it('a piece of the plan in the way between two doors is named (B2)', () => {
    const room = rectRoom(4, 3.2, { doors: [{ wall: 'W', at: 1.6 }, { wall: 'O', at: 1.6 }], passThrough: true });
    const across = intentProblems(program([item('bed', 'generic-bed-160', 2, 1.6, 'S')]), room);
    expect(across.some((x) => /„bed“ im Weg zwischen den Türen T1 und T2.*\(B2\)/.test(x))).toBe(true);
    expect(intentProblems(program([item('bed', 'generic-bed-160', 2, 1.05, 'N')]), room).some((x) => /\(B2\)/.test(x))).toBe(false);
  });
  it('a living room whose plan leaves a wide patch of floor empty is named with what a designer adds (E6)', () => {
    const room = rectRoom(7, 6, { doors: [{ wall: 'S', at: 6.5 }], windows: [{ wall: 'N', at: 3.5 }] });
    const corner = program([item('sofa', 'generic-sofa-3', 1.2, 0.5, 'S'), item('table', 'generic-coffee-table', 1.2, 1.4, 'S')]);
    const p = intentProblems(corner, room, [], [], 'living');
    expect(p.some((x) => /nach deinen Startplätzen schon.*Leseecke/.test(x))).toBe(true);
    // without a room type (or in a bath) nothing is asked
    expect(intentProblems(corner, room, [], [], 'bath').some((x) => /Startplätzen schon/.test(x))).toBe(false);
  });
});
