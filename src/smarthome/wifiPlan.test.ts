import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import type { Project, SmartDevice, WifiAp, WifiNeighbor } from '../model/schema';
import { roomWifi, wallLossDb, wifiGrid } from './wifi';
import { buildNet, channelAdvice, channelOverlap, checkClients, linkChecks, neighborReach, rateGrid, roomRates, routerHint, suggestNodes, usableMbps, wifiAt } from './wifiPlan';

const ap = (id: string, x: number, y: number, wifi?: WifiAp): SmartDevice => ({ id, name: id, kind: 'router', x, y, elevation: 1.5, rotation: 0, wifi });

/** Three rooms in a row, each 4 × 3 m inside, one wall between neighbours. */
function row(thickness = 0.12): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness, height: 2.6 });
  addRectRoom(p, { x: 4 + thickness, y: 0, width: 4, depth: 3, name: 'B', thickness, height: 2.6 });
  addRectRoom(p, { x: 8 + 2 * thickness, y: 0, width: 4, depth: 3, name: 'C', thickness, height: 2.6 });
  return p;
}
const neighbor = (over: Partial<WifiNeighbor>): WifiNeighbor => ({ id: 'n1', name: 'Nachbar', x: 2, y: -0.6, band: '2.4', channel: 6, width: 20, floor: 'same', load: 'high', ...over });
const rates = (p: Project, band: '2.4' | '5' | 'best' = 'best') => new Map(roomRates(rateGrid(buildNet(p, derivePlan(p)), band), p).map((r) => [p.rooms.find((x) => x.id === r.roomId)!.name, r]));

