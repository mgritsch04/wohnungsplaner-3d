import { describe, expect, it } from 'vitest';
import { checkCircuits, circuitOfLoad } from './circuits';
import { createEmptyProject } from './factory';
import { ProjectSchema, type Fixture, type Project } from './schema';

const socket = (id: string, circuitId?: string): Fixture => ({ id, kind: 'socket', x: 0, y: 0, rotation: 0, elevation: 0.3, count: 1, circuitId });

function base(): Project {
  const p = createEmptyProject();
  p.circuits.push({ id: 'c1', name: 'Küche', amps: 16 });
  p.fixtures.push(socket('s1', 'c1'), socket('s2'));
  return p;
}

describe('checkCircuits (#135)', () => {
  it('sums loads via socket and directly, and reports the share of the fuse', () => {
    const p = base();
    p.loads.push({ id: 'l1', name: 'Wasserkocher', watts: 2000, fixtureId: 's1' }, { id: 'l2', name: 'Toaster', watts: 900, circuitId: 'c1' });
    const [c] = checkCircuits(p).circuits;
    expect(c.totalW).toBe(2900);
    expect(c.capacityW).toBe(3680);
    expect(c.limitW).toBe(2944);
    expect(c.percent).toBe(79);
    expect(c.status).toBe('ok');
  });

  it('warns above the continuous limit and flags overload above the fuse', () => {
    const p = base();
    p.loads.push({ id: 'l1', name: 'A', watts: 3000, circuitId: 'c1' });
    expect(checkCircuits(p).circuits[0].status).toBe('warn');
    p.loads.push({ id: 'l2', name: 'B', watts: 800, circuitId: 'c1' });
    expect(checkCircuits(p).circuits[0].status).toBe('over');
  });

  it('uses the adjustable limit and fuse', () => {
    const p = base();
    p.settings.circuitLimitPct = 50;
    p.circuits[0].amps = 10;
    p.loads.push({ id: 'l1', name: 'A', watts: 1200, circuitId: 'c1' });
    const c = checkCircuits(p).circuits[0];
    expect(c.limitW).toBe(1150);
    expect(c.status).toBe('warn');
  });

  it('keeps loads without a circuit (socket unassigned, circuit or socket gone) separate', () => {
    const p = base();
    p.loads.push({ id: 'l1', name: 'A', watts: 100, fixtureId: 's2' }, { id: 'l2', name: 'B', watts: 100, fixtureId: 'gone' }, { id: 'l3', name: 'C', watts: 100, circuitId: 'gone' });
    const r = checkCircuits(p);
    expect(r.circuits[0].totalW).toBe(0);
    expect(r.unassigned.map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    expect(circuitOfLoad(p, p.loads[0])).toBeNull();
  });

  it('old projects without the fields still load', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyProject()));
    delete raw.circuits;
    delete raw.loads;
    delete raw.settings.circuitLimitPct;
    const p = ProjectSchema.parse(raw);
    expect(p.circuits).toEqual([]);
    expect(p.loads).toEqual([]);
    expect(p.settings.circuitLimitPct).toBe(80);
  });
});
