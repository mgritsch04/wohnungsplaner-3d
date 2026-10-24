/**
 * Stage 5 (#442): Claude looks at its own room, placed and walked through, and improves the
 * programme. It sees the picture of the room from above (or a text map where this Claude cannot
 * look at pictures), the findings of the walk-through and what found no place. The answer is a
 * whole room programme again, in the same form as stage 2, so the same check and the same
 * placement run on it. No coordinates are patched by hand: Claude moves zones, changes
 * relations, swaps, drops or adds pieces, and stage 3 places everything anew.
 */
import type { SampleImage } from '../assistant/claude';
import { sideOfRotation, toRoomCm } from './coords';
import { buildRoomProgramPrompt, parseRoomProgram, type RoomProgramInput } from './concept/roomProgram';
import type { Checked } from './concept/common';
import type { Finding, Layout, RoomProgram, RoomReview } from './types';

export interface CritiqueInput {
  /** The same input stage 2 had: concept, room, sketch, wishes, products. */
  base: RoomProgramInput;
  program: RoomProgram;
  layout: Layout;
  review: RoomReview;
  /** Picture of the placed room; without one the text map goes into the prompt. */
  image?: SampleImage;
  /** Text map of the placed room (stage 0 sketch plus what stands where). */
  textMap?: string;
  /** Round number (1 or 2), only for the wording. */
  round: number;
  /**
   * The look before handing over (#443): the room already passes the walk-through, Claude looks at
   * the picture once more as an interior designer and improves what the rules do not see.
   */
  look?: boolean;
}

const cm = (v: number) => Math.round(v * 100);
const SEVERITY: Record<Finding['severity'], string> = { S: 'schwer', M: 'mittel', L: 'leicht' };

/** The programme in the form Claude wrote it, so it can change its own answer. */
export function programAsAnswer(program: RoomProgram, origin: { x: number; y: number }): string {
  const p = (x: number, y: number) => toRoomCm(origin, { x, y });
  const item = (i: RoomProgram['items'][number]) => {
    const at = i.hint ? p(i.hint.x, i.hint.y) : null;
    return {
      id: i.id,
      catalogId: i.catalogId,
      zone: i.zone,
      ...(at ? { x: at.x, y: at.y, facing: sideOfRotation(i.hint!.rotation) } : {}),
      ...(i.label ? { label: i.label } : {}),
      ...(i.color ? { color: i.color } : {}),
      why: i.why,
      ...(i.required ? { anchor: true } : {}),
      ...(i.fallbacks?.length ? { fallbacks: i.fallbacks } : {}),
    };
  };
  const zone = (z: RoomProgram['zones'][number]) => {
    const a = p(z.rect.x0, z.rect.y0);
    const b = p(z.rect.x1, z.rect.y1);
    return { id: z.id, function: z.function, rect: [a.x, a.y, b.x, b.y], why: z.why, ...(z.userZone ? { userZone: z.userZone } : {}) };
  };
  const rel = (r: RoomProgram['relations'][number]): unknown[] => {
    switch (r.kind) {
      case 'wall':
        return [r.item, 'wall', r.wall];
      case 'corner':
        return [r.item, 'corner', ...r.walls];
      case 'center':
        return [r.item, 'center'];
      case 'pair':
        return [r.item, 'pair', r.item2, r.target];
      case 'around':
        return [r.items.join('+'), 'around', r.target];
      case 'above':
        return [r.item, 'above', r.target, ...(r.height === undefined ? [] : [cm(r.height)])];
      case 'facing':
        return [r.item, 'facing', r.target, ...(r.distance === undefined ? [] : [cm(r.distance)])];
      case 'window':
        return [r.item, 'window', r.window, ...(r.place ? [r.place] : [])];
      case 'near':
        return [r.item, 'near', r.target, ...(r.max === undefined ? [] : [cm(r.max)])];
      case 'away':
        return [r.item, 'away', r.target, ...(r.min === undefined ? [] : [cm(r.min)])];
      case 'align':
        return [r.items.join('+'), 'align'];
      case 'front-of':
      case 'left-of':
      case 'right-of':
        return [r.item, r.kind, r.target, ...(r.gap === undefined ? [] : [cm(r.gap)])];
      default:
        return [r.item, r.kind, r.target];
    }
  };
  const kitchen = program.kitchen?.map((k) => ({ wall: k.wall, from: [p(k.from.x, k.from.y).x, p(k.from.x, k.from.y).y], to: [p(k.to.x, k.to.y).x, p(k.to.x, k.to.y).y], modules: k.modules }));
  return JSON.stringify({
    reading: program.reading,
    zones: program.zones.map(zone),
    items: program.items.map(item),
    relations: program.relations.map(rel),
    ...(kitchen?.length ? { kitchen } : {}),
    walk: program.walk,
  });
}

