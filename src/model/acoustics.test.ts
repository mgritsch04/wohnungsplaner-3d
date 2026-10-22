import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addRectRoom } from './operations';
import { estimateInsulation, noiseClassOf, ratingOf, soundIssues, wallRooms } from './acoustics';

const props = { thickness: 0.12, height: 2.6 };

describe('sound estimate (#80)', () => {
  it('rates constructions', () => {
    expect(ratingOf(estimateInsulation({ assembly: 'concrete', thickness: 0.2 }))).toBe('gut');
    expect(ratingOf(estimateInsulation({ assembly: 'drywall', thickness: 0.1 }))).toBe('schwach');
    expect(estimateInsulation({ thickness: 0.2 })).toBe(47);
  });
  it('classifies rooms by name', () => {
    expect(noiseClassOf('Küche')).toBe('loud');
    expect(noiseClassOf('Schlafzimmer')).toBe('quiet');
    expect(noiseClassOf('Flur')).toBe('neutral');
  });
  it('flags a kitchen next to a bedroom unless the shared wall is concrete', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 3, depth: 3, name: 'Küche', ...props });
    addRectRoom(p, { x: 3, y: 0, width: 3, depth: 3, name: 'Schlafzimmer', ...props });
    const shared = p.walls.filter((w) => wallRooms(p, w.id).length === 2);
    expect(shared.length).toBeGreaterThan(0);
    const issues = soundIssues(p);
    expect(issues).toHaveLength(shared.length);
    for (const w of shared) w.assembly = 'concrete';
    expect(soundIssues(p)).toHaveLength(0);
  });
});
