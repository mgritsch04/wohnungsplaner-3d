import { describe, expect, it } from 'vitest';
import { TEST_FLATS } from './fixtures/flats';
import { RECORDED } from './fixtures/recorded';
import { analyzeFlat, roomSketch, flatSketch } from './analysis';
import { parseFlatConcept } from './concept/flatConcept';
import { parseRoomProgram, type RoomProgramInput } from './concept/roomProgram';
import { buildComparePrompt, buildVariantPrompt, COMPARE_MARK, layoutKey, pickOf, planFacts, VARIANT_MARK, verdictOf } from './choose';
import { solveRoom } from './solver/solve';

describe('two designs, one choice', () => {
  it('a winner only when both orders agree', () => {
    const a = (b: string) => ({ besser: b });
    expect(verdictOf(a('1'), a('2'))).toBe('first');
    expect(verdictOf(a('2'), a('1'))).toBe('second');
    expect(verdictOf(a('gleich'), a('gleich'))).toBe('same');
    expect(verdictOf(a('1'), a('1'))).toBe('split');
    expect(verdictOf(a('2'), a('gleich'))).toBe('split');
    expect(pickOf(null)).toBe('gleich');
    expect(pickOf({ besser: ' 2 ' })).toBe('2');
  });

  it('builds the second-design prompt from the first and the comparison from the placed rooms', () => {
    const project = TEST_FLATS.B.build();
    const analysis = analyzeFlat(project);
    const rec = RECORDED.B!;
    const flatIn = { project, analysis, sketch: flatSketch({ project, flat: analysis }), wishes: TEST_FLATS.B.wishes };
    const concept = parseFlatConcept(rec.concept, flatIn).value;
    const name = Object.keys(rec.programs)[0];
    const room = analysis.rooms.find((r) => r.name === name)!;
    const base: RoomProgramInput = { project, concept, room, sketch: roomSketch({ project, flat: analysis }, room), wishes: TEST_FLATS.B.wishes };
    const program = parseRoomProgram(rec.programs[name], base).value;
    const variant = buildVariantPrompt(base, program);
    expect(variant).toContain(VARIANT_MARK);
    expect(variant).toContain(`Raum „${name}“`);
    expect(variant).not.toContain('Dein bisheriges Programm');
    const layout = solveRoom(room, program, { seed: 1 });
    const facts = planFacts(room, { layout, program });
    expect(facts).toMatch(/^Raum \d+ × \d+ cm/);
    expect(facts.split('\n').filter((l) => l.includes('belegt x'))).toHaveLength(layout.items.length);
    const compare = buildComparePrompt(room, 'living', [facts, facts]);
    expect(compare).toContain(COMPARE_MARK);
    expect(compare).toContain('"besser"');
    expect(layoutKey({ layout })).toBe(layoutKey({ layout: structuredClone(layout) }));
  });
});