/** What the walk-through and the placement found, as Claude reads it. */
export function critiqueReport(program: RoomProgram, layout: Layout, review: RoomReview): string {
  const hintOf = (id: string) => program.items.find((p) => p.id === id)?.hint;
  const findings = review.findings.map((f) => `- ${SEVERITY[f.severity]}: ${f.text}${f.items.length ? ` (${f.items.join(', ')})` : ''}`);
  const dropped = layout.dropped.map((d) => `- ${d.id} (${d.catalogId}) kam nicht hinein: ${d.reason}`);
  const away = (i: Layout['items'][number]) => {
    const h = hintOf(i.id);
    return h ? Math.hypot(i.x - h.x, i.y - h.y) : 0;
  };
  const moved = layout.items.filter((i) => away(i) > 0.6).map((i) => `- ${i.id} steht ${Math.round(away(i) * 100)} cm von deinem Platz entfernt`);
  return [
    `Begehung: ${review.score} von 100 Punkten, ${review.passed ? 'bestanden' : 'nicht bestanden'}.`,
    findings.length ? `Befunde:\n${findings.join('\n')}` : 'Keine Befunde.',
    dropped.length ? `Nicht aufgestellt:\n${dropped.join('\n')}` : '',
    moved.length ? `Weit von deinem Platz entfernt aufgestellt:\n${moved.join('\n')}` : '',
    `Belegung ${Math.round(review.metrics.occupancy * 100)} % der Fläche.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildCritiquePrompt(input: CritiqueInput): string {
  const { base, program, layout, review } = input;
  const origin = base.room.origin;
  const picture = input.image
    ? 'Sieh dir das beigefügte Bild an: der Raum von oben, mit Möbeln, Zonen (gestrichelt) und Wegen. Norden ist oben.'
    : input.textMap
      ? `So steht es im Raum:\n${input.textMap}`
      : 'Ein Bild gibt es nicht; geh nach den Angaben unten.';
  const task = input.look
    ? `Blick vor der Abgabe: Die Begehung ist bestanden. Sieh dir den Raum jetzt an wie eine Innenarchitektin, bevor sie ihn abgibt, und verbessere, was eine Regel nicht sieht:
- Die Sitzgruppe schaut auf einen Blickpunkt (Fernseher, Kamin, Fenster mit Ausblick) oder einander zu; Sofa, Sessel und Couchtisch bilden eine geschlossene Gruppe auf einem Teppich, der unter die Vorderbeine reicht.
- Kein Sessel und kein Schrank steht vor einem Fenster; Fenster bleiben frei und bekommen Vorhänge als Paar links und rechts.
- Jeder Sitz- und Arbeitsplatz hat Licht in Reichweite: Leselampe neben Sofa oder Sessel, Pendelleuchte über dem Esstisch, Lampe am Schreibtisch, Leuchten an beiden Bettseiten.
- Stühle stehen am Tisch, der Bürostuhl am Schreibtisch; Teppiche liegen mittig unter ihrer Gruppe.
- Die Zonen sind über den Raum verteilt: keine Ecke leer, während anderswo alles aneinanderklebt; nichts steht verloren mitten im Raum.
Ist das alles schon so, gib das Programm unverändert zurück. Sonst ändere gezielt, ohne Wege, Türen oder Funktionen zu verschlechtern, und sag in "why" des geänderten Teils kurz, warum.`
    : 'Ändere nur, was die Befunde verlangen, und sag in "why" des geänderten Teils kurz, warum. Was gut ist, bleibt wie es ist: dieselben ids, dieselben Plätze.';
  const heading = input.look ? 'Blick vor der Abgabe' : input.round === 1 ? 'Nachbesserung' : 'Zweite Nachbesserung';
  return `${buildRoomProgramPrompt(base)}

────────────────────────────────────────
${heading}: Dein Programm wurde aufgestellt und begangen.

Dein bisheriges Programm:
${programAsAnswer(program, origin)}

${picture}

${critiqueReport(program, layout, review)}

${task}
Typische Mittel: eine Zone verschieben oder kleiner machen, eine Beziehung ändern (anderes Ziel, anderer Abstand), ein Teil gegen ein kleineres tauschen, Überflüssiges weglassen, Fehlendes ergänzen. Ein Teil, das nicht hineinkam, braucht einen anderen Platz oder eine kleinere Größe – oder es gehört nicht in diesen Raum.
Rechne keine Koordinaten fein nach: die App stellt millimetergenau auf. Du gibst die Absicht vor.

Antworte wieder mit dem vollständigen Programm im selben JSON-Format (alle Zonen, alle Teile, alle Beziehungen).`;
}

export const parseCritique = (raw: unknown, input: CritiqueInput): Checked<RoomProgram> => parseRoomProgram(raw, input.base);
