import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { addFurniture, addOpening, addRectRoom, setOpeningOpen } from '../model/operations';
import type { Automation, Furniture, Project, SmartDevice } from '../model/schema';
import { migrateProjectObject, parseProject } from '../formats/project/projectFile';
import { automationsYaml, entityIds, slug } from './haYaml';
import { detectionPolygon, doorMotionPoints, initialState, inDetectionArea, occludersOf, roomCoverage, sensorParams, step, type SimInput, type SimState } from './simulation';
import { placementFor } from './actions';
import { formatDuration, rulesOf, ruleSentence } from './rules';

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

describe('detection outline (#170)', () => {
  it('stops at walls', () => {
    const p = twoRooms();
    const d = derivePlan(p);
    const m = { ...p.devices[0], rangeM: 12 };
    const poly = detectionPolygon(m, sensorParams(m), occludersOf(p, d));
    expect(Math.max(...poly.map((q) => q.x))).toBeLessThan(4.1);
    expect(Math.max(...poly.map((q) => q.x))).toBeGreaterThan(3.9);
  });

  it('reports a hand trigger as detection without a person (#233)', () => {
    const p = twoRooms();
    const s = run(p, initialState(p, 22), 1, { person: null, moving: false, triggered: new Set(['m']) });
    expect(s.entities.m.on).toBe(true);
    expect(s.entities.b.on).toBe(true);
  });

  it('places a clicked device at the click, sensors looking at the room centre (#232/#233)', () => {
    const p = twoRooms();
    const d = derivePlan(p);
    const bad = p.rooms.find((r) => r.name === 'Bad')!.id;
    const pos = placementFor(p, d, 'motion', bad, { x: 6.2, y: 1.5 });
    expect(pos).toMatchObject({ x: 6.2, y: 1.5 });
    expect(Math.abs(pos.rotation)).toBeLessThan(0.05); // centre of B is at x ≈ 8
    expect(placementFor(p, d, 'light', bad, { x: 9, y: 2 })).toMatchObject({ x: 9, y: 2, rotation: 0 });
  });

  it('describes rules as sentences (#233)', () => {
    const p = twoRooms();
    expect(ruleSentence(p, p.automations[0])).toEqual({
      when: 'Wenn Melder Flur Bewegung meldet und es dunkel ist',
      then: 'dann Lampe Flur an (80 %), aus nach 2 min ohne Bewegung',
    });
    expect(rulesOf(p, 'b').map((a) => a.id)).toEqual(['a1']);
    expect(rulesOf(p, 'x')).toEqual([]);
    expect(formatDuration(90)).toBe('1,5 min');
  });
});

