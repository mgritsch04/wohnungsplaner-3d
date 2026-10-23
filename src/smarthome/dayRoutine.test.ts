import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import type { Automation, Project, SmartDevice } from '../model/schema';
import { positionAt, roomRole, runDayRoutine, summarizeDay, WALK_SPEED, type DayResult } from './dayRoutine';

const props = { thickness: 0.12, height: 2.6 };

/** Schlafzimmer, Bad and Wohnzimmer in a row (x 0…4, 4.12…8.12, 8.24…12.24) with doors; each has a motion sensor, a lamp and a rule. */
function flat(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3.5, name: 'Schlafzimmer', ...props });
  addRectRoom(p, { x: 4.12, y: 0, width: 4, depth: 3.5, name: 'Bad', ...props });
  addRectRoom(p, { x: 8.24, y: 0, width: 4, depth: 3.5, name: 'Wohnzimmer', ...props });
  for (const x of [4.06, 8.18]) {
    const w = closestWall(p, { x, y: 1.75 })!;
    addOpening(p, w.wall.id, 'door', w.s, { width: 0.9, open: true });
  }
  const room = (id: string, name: string, x: number, mx: number, rot: number): [SmartDevice[], Automation] => {
    p.lights.push({ id: `l-${id}`, name: `Decke ${name}`, x, y: 1.75, elevation: 2.4, temperature: 2700, intensity: 1, on: false });
    return [
      [
        { id: `m-${id}`, name: `Melder ${name}`, kind: 'motion', productId: 'ikea-vallhorn', x: mx, y: 1.75, elevation: 2.1, rotation: rot, rangeM: 3, angleDeg: 360 },
        { id: `b-${id}`, name: `Lampe ${name}`, kind: 'light', x, y: 1.75, elevation: 2.4, rotation: 0, lightId: `l-${id}` },
      ],
      { id: `a-${id}`, name: `${name}: Licht bei Bewegung`, enabled: true, trigger: { type: 'motion', deviceId: `m-${id}` }, onlyWhenDark: true, action: { deviceIds: [`b-${id}`], on: true, brightness: 60 }, offAfterS: 120 },
    ];
  };
  const [d1, a1] = room('s', 'Schlafzimmer', 2, 2, 0);
  const [d2, a2] = room('b', 'Bad', 6.1, 6.1, 0);
  const [d3, a3] = room('w', 'Wohnzimmer', 10.2, 10.2, 0);
  p.devices = [...d1, ...d2, ...d3];
  p.automations = [a1, a2, a3];
  return p;
}

const run = (p: Project) => runDayRoutine(p, derivePlan(p));
const ok = (p: Project) => {
  const r = run(p);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('day routine (#359)', () => {
  it('maps room names to roles', () => {
    expect(roomRole('Elternschlafzimmer')).toBe('schlafen');
    expect(roomRole('Gäste-WC')).toBe('bad');
    expect(roomRole('Küche')).toBe('kueche');
    expect(roomRole('Arbeitszimmer')).toBe('arbeiten');
    expect(roomRole('Wohnzimmer')).toBe('wohnen');
    expect(roomRole('Flur')).toBeNull();
  });

  it('refuses without devices or enough rooms', () => {
    const p = flat();
    p.devices = [];
    expect(run(p)).toMatchObject({ ok: false });
    const single = createEmptyProject();
    addRectRoom(single, { x: 0, y: 0, width: 4, depth: 3, name: 'Schlafzimmer', ...props });
    single.devices = flat().devices;
    expect(run(single)).toMatchObject({ ok: false });
  });

  it('walks the stations at walking speed and lies still afterwards', () => {
    const r = ok(flat());
    expect(r.stations[0]).toMatchObject({ label: 'Schlafen', room: 'Schlafzimmer' });
    expect(r.stations.some((s) => s.room === 'Bad')).toBe(true);
    const walk = r.segments.find((s) => s.walking)!;
    const len = walk.points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - walk.points[i].x, p.y - walk.points[i].y), 0);
    expect(walk.t1 - walk.t0).toBeCloseTo(len / WALK_SPEED, -1);
    expect(positionAt(r.segments, 0).walking).toBe(false);
    expect(positionAt(r.segments, walk.t0 + 1).walking).toBe(true);
    expect(r.durationS).toBeGreaterThanOrEqual(24 * 3600);
  });

  it('finds no gaps when every room has a sensor, a lamp and an off-delay', () => {
    const r = ok(flat());
    const bad = r.findings.filter((f) => f.kind !== 'late');
    expect(bad).toEqual([]);
  });

  it('does not count the dark bedroom against a sleeping person, even without a bathroom', () => {
    const p = flat();
    p.rooms.find((r) => r.name === 'Bad')!.name = 'Flur';
    p.devices = p.devices.filter((d) => d.id !== 'm-s'); // no sensor in the bedroom at all
    const r = ok(p);
    expect(r.findings.filter((f) => f.room === 'Schlafzimmer' && f.hour < 3)).toEqual([]);
  });

  it('reports a light hole where the sensor was removed', () => {
    const p = flat();
    p.devices = p.devices.filter((d) => d.id !== 'm-b');
    const r = ok(p);
    expect(r.findings.some((f) => f.kind === 'never' && f.room === 'Bad')).toBe(true);
    expect(summarizeDay(r)).toContain('Licht zu spät/nie');
  });

  it('reports needless brightness at night when a lamp never switches off', () => {
    const p = flat();
    p.automations = p.automations.map((a) => ({ ...a, offAfterS: undefined }));
    const r = ok(p);
    const bright = r.findings.filter((f) => f.kind === 'bright');
    expect(bright.length).toBeGreaterThan(0);
    expect(summarizeDay(r)).toContain('nachts unnötig hell');
  });

  it('does not rate rooms without a smart lamp', () => {
    const p = flat();
    p.devices = p.devices.filter((d) => d.id !== 'b-b' && d.id !== 'm-b');
    p.automations = p.automations.filter((a) => a.id !== 'a-b');
    const r: DayResult = ok(p);
    expect(r.unrated).toEqual(['Bad']);
    expect(r.findings.filter((f) => f.room === 'Bad')).toEqual([]);
  });
});
