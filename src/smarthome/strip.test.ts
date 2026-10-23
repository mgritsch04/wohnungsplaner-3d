import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { addRectRoom } from '../model/operations';
import { migrateProjectObject, parseProject } from '../formats/project/projectFile';
import type { Automation, Furniture, Project, SmartDevice } from '../model/schema';
import { sightOccluders } from '../model/visibility';
import { automationsYaml } from './haYaml';
import { initialState, occludersOf, step } from './simulation';
import { formatLength, kelvinToHex, snapToEdges, stripColor, stripLengthM, stripPoints } from './strip';

const strip = (extra: Partial<SmartDevice> = {}): SmartDevice => ({
  id: 's1',
  name: 'LED-Streifen Küche',
  kind: 'strip',
  x: 1,
  y: 1,
  rotation: 0,
  elevation: 1.4,
  points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2.5 }],
  direction: 'down',
  ...extra,
});

function kitchen(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Küche', thickness: 0.12, height: 2.6 });
  p.devices = [
    { id: 'm', name: 'Melder Küche', kind: 'motion', productId: 'ikea-vallhorn', x: 0.05, y: 1.5, elevation: 2.1, rotation: 0 },
    strip(),
  ];
  const a: Automation = { id: 'a1', name: 'Küche: Leiste bei Bewegung', enabled: true, trigger: { type: 'motion', deviceId: 'm' }, onlyWhenDark: false, action: { deviceIds: ['s1'], on: true, brightness: 40, color: '#ffb46b' }, offAfterS: 120 };
  p.automations = [a];
  return p;
}

describe('LED strip (#238)', () => {
  it('measures the length along all sections', () => {
    expect(stripLengthM(strip().points!)).toBeCloseTo(3.5, 5);
    expect(formatLength(3.5)).toBe('3,50 m');
    expect(stripPoints({ x: 2, y: 1 })).toHaveLength(2);
  });

  it('colour: planned colour wins over kelvin, a rule colour over both', () => {
    expect(stripColor({ color: '#112233' })).toBe('#112233');
    expect(stripColor({ color: '#112233' }, { color: '#ff0000' })).toBe('#ff0000');
    expect(stripColor({})).toBe(kelvinToHex(2700));
    expect(kelvinToHex(2700)).toMatch(/^#ff[a-f0-9]{4}$/);
    expect(kelvinToHex(6500)).toBe('#fffefa');
  });

  it('snaps to a wall face or a furniture edge, but only when close', () => {
    const p = kitchen();
    const wall = sightOccluders(p, derivePlan(p));
    const f = { x: 2, y: 1.5, width: 1, depth: 0.6, rotation: 0 } as Furniture;
    const withF = { furniture: [f] };
    const onEdge = snapToEdges({ x: 2.1, y: 1.28 }, withF, []); // 2 cm from the cabinet front (y = 1.2)? edge at y 1.2 or 1.8
    expect(onEdge.y).toBeCloseTo(1.2, 5);
    expect(snapToEdges({ x: 2, y: 0.4 }, withF, [])).toEqual({ x: 2, y: 0.4 }); // too far from the cabinet
    const nearWall = snapToEdges({ x: 1.5, y: 0.1 }, { furniture: [] }, wall);
    expect(nearWall.y).toBeLessThan(0.1); // pulled onto the wall face
  });

  it('a motion rule switches the strip on with brightness and colour, off again later', () => {
    const p = kitchen();
    const occ = occludersOf(p, derivePlan(p));
    let s = initialState(p, 22);
    expect(s.entities.s1).toMatchObject({ on: false, brightness: 100 });
    for (let i = 0; i < 2; i++) s = step(p, occ, s, 1, { person: { x: 2, y: 1.5 }, moving: true });
    expect(s.entities.s1).toMatchObject({ on: true, brightness: 40, color: '#ffb46b' });
    for (let i = 0; i < 200; i++) s = step(p, occ, s, 1, { person: null, moving: false });
    expect(s.entities.s1.on).toBe(false);
  });

  it('exports the strip as light.* with brightness_pct and rgb_color / color_temp_kelvin', () => {
    const p = kitchen();
    const yaml = automationsYaml(p);
    expect(yaml).toContain('light.led_streifen_kueche  ←  LED-Streifen Küche');
    expect(yaml).toContain('action: light.turn_on');
    expect(yaml).toContain('brightness_pct: 40');
    expect(yaml).toContain('rgb_color: [255, 180, 107]');
    // without a rule colour the planned colour temperature is exported for that strip
    p.automations[0].action.color = undefined;
    p.devices[1] = strip({ kelvin: 3000 });
    expect(automationsYaml(p)).toContain('color_temp_kelvin: 3000');
  });

  it('is saved and loaded with the project; files without strips stay valid', () => {
    const p = kitchen();
    const back = parseProject(JSON.parse(JSON.stringify(p))).project;
    const d = back.devices.find((x) => x.kind === 'strip');
    expect(d?.points).toHaveLength(3);
    expect(d?.direction).toBe('down');
    const old = ({ ...JSON.parse(JSON.stringify(createEmptyProject())), devices: [{ id: 'l', name: 'Lampe', kind: 'light', x: 0, y: 0, elevation: 2, rotation: 0 }] });
    expect(() => parseProject(old)).not.toThrow();
    expect(migrateProjectObject(old)).toBeTruthy();
  });
});
