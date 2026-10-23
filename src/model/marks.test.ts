import { describe, expect, it } from 'vitest';
import { derivePlan } from './derived';
import { createEmptyProject } from './factory';
import { OUTSIDE_ROOM, markLabels, marksByRoom } from './marks';
import { addRectRoom } from './operations';
import { ProjectSchema } from './schema';

describe('Mieter-Paket marks (#362)', () => {
  it('numbers marks per kind and groups them by room', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
    p.marks.push(
      { id: 'a', kind: 'condition', x: 1, y: 1, note: '' },
      { id: 'b', kind: 'drill', x: 2, y: 1, note: '' },
      { id: 'c', kind: 'condition', x: 50, y: 50, note: '' },
    );
    const l = markLabels(p.marks);
    expect([l.get('a'), l.get('b'), l.get('c')]).toEqual(['Z1', 'B1', 'Z2']);
    const g = marksByRoom(p, derivePlan(p));
    expect(g.map((x) => x.room)).toEqual(['Wohnzimmer', OUTSIDE_ROOM]);
    expect(g[0].marks.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('old projects without marks still parse', () => {
    const { marks, ...old } = createEmptyProject();
    void marks;
    expect(ProjectSchema.parse(old).marks).toEqual([]);
  });
});
