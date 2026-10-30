import { describe, expect, it } from 'vitest';
import { RECORDED } from '../fixtures/recorded';
import { parseFlatConcept } from './flatConcept';
import { extraAreas, roomFacts } from './roomFacts';
import { testFlatInput } from './testFlats';

describe('room facts', () => {
  const f = testFlatInput('B');
  const concept = parseFlatConcept(RECORDED.B!.concept, f).value;
  const room = f.analysis.rooms.find((r) => r.name === 'Wohnküche')!;

  it('names the daylight of each window, the loud walls and the area to furnish', () => {
    const t = roomFacts(room, f.project, concept);
    expect(t).toMatch(/F1 \(W\d\): (Nord|Ost|Süd|West)fenster/);
    expect(t).toContain('„Bad“ dahinter');
    expect(t).toMatch(/Fläche \d+,\d m²: gut möbliert sind etwa \d+–\d+ m²/);
  });

  it('adds the rule areas of the functions beside the room type', () => {
    expect(extraAreas(['Schlafen, Kleidung', 'Essen zu zweit', 'Arbeiten/PC'])).toEqual(['sleeping', 'dining', 'work']);
  });
});
