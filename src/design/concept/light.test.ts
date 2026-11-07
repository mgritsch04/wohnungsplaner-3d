import { describe, expect, it } from 'vitest';
import type { RoomProgram } from '../types';
import { completeLight } from './light';

const prog = (items: RoomProgram['items'], relations: RoomProgram['relations'] = []): RoomProgram => ({ roomId: 'r', reading: '', zones: [{ id: 'z', function: 'Wohnen', rect: { x0: 0, y0: 0, x1: 5, y1: 4 }, why: '' }], items, relations, walk: '', check: [] });
const sofa = { id: 'sofa', catalogId: 'generic-sofa-3', zone: 'z', label: 'Sofa', why: '' };
const lamp = { id: 'lampe', catalogId: 'generic-floor-lamp', zone: 'z', label: 'Stehlampe', why: '' };
const board = { id: 'board', catalogId: 'generic-sideboard', zone: 'z', label: 'Sideboard', why: '' };

describe('Stimmungslicht (L8)', () => {
  it('puts a table lamp on a free sideboard of a larger living room', () => {
    const { program, notes } = completeLight(prog([sofa, lamp, board], [{ kind: 'left-of', item: 'lampe', target: 'sofa', gap: 0.05 }]), 'living', 20);
    const added = program.items.find((i) => i.id === 'board_stimmung');
    expect(added?.catalogId).toBe('generic-table-lamp');
    expect(program.relations).toContainEqual({ kind: 'on', item: 'board_stimmung', target: 'board' });
    expect(notes.join(' ')).toMatch(/Stimmungslicht/);
  });
  it('adds nothing in a small room, without a surface or when a mood light is planned', () => {
    expect(completeLight(prog([sofa, board]), 'living', 12).program.items).toHaveLength(2);
    expect(completeLight(prog([sofa, lamp], [{ kind: 'left-of', item: 'lampe', target: 'sofa', gap: 0.05 }]), 'living', 20).program.items).toHaveLength(2);
    // a lamp Claude placed on its own (in a corner) is the mood light already
    expect(completeLight(prog([sofa, lamp, board]), 'living', 20).program.items).toHaveLength(3);
  });
});
