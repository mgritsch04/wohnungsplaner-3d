import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { applyFurnishing, suggestFurnishing } from '../suggest/furnishing';
import { applyMoves, buildCritiqueInput, buildCritiquePrompt, moveProblem, parseCritique, previewGhosts } from './critique';

function flat() {
  const p = createEmptyProject();
  p.name = 'Wohnung Mustermann, Beispielstraße 1';
  addRectRoom(p, { x: 0, y: 0, width: 5, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 5, y: 0, width: 3, depth: 4, name: 'Schlafzimmer', thickness: 0.12, height: 2.6 });
  const [living, bed] = p.rooms;
  const s = suggestFurnishing(p, [
    { roomId: living.id, type: 'living', wishes: [{ catalogId: 'generic-sofa-3', quantity: 1 }] },
    { roomId: bed.id, type: 'bedroom', wishes: [{ catalogId: 'generic-bed-160', quantity: 1 }] },
  ]);
  applyFurnishing(p, s);
  return p;
}

describe('Raumkritik mit Claude (#365)', () => {
  it('Prompt: Raum, Möbel mit Schlüsseln, Check-Ergebnis, keine persönlichen Angaben', () => {
    const p = flat();
    const input = buildCritiqueInput(p, null);
    const prompt = buildCritiquePrompt(input);
    expect(Object.keys(input.furnitureKeys)).toEqual(['M1', 'M2']);
    expect(prompt).toContain('„Wohnzimmer“');
    expect(prompt).toContain('M1:');
    expect(prompt).toContain('Wohnungs-Checks');
    expect(prompt).toContain('3 bis 5');
    expect(prompt).not.toContain('Mustermann');
    expect(prompt).not.toContain('https://');
  });

  it('Umfang einzelner Raum: nur dessen Möbel', () => {
    const p = flat();
    const input = buildCritiqueInput(p, p.rooms[0].id);
    expect(Object.keys(input.furnitureKeys)).toEqual(['M1']);
    expect(input.text).not.toContain('Schlafzimmer');
  });

  it('Antwort: gültige Umstellung wird übernommen, Undo-fähig anwendbar, Vorschau zeigt Geister', () => {
    const p = flat();
    const input = buildCritiqueInput(p, null);
    const f = p.furniture.find((x) => x.id === input.furnitureKeys.M1)!;
    const c = parseCritique({ summary: 'Sofa besser stellen.', suggestions: [{ title: 'Sofa in die Mitte', reason: 'Mehr Platz an der Wand.', moves: [{ item: 'M1', x: 2.5, y: 2, rotation: 90 }] }] }, input, p);
    expect(c.suggestions).toHaveLength(1);
    expect(c.suggestions[0].moves[0].to).toMatchObject({ x: 2.5, y: 2 });
    expect(c.suggestions[0].moves[0].to.rotation).toBeCloseTo(Math.PI / 2);
    const ghosts = previewGhosts(p, c.suggestions[0].moves);
    expect(ghosts[0]).toMatchObject({ x: 2.5, y: 2 });
    expect(p.furniture.find((x) => x.id === f.id)).toMatchObject({ x: f.x, y: f.y });
    const q = structuredClone(p);
    expect(moveProblem(q, c.suggestions[0].moves)).toBeNull();
    applyMoves(q, c.suggestions[0].moves);
    expect(q.furniture.find((x) => x.id === f.id)).toMatchObject({ x: 2.5, y: 2 });
  });

  it('verwirft Unbrauchbares: unbekanntes Möbel, Position in der Wand oder außerhalb, kein Effekt', () => {
    const p = flat();
    const input = buildCritiqueInput(p, null);
    const raw = {
      suggestions: [
        { title: 'a', moves: [{ item: 'M9', x: 2, y: 2 }] },
        { title: 'b', moves: [{ item: 'M1', x: 0, y: 0 }] },
        { title: 'c', moves: [{ item: 'M1', x: 40, y: 40 }] },
        { title: 'd', moves: [{ item: 'M1', x: 'x', y: 1 }] },
        { title: 'e', moves: [] },
        { title: 'ok', reason: 'passt', moves: [{ item: 'M2', x: 6.5, y: 2 }] },
      ],
    };
    const c = parseCritique(raw, input, p);
    expect(c.suggestions.map((s) => s.title)).toEqual(['ok']);
    expect(c.dropped).toBe(5);
    expect(() => parseCritique({ suggestions: [] }, input, p)).toThrow();
    expect(() => parseCritique('nope', input, p)).toThrow();
  });

  it('begrenzt auf 5 Vorschläge und 4 Möbel je Vorschlag', () => {
    const p = flat();
    const input = buildCritiqueInput(p, null);
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `v${i}`, moves: [{ item: 'M2', x: 6.5, y: 2 + i * 0.03 }] }));
    expect(parseCritique({ suggestions: many }, input, p).suggestions).toHaveLength(5);
  });

  it('Vorschlag wird ungültig, wenn das Möbel inzwischen bewegt wurde', () => {
    const p = flat();
    const input = buildCritiqueInput(p, null);
    const c = parseCritique({ suggestions: [{ title: 't', moves: [{ item: 'M2', x: 6.5, y: 2 }] }] }, input, p);
    p.furniture.find((x) => x.id === input.furnitureKeys.M2)!.x += 0.5;
    derivePlan(p);
    expect(moveProblem(p, c.suggestions[0].moves)).toMatch(/verschoben/);
  });
});
