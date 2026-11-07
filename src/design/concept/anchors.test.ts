import { describe, expect, it } from 'vitest';
import { analyzeFlat } from '../analysis';
import { FLAT_KEYS, TEST_FLATS } from '../fixtures/flats';
import type { FlatConcept, RoomConcept } from '../types';
import { anchorSizes, roomSlots, slotById, slotSection } from './anchors';

const rc = (type: RoomConcept['type'], functions: string[] = []): RoomConcept => ({ roomId: 'r', type, role: '', functions, anchors: [], avoid: [] });

describe('anchor pieces of a room (#436)', () => {
  it('a living room gets a sofa, a bedroom a bed, an office a desk, a dining room a table', () => {
    expect(anchorSizes(rc('living'), 20, []).map((a) => a.kind)).toEqual(['sofa']);
    expect(anchorSizes(rc('bedroom'), 14, []).map((a) => a.kind)).toEqual(['bed']);
    expect(anchorSizes(rc('office'), 9, []).map((a) => a.kind)).toEqual(['desk']);
    expect(anchorSizes(rc('living', ['Essen für 4', 'Wohnen']), 25, []).map((a) => a.kind)).toEqual(['sofa', 'dining']);
    expect(anchorSizes(rc('bath'), 6, [])).toEqual([]);
  });

  it('size follows the room: smaller sofa and bed in a small room, single bed in the kids room', () => {
    expect(anchorSizes(rc('living'), 12, [])[0].width).toBeLessThan(anchorSizes(rc('living'), 20, [])[0].width);
    expect(anchorSizes(rc('bedroom'), 8, [])[0].width).toBeLessThan(anchorSizes(rc('bedroom'), 14, [])[0].width);
    expect(anchorSizes(rc('kids'), 12, [])[0].width).toBeLessThan(1);
  });
});

describe.each(FLAT_KEYS)('places in the prompt, test flat %s', (key) => {
  it('every room with an anchor piece has ids that can be found again', () => {
    const project = TEST_FLATS[key].build();
    const flat = analyzeFlat(project);
    const concept = { living: '', style: { idea: '', materials: [], forms: '', palette: [] }, functions: [], rooms: flat.rooms.map((r) => ({ roomId: r.roomId, type: r.typeFromName, role: '', functions: r.typeFromName === 'living' ? ['Essen', 'Wohnen'] : [], anchors: [], avoid: [] })) } as unknown as FlatConcept;
    for (const r of flat.rooms) {
      const slots = roomSlots(project, concept, r);
      const text = slotSection(slots);
      for (const a of slots.anchors) for (const s of a.slots) expect(slotById(slots, s.id.toLowerCase())).toBe(s);
      if (slots.anchors.length) expect(text).toContain('"slot"');
      else expect(text).toBe('');
    }
  });
});
