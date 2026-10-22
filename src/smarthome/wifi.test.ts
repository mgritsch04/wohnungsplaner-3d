import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom } from '../model/operations';
import type { Project, SmartDevice } from '../model/schema';
import { levelOf, roomWifi, wallLossDb, wifiGrid, freeLossDb, type WifiBand } from './wifi';
import { levelPaths } from './WifiOverlay2D';

const router = (id: string, x: number, y: number): SmartDevice => ({ id, name: id, kind: 'router', x, y, elevation: 1.5, rotation: 0 });

/** Three rooms in a row, each 4 × 3 m inside, one wall (12 cm) between neighbours. */
function row(thickness = 0.12): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness, height: 2.6 });
  addRectRoom(p, { x: 4 + thickness, y: 0, width: 4, depth: 3, name: 'B', thickness, height: 2.6 });
  addRectRoom(p, { x: 8 + 2 * thickness, y: 0, width: 4, depth: 3, name: 'C', thickness, height: 2.6 });
  return p;
}
const level = (p: Project, band: WifiBand = '2.4') => new Map(roomWifi(wifiGrid(p, derivePlan(p), band), p).map((r) => [p.rooms.find((x) => x.id === r.roomId)!.name, r]));

describe('WLAN coverage (#253)', () => {
  it('has no grid without a router and uses ITU-R P.1238 for the distance loss', () => {
    const p = row();
    expect(wifiGrid(p, derivePlan(p), '2.4')).toBeNull();
    // 20·log10(2437) + 28·log10(10) − 28 = 67.7 dB; 5 GHz is about 6.6 dB worse
    expect(freeLossDb(10, '2.4')).toBeCloseTo(67.74, 1);
    expect(freeLossDb(10, '5') - freeLossDb(10, '2.4')).toBeCloseTo(6.6, 1);
  });

  it('is strongest at the router and weaker behind walls', () => {
    const p = row();
    p.devices = [router('r', 1, 1.5)];
    const g = wifiGrid(p, derivePlan(p), '2.4')!;
    const at = (x: number, y: number) => g.dbm[Math.floor((y - g.minY) / g.cell) * g.cols + Math.floor((x - g.minX) / g.cell)];
    expect(at(1.2, 1.5)).toBeGreaterThan(at(3.5, 1.5));
    const v = level(p);
    expect(v.get('A')!.dbm).toBeGreaterThan(v.get('B')!.dbm);
    expect(v.get('B')!.dbm).toBeGreaterThan(v.get('C')!.dbm);
  });

  it('a second access point improves the weak room; the band changes the values', () => {
    const p = row(0.36);
    p.devices = [router('r', 1, 1.5)];
    const before = level(p).get('C')!;
    p.devices.push(router('ap', 11, 1.5));
    const after = level(p).get('C')!;
    expect(after.dbm).toBeGreaterThan(before.dbm + 10);
    expect(after.level).toBe('good');
    expect(level(p, '5').get('A')!.dbm).toBeLessThan(level(p, '2.4').get('A')!.dbm);
  });

  it('thicker walls damp more; an open door costs nothing, a closed one does', () => {
    expect(wallLossDb(0.1, '2.4')).toBeLessThan(wallLossDb(0.175, '2.4'));
    expect(wallLossDb(0.175, '2.4')).toBeLessThan(wallLossDb(0.3, '2.4'));
    const p = row();
    p.devices = [router('r', 1, 1.5)];
    const fps = derivePlan(p).footprints;
    const wall = p.walls.find((w) => Math.abs(fps.get(w.id)!.a.x - 4.06) < 0.01 && Math.abs(fps.get(w.id)!.b.x - 4.06) < 0.01)!;
    const solid = level(p).get('B')!.dbm;
    const doorId = addOpening(p, wall.id, 'door', 1.5, { width: 1.2 })!;
    const door = p.openings.find((o) => o.id === doorId)!;
    door.open = false;
    const closed = level(p).get('B')!.dbm;
    door.open = true;
    const open = level(p).get('B')!.dbm;
    expect(closed).toBeCloseTo(solid, 1); // closed door and light wall both cost 3 dB
    expect(open).toBeGreaterThan(closed + 2);
  });

  it('maps dBm to levels and merges cells into one path per level', () => {
    expect([-50, -65, -75, -90].map(levelOf)).toEqual(['good', 'medium', 'weak', 'none']);
    const p = row();
    p.devices = [router('r', 1, 1.5)];
    const paths = levelPaths(wifiGrid(p, derivePlan(p), '2.4')!);
    expect(paths.good.startsWith('M')).toBe(true);
  });
});
