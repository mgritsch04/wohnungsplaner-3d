import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { addRectRoom } from '../model/operations';
import type { Automation, Project, SmartDevice } from '../model/schema';
import { migrateProjectObject, parseProject } from '../formats/project/projectFile';
import { automationsYaml, entityIds, slug } from './haYaml';
import { initialState, inDetectionArea, occludersOf, roomCoverage, sensorParams, step, type SimInput, type SimState } from './simulation';
import { placementFor } from './actions';

/** Two separate rooms: A with interior 0..4 × 0..3, B with interior 6..10 × 0..3. */
function twoRooms(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Flur', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 6, y: 0, width: 4, depth: 3, name: 'Bad', thickness: 0.12, height: 2.6 });
  p.lights.push({ id: 'l1', name: 'Decke', x: 2, y: 1.5, elevation: 2.4, temperature: 2700, intensity: 1, on: false });
  const devices: SmartDevice[] = [
    { id: 'm', name: 'Melder Flur', kind: 'motion', productId: 'ikea-vallhorn', x: 0.05, y: 1.5, elevation: 2.1, rotation: 0 },
    { id: 'b', name: 'Lampe Flur', kind: 'light', x: 2, y: 1.5, elevation: 2.4, rotation: 0, lightId: 'l1' },
  ];
  p.devices = devices;
  const a: Automation = { id: 'a1', name: 'Flur: Licht bei Bewegung', enabled: true, trigger: { type: 'motion', deviceId: 'm' }, onlyWhenDark: true, action: { deviceIds: ['b'], on: true, brightness: 80 }, offAfterS: 120 };
  p.automations = [a];
  return p;
}

function run(p: Project, s: SimState, seconds: number, input: SimInput): SimState {
  const occ = occludersOf(p, derivePlan(p));
  for (let i = 0; i < seconds; i++) s = step(p, occ, s, 1, input);
  return s;
}

describe('smart-home simulation (#170)', () => {
  it('uses datasheet values and marks missing ones as assumptions', () => {
    const p = twoRooms();
    const sp = sensorParams(p.devices[0]);
    expect(sp).toMatchObject({ rangeM: 5, angleDeg: 120, assumed: { range: false, angle: false, hold: true } });
    expect(sensorParams({ ...p.devices[0], productId: undefined, rangeM: 3 }).assumed).toEqual({ range: false, angle: true, hold: true });
  });

  it('detects inside range and angle with line of sight only', () => {
    const p = twoRooms();
    const occ = occludersOf(p, derivePlan(p));
    const m = { ...p.devices[0], rangeM: 12 };
    const sp = sensorParams(m);
    expect(inDetectionArea(m, sp, { x: 3, y: 1.5 }, occ)).toBe(true);
    expect(inDetectionArea(m, sp, { x: 0.3, y: 2.9 }, occ)).toBe(false); // outside the 120° wedge
    expect(inDetectionArea(m, sp, { x: 8, y: 1.5 }, occ)).toBe(false); // other room, walls in between
  });

  it('switches the light on at night and off after hold time + off-delay', () => {
    const p = twoRooms();
    let s = initialState(p, 22);
    s = run(p, s, 2, { person: { x: 2.5, y: 1.5 }, moving: true });
    expect(s.entities.m.on).toBe(true);
    expect(s.entities.b).toMatchObject({ on: true, brightness: 80 });
    // person stands still: a PIR sensor no longer sees them; it reports "no motion" after 60 s (assumed hold time)
    s = run(p, s, 59, { person: { x: 2.5, y: 1.5 }, moving: false });
    expect(s.entities.m.on).toBe(true);
    s = run(p, s, 2, { person: { x: 2.5, y: 1.5 }, moving: false });
    expect(s.entities.m.on).toBe(false);
    s = run(p, s, 118, { person: null, moving: false });
    expect(s.entities.b.on).toBe(true);
    s = run(p, s, 3, { person: null, moving: false });
    expect(s.entities.b.on).toBe(false);
  });

  it('re-arms the off-delay on new motion (mode restart) and respects "only when dark"', () => {
    const p = twoRooms();
    let s = initialState(p, 22);
    s = run(p, s, 2, { person: { x: 2, y: 1.5 }, moving: true });
    s = run(p, s, 62, { person: null, moving: false }); // sensor off → off-delay running
    s = run(p, s, 100, { person: null, moving: false });
    s = run(p, s, 1, { person: { x: 2, y: 1.5 }, moving: true }); // new motion before the delay ends
    s = run(p, s, 30, { person: null, moving: false });
    expect(s.entities.b.on).toBe(true);
    const day = run(p, initialState(p, 12), 2, { person: { x: 2, y: 1.5 }, moving: true });
    expect(day.entities.m.on).toBe(true);
    expect(day.entities.b.on).toBe(false);
  });

  it('presence sensors also see a still person', () => {
    const p = twoRooms();
    p.devices[0] = { ...p.devices[0], kind: 'presence', productId: 'aqara-fp1e' };
    const s = run(p, initialState(p, 22), 2, { person: { x: 2, y: 1.5 }, moving: false });
    expect(s.entities.m.on).toBe(true);
  });

  it('computes the covered floor share per room', () => {
    const p = twoRooms();
    const d = derivePlan(p);
    const cov = roomCoverage(p, d, occludersOf(p, d));
    const flur = cov.get(p.rooms[0].id)!;
    expect(flur).toBeGreaterThan(0.5);
    expect(flur).toBeLessThan(1);
    expect(cov.get(p.rooms[1].id)).toBe(0);
  });

  it('places a new sensor in a room corner looking into the room', () => {
    const p = twoRooms();
    const d = derivePlan(p);
    const pos = placementFor(p, d, 'motion', p.rooms[0].id);
    const sp = sensorParams({ ...p.devices[0], ...pos });
    expect(inDetectionArea({ ...p.devices[0], ...pos }, sp, { x: 2, y: 1.5 }, occludersOf(p, d))).toBe(true);
  });
});

describe('Home Assistant export (#170)', () => {
  it('writes HA automations with restart mode, sun condition and off-delay', () => {
    const y = automationsYaml(twoRooms());
    expect(y).toContain('mode: restart');
    expect(y).toContain('entity_id: binary_sensor.melder_flur');
    expect(y).toContain('state: below_horizon');
    expect(y).toContain('action: light.turn_on');
    expect(y).toContain('brightness_pct: 80');
    expect(y).toContain('seconds: 120');
    expect(y).toContain('action: light.turn_off');
  });

  it('builds unique entity ids from names', () => {
    expect(slug('Bewegungsmelder Küche')).toBe('bewegungsmelder_kueche');
    const ids = entityIds([
      { id: '1', name: 'Melder', kind: 'motion', x: 0, y: 0, elevation: 2, rotation: 0 },
      { id: '2', name: 'Melder', kind: 'motion', x: 0, y: 0, elevation: 2, rotation: 0 },
    ]);
    expect([...ids.values()]).toEqual(['binary_sensor.melder', 'binary_sensor.melder_2']);
  });
});

describe('schema 2 migration (#170)', () => {
  it('adds empty devices/automations to version-1 projects and keeps saved devices', () => {
    const p = twoRooms();
    const { devices: _d, automations: _a, ...v1 } = { ...p, schemaVersion: 1 };
    expect(migrateProjectObject(v1)).toMatchObject({ schemaVersion: 2, devices: [], automations: [] });
    const back = parseProject(JSON.parse(JSON.stringify(p))).project;
    expect(back.devices).toHaveLength(2);
    expect(back.automations[0].offAfterS).toBe(120);
  });
});
