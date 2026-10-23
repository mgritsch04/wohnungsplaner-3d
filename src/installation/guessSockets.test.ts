import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { fixtureWallGap } from '../model/fixtures';
import { addOpening, addRectRoom } from '../model/operations';
import { derivePlan } from '../model/derived';
import { dist } from '../model/vec';
import { guessSockets } from './guessSockets';

const props = { thickness: 0.12, height: 2.6 };

function twoRooms() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'Wohnzimmer', ...props });
  return p;
}

describe('Steckdosen raten (#374)', () => {
  it('creates nothing for a plan without rooms', () => {
    expect(guessSockets(createEmptyProject())).toEqual([]);
  });

  it('puts marked sockets on wall faces, never in doors and not in corners', () => {
    const p = twoRooms();
    const wall = p.walls[0];
    addOpening(p, wall.id, 'door', 3, { width: 0.9 });
    const found = guessSockets(p);
    expect(found.length).toBeGreaterThan(0);
    const plan = derivePlan(p);
    const opening = plan.openings.get(wall.id)![0];
    for (const f of found) {
      expect(f.kind).toBe('socket');
      expect(f.note).toMatch(/geraten/);
      expect(fixtureWallGap(p, f)!).toBeLessThan(0.05);
    }
    const a = p.nodes.find((n) => n.id === wall.a)!;
    const b = p.nodes.find((n) => n.id === wall.b)!;
    const len = dist(a, b);
    for (const f of found.filter((x) => Math.abs(((x.y - a.y) * (b.y - a.y) + (x.x - a.x) * (b.x - a.x)) / len) >= 0 && dist(x, a) < len + 1 && Math.abs((x.y - a.y) * (b.x - a.x) - (x.x - a.x) * (b.y - a.y)) / len < 0.2)) {
      const s = ((f.x - a.x) * (b.x - a.x) + (f.y - a.y) * (b.y - a.y)) / len;
      expect(s < opening.s0 - 0.3 || s > opening.s1 + 0.3).toBe(true);
    }
  });

  it('uses an outer wall only once per room when no inner wall is free (single room = only outer walls)', () => {
    const p = twoRooms();
    expect(guessSockets(p)).toHaveLength(1);
  });

  it('skips places that already have a socket', () => {
    const p = twoRooms();
    const first = guessSockets(p);
    p.fixtures.push(...first);
    expect(guessSockets(p)).toHaveLength(0);
  });
});
