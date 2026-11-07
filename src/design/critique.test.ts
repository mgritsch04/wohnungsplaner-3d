import { describe, expect, it } from 'vitest';
import { viewLines } from './critique';
import { layoutOf, put, rectRoom } from './review/testkit';
import type { RoomProgram } from './types';

const program = (labels: Record<string, string>) => ({ roomId: 'r', items: Object.entries(labels).map(([id, label]) => ({ id, label })) }) as unknown as RoomProgram;

describe('view lines for the critique (#436)', () => {
  it('names what a sofa looks at: past the low coffee table to the TV, or the wall with its window', () => {
    const room = rectRoom(5, 4, { doors: [{ wall: 'S', at: 4.4 }], windows: [{ wall: 'N', at: 2.5 }] });
    const sofa = put('generic-sofa-3', { id: 'sofa', x: 2.5, y: 3.5, face: 'N' });
    const coffee = put('generic-coffee-table', { id: 'coffee', x: 2.5, y: 2.6, face: 'N' });
    const tv = put('generic-tv-sideboard', { id: 'board', x: 2.5, y: 0.25, face: 'S' });
    const withTv = viewLines(room, program({ sofa: 'Sofa, Leinen', board: 'TV-Lowboard 180' }), layoutOf('r', [sofa, coffee, tv]));
    expect(withTv).toEqual([expect.stringMatching(/^- Sofa \(sofa\), Front nach Norden, schaut auf TV-Lowboard 180 \(board\), 2,6 m entfernt$/)]);
    const bare = viewLines(room, program({ sofa: 'Sofa' }), layoutOf('r', [sofa, coffee]));
    expect(bare[0]).toMatch(/schaut auf die Wand W\d mit Fenster F1/);
  });
});