describe('WLAN planning (#492)', () => {
  it('rate grows with signal, channel width and standard', () => {
    expect(usableMbps(10, 20, 2, 'wifi6', '5')).toBeLessThan(usableMbps(30, 20, 2, 'wifi6', '5'));
    expect(usableMbps(30, 80, 2, 'wifi6', '5')).toBeGreaterThan(3.5 * usableMbps(30, 20, 2, 'wifi6', '5'));
    expect(usableMbps(45, 80, 2, 'wifi7', '5')).toBeGreaterThan(usableMbps(45, 80, 2, 'wifi6', '5'));
    expect(usableMbps(45, 80, 2, 'wifi6', '5')).toBeGreaterThan(usableMbps(45, 80, 2, 'wifi5', '5'));
    expect(usableMbps(2, 20, 2, 'wifi6', '2.4')).toBe(0);
  });

  it('knows which channels overlap', () => {
    expect(channelOverlap('2.4', { ch: 1, width: 20 }, { ch: 6, width: 20 })).toBe(0);
    expect(channelOverlap('2.4', { ch: 1, width: 20 }, { ch: 3, width: 20 })).toBeCloseTo(0.5);
    expect(channelOverlap('5', { ch: 36, width: 80 }, { ch: 44, width: 20 })).toBeCloseTo(0.25);
    expect(channelOverlap('5', { ch: 40, width: 80 }, { ch: 52, width: 80 })).toBe(0);
    expect(channelOverlap('5', { ch: 100, width: 80 }, { ch: 112, width: 40 })).toBeCloseTo(0.5);
  });

  it('uses the wall construction: concrete damps more than drywall of the same thickness', () => {
    expect(wallLossDb(0.15, '2.4', 'concrete')).toBeGreaterThan(wallLossDb(0.15, '2.4', 'drywall'));
    const p = row(0.15);
    p.devices = [ap('r', 1, 1.5)];
    const dbmC = (q: Project) => roomWifi(wifiGrid(q, derivePlan(q), '2.4'), q).find((r) => q.rooms.find((x) => x.id === r.roomId)!.name === 'C')!.dbm;
    const brick = dbmC(p);
    p.walls.forEach((w) => (w.assembly = 'drywall'));
    expect(dbmC(p)).toBeGreaterThan(brick + 5);
  });

  it('6 GHz only from a WLAN 6E/7 device; a WLAN 4 router sends no 5 GHz', () => {
    const p = row();
    p.devices = [ap('r', 1, 1.5)];
    expect(wifiGrid(p, derivePlan(p), '6')).toBeNull();
    p.devices = [ap('r', 1, 1.5, { standard: 'wifi6e' })];
    expect(wifiGrid(p, derivePlan(p), '6')).not.toBeNull();
    p.devices = [ap('r', 1, 1.5, { standard: 'wifi4' })];
    expect(wifiGrid(p, derivePlan(p), '5')).toBeNull();
  });

  it('a strong neighbour on the same channel costs air time; automatic channel avoids it, a fixed one gets advice', () => {
    const p = row();
    p.devices = [ap('r', 1, 1.5, { ch24: 6 })];
    const clean = rates(p, '2.4').get('A')!.mbps;
    p.wifiNeighbors = [neighbor({ channel: 6 })];
    const jammed = rates(p, '2.4').get('A')!.mbps;
    expect(jammed).toBeLessThan(clean * 0.75);
    const adv = channelAdvice(buildNet(p, derivePlan(p))).find((a) => a.band === '2.4')!;
    expect(adv.better).toBe(true);
    expect([1, 11]).toContain(adv.best);
    expect(adv.text).toMatch(/Besser Kanal/);
    // automatic: the router is assumed to pick a free channel
    p.devices = [ap('r', 1, 1.5)];
    const net = buildNet(p, derivePlan(p));
    expect(net.channels.get('r')!['2.4']!.ch).not.toBe(6);
    expect(rates(p, '2.4').get('A')!.mbps).toBeCloseTo(clean, 0);
  });

  it('a measured neighbour value calibrates the estimate; a neighbour upstairs comes through the ceiling', () => {
    const p = row();
    p.devices = [ap('r', 1, 1.5)];
    p.wifiNeighbors = [neighbor({ measuredDbm: -55, measuredAt: { x: 2, y: 0.3 } })];
    const reach = neighborReach(buildNet(p, derivePlan(p)))[0];
    expect(reach.measured).toBe(true);
    expect(reach.maxDbm).toBeGreaterThan(-56);
    expect(reach.maxDbm).toBeLessThan(-45);
    p.wifiNeighbors = [neighbor({ floor: 'above', x: 2, y: 1.5 })];
    const up = neighborReach(buildNet(p, derivePlan(p)))[0];
    expect(up.maxDbm).toBeLessThan(-40);
    expect(up.maxDbm).toBeGreaterThan(-75);
  });

  it('a repeater only passes on what it receives and shares its radio; a cable or own band does better', () => {
    const p = row(0.3);
    p.devices = [ap('r', 1, 1.5)];
    const alone = rates(p).get('C')!.mbps;
    p.devices = [ap('r', 1, 1.5), ap('rep', 6, 1.5, { role: 'repeater' })];
    const net = buildNet(p, derivePlan(p));
    expect(net.links.get('rep')!.uplinkId).toBe('r');
    expect(net.channels.get('rep')!['5']!.ch).toBe(net.channels.get('r')!['5']!.ch);
    const viaRepeater = rates(p).get('C')!.mbps;
    expect(viaRepeater).toBeGreaterThan(alone);
    p.devices = [ap('r', 1, 1.5), ap('rep', 6, 1.5, { role: 'ap' })];
    expect(rates(p).get('C')!.mbps).toBeGreaterThan(viaRepeater);
    // too far away: weak link
    p.devices = [ap('r', 1, 1.5), ap('rep', 11, 1.5, { role: 'repeater' })];
    const link = linkChecks(buildNet(p, derivePlan(p)))[0];
    expect(link.quality).toBe('weak');
    expect(link.text).toMatch(/halbem Weg/);
  });

  it('checks own devices and advises a cable for a stationary one', () => {
    const p = row(0.3);
    p.devices = [ap('r', 1, 1.5)];
    p.wifiClients = [
      { id: 'tv', name: 'Fernseher', type: 'tv', x: 11.5, y: 1.5, needMbps: 200 },
      { id: 'ph', name: 'Handy', type: 'phone', x: 1.5, y: 1.5 },
    ];
    const c = checkClients(buildNet(p, derivePlan(p)));
    expect(c.find((x) => x.id === 'ph')!.ok).toBe(true);
    const tv = c.find((x) => x.id === 'tv')!;
    expect(tv.ok).toBe(false);
    expect(tv.advice).toMatch(/LAN-Kabel/);
    p.devices.push(ap('ap', 11, 1, { role: 'ap' }));
    expect(checkClients(buildNet(p, derivePlan(p))).find((x) => x.id === 'tv')!.ok).toBe(true);
  });

  it('suggests where a mesh node helps and says what it brings; nothing when all is covered', () => {
    const p = row(0.3);
    p.devices = [ap('r', 1, 1.5)];
    p.wifiClients = [{ id: 'pc', name: 'PC', type: 'pc', x: 11.5, y: 2.5 }];
    const t0 = performance.now();
    const [s] = suggestNodes(p, derivePlan(p), 'mesh');
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(s).toBeTruthy();
    expect(s.x).toBeGreaterThan(4);
    expect(s.after.share).toBeGreaterThan(s.before.share);
    expect(s.after.clientsOk).toBeGreaterThanOrEqual(s.before.clientsOk);
    expect(s.uplinkId).toBe('r');
    expect(s.reason).toMatch(/Fläche/);
    const q = row();
    q.devices = [ap('r', 6, 1.5), ap('a', 1, 1.5, { role: 'ap' }), ap('c', 11, 1.5, { role: 'ap' })];
    expect(suggestNodes(q, derivePlan(q), 'mesh')).toEqual([]);
  });

  it('hints at a better router spot only when it clearly helps', () => {
    const p = row(0.3);
    p.devices = [ap('r', 0.5, 1.5)];
    const h = routerHint(p, derivePlan(p));
    expect(h).toBeTruthy();
    expect(h!.after).toBeGreaterThan(h!.before + 0.14);
    const q = row();
    q.devices = [ap('r', 6, 1.5)];
    expect(routerHint(q, derivePlan(q))).toBeNull();
  });

  it('internet line caps the rate; wifiAt says which access point and band', () => {
    const p = row();
    p.devices = [ap('r', 1, 1.5)];
    p.wifiInternetMbps = 30;
    const w = wifiAt(buildNet(p, derivePlan(p)), { x: 1.5, y: 1.5 });
    expect(w.apId).toBe('r');
    expect(w.band).not.toBeNull();
    expect(w.mbps).toBeLessThanOrEqual(30);
  });
});