describe('line of sight through door leaves and furniture (#236)', () => {
  const item = (p: Project, name: string, x: number, height: number, extra: Partial<Furniture> = {}) =>
    addFurniture(p, { name, category: 'storage', x, y: 1.5, elevation: 0, rotation: 0, width: 0.6, depth: 0.6, height, color: '#b0a898', model: { type: 'procedural', shape: 'box' }, quantity: 1, approximate: true, solid: true, locked: false, ...extra } as Furniture);

  it('a tall wardrobe hides the person, a low sofa does not', () => {
    const p = twoRooms();
    const m = p.devices[0];
    const sp = sensorParams(m);
    const person = { x: 3, y: 1.5 };
    item(p, 'Sofa', 1.5, 0.85);
    expect(inDetectionArea(m, sp, person, occludersOf(p, derivePlan(p)))).toBe(true);
    item(p, 'Schrank', 2.2, 2.0);
    expect(inDetectionArea(m, sp, person, occludersOf(p, derivePlan(p)))).toBe(false);
  });

  it('a medium-high sideboard only hides the area close behind it', () => {
    const p = twoRooms();
    const m = p.devices[0];
    const sp = sensorParams(m);
    item(p, 'Sideboard', 1.0, 1.4);
    const occ = occludersOf(p, derivePlan(p));
    expect(inDetectionArea(m, sp, { x: 1.5, y: 1.5 }, occ)).toBe(false); // line still below 1.4 m there
    expect(inDetectionArea(m, sp, { x: 3.5, y: 1.5 }, occ)).toBe(true); // line passes above it
  });

  it('rugs and lamps (not solid) never block', () => {
    const p = twoRooms();
    item(p, 'Stehlampe', 1.5, 1.8, { solid: false });
    expect(inDetectionArea(p.devices[0], sensorParams(p.devices[0]), { x: 3, y: 1.5 }, occludersOf(p, derivePlan(p)))).toBe(true);
  });

  it('cuts the 2D outline at a tall wardrobe', () => {
    const p = twoRooms();
    const m = p.devices[0];
    item(p, 'Schrank', 2.2, 2.0);
    const poly = detectionPolygon(m, sensorParams(m), occludersOf(p, derivePlan(p)));
    const ahead = poly.filter((q) => Math.abs(q.y - 1.5) < 0.05 && q.x > 0.1);
    expect(ahead.length).toBeGreaterThan(0);
    expect(Math.max(...ahead.map((q) => q.x))).toBeLessThan(2.0);
  });

  it('an open door leaf hides the corner behind it, a closed one does not', () => {
    const p = twoRooms();
    const room = p.rooms[0];
    // the room's bottom wall (both nodes on the smallest y)
    const y = (id: string) => p.nodes.find((n) => n.id === id)!.y;
    const minY = Math.min(...room.nodeIds.map(y));
    const wall = p.walls.find((w) => room.nodeIds.includes(w.a) && room.nodeIds.includes(w.b) && Math.abs(y(w.a) - minY) < 1e-6 && Math.abs(y(w.b) - minY) < 1e-6)!;
    const doorId = addOpening(p, wall.id, 'door', 1.0, { open: true })!;
    const d = derivePlan(p);
    const leaf = d.leaves.get(doorId)![0];
    expect(leaf.open).toBe(true);
    // the leaf stands 90° into a room along swingDir; look along the wall at the corner it covers
    const along = (k: number, s: number) => ({ x: leaf.hinge.x + leaf.swingDir.x * s + leaf.closedDir.x * k, y: leaf.hinge.y + leaf.swingDir.y * s + leaf.closedDir.y * k });
    const sensor: SmartDevice = { ...p.devices[0], ...along(2, 0.4), rotation: Math.atan2(-leaf.closedDir.y, -leaf.closedDir.x), rangeM: 6 };
    const person = along(-0.3, 0.4);
    const sp = sensorParams(sensor);
    expect(inDetectionArea(sensor, sp, person, occludersOf(p, d))).toBe(false);
    setOpeningOpen(p, doorId, false);
    expect(inDetectionArea(sensor, sp, person, occludersOf(p, derivePlan(p)))).toBe(true);
  });
});

describe('doors count as motion (#281)', () => {
  const bottomWall = (p: Project, roomIdx: number) => {
    const room = p.rooms[roomIdx];
    const y = (id: string) => p.nodes.find((n) => n.id === id)!.y;
    const minY = Math.min(...room.nodeIds.map(y));
    return p.walls.find((w) => room.nodeIds.includes(w.a) && room.nodeIds.includes(w.b) && Math.abs(y(w.a) - minY) < 1e-6 && Math.abs(y(w.b) - minY) < 1e-6)!;
  };
  const doorEvent = (p: Project, doorId: string): SimInput => ({ person: null, moving: false, doorMotion: doorMotionPoints(derivePlan(p), doorId) });

  it('opening a door in sight makes the sensor report motion and switches the light', () => {
    const p = twoRooms();
    const doorId = addOpening(p, bottomWall(p, 0).id, 'door', 2.0, { open: false })!;
    setOpeningOpen(p, doorId, true);
    let s = initialState(p, 22);
    s = run(p, s, 2, doorEvent(p, doorId));
    expect(s.entities.m.on).toBe(true);
    expect(s.entities.b).toMatchObject({ on: true });
    expect(s.events.some((e) => e.text === 'Melder Flur: Bewegung erkannt (Tür)')).toBe(true);
  });

  it('closing a door in sight reports motion as well', () => {
    const p = twoRooms();
    const doorId = addOpening(p, bottomWall(p, 0).id, 'door', 2.0, { open: true })!;
    setOpeningOpen(p, doorId, false);
    const s = run(p, initialState(p, 22), 2, doorEvent(p, doorId));
    expect(s.entities.m.on).toBe(true);
  });

  it('a door behind a wall or outside the viewing angle is not seen', () => {
    const p = twoRooms();
    const other = addOpening(p, bottomWall(p, 1).id, 'door', 2.0, { open: true })!;
    expect(run(p, initialState(p, 22), 2, doorEvent(p, other)).entities.m.on).toBe(false);
    const near = addOpening(p, bottomWall(p, 0).id, 'door', 2.0, { open: true })!;
    p.devices[0] = { ...p.devices[0], rotation: Math.PI }; // looks away from the door
    expect(run(p, initialState(p, 22), 2, doorEvent(p, near)).entities.m.on).toBe(false);
  });
});
