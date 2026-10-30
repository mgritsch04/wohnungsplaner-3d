/**
 * Stage 5 (#442): Claude looks at its own room, placed and walked through, and improves the
 * programme. It sees the picture of the room from above (or a text map where this Claude cannot
 * look at pictures), the findings of the walk-through and what found no place. The answer is a
 * whole room programme again, in the same form as stage 2, so the same check and the same
 * placement run on it. No coordinates are patched by hand: Claude moves zones, changes
 * relations, swaps, drops or adds pieces, and stage 3 places everything anew.
 */
import { FLANK_GAP } from './concept/groups';
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
  /**
   * Number of 3D pictures sent before the plan (the look, #443): from the main door, cut at 1.20 m,
   * and from above.
   */
  views?: number;
}

/** Claude's own mark (1–10, as the image review gives it) from which the room is handed over. */
export const LOOK_ENOUGH = 8;

/** The image review's checklist (`scripts/design-image-review.mjs`): the look rates the room by it. */
export const LOOK_CHECKS: readonly [string, string][] = [
  ['wege', 'Wege frei: Man kommt von der Tür überall hin, Türen und Fenster bleiben frei, nichts versperrt den Durchgang.'],
  ['funktionen', 'Funktionen erkennbar: Man sieht sofort, wo man schläft, sitzt, isst, kocht oder arbeitet; jede Zone ist vollständig.'],
  ['blickfang', 'Blickfang: Es gibt einen klaren Mittelpunkt (Sofa mit Teppich, Bett mit Kopfteil, Esstisch mit Leuchte), auf den der Raum ausgerichtet ist.'],
  ['proportionen', 'Proportionen: Die Möbel passen in Größe und Menge zum Raum, weder leer noch vollgestellt; Abstände wirken bewusst.'],
  ['licht', 'Licht: Grundlicht und Leselicht oder Arbeitslicht sind da, wo man sie braucht; Fenster werden genutzt, nicht zugestellt.'],
  ['ordnung', 'Ordnung: Möbel stehen gerade an Wänden oder bewusst frei, Gruppen sind geschlossen, nichts steht zufällig herum.'],
  ['abgabe', '„Würde eine Innenarchitektin das so abgeben?“ – als Ganzes stimmig, wohnlich und durchdacht.'],
];

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
      case 'flank':
        return [r.item, 'flank', r.target, cm(r.gap ?? FLANK_GAP), ...(r.side ? [r.side] : [])];
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
  const picture = input.image && input.views
    ? `Sieh dir die beigefügten Bilder an. ${input.views > 1 ? 'Bild 1 zeigt den Raum in 3D schräg von oben, so wie man ihn beim Hereinkommen sieht, waagrecht in 1,20 m Höhe aufgeschnitten (alles darüber fehlt dort: Hängeleuchten, Oberschränke, Vorhänge, Bilder, obere Teile hoher Möbel). Bild 2 zeigt ihn in 3D ungeschnitten fast senkrecht von oben. Bild 3' : 'Bild 1 zeigt den Raum in 3D, so wie man ihn beim Hereinkommen sieht. Bild 2'} ist der Plan von oben, mit Möbeln, Zonen (gestrichelt) und Wegen; Norden ist oben. Die Möbel sind einfache Platzhalter-Modelle.`
    : input.image
    ? 'Sieh dir das beigefügte Bild an: der Raum von oben, mit Möbeln, Zonen (gestrichelt) und Wegen. Norden ist oben.'
    : input.textMap
      ? `So steht es im Raum:\n${input.textMap}`
      : 'Ein Bild gibt es nicht; geh nach den Angaben unten.';
  const task = input.look
    ? `Blick vor der Abgabe: Die Begehung ist bestanden. Sieh dir den Raum jetzt an wie eine Innenarchitektin, bevor sie ihn abgibt. Eine unabhängige Prüferin bewertet später genau diese Bilder mit 1 bis 10 nach dieser Liste:
${LOOK_CHECKS.map(([id, text]) => `- ${id}: ${text}`).join('\n')}
Bewerte den Raum so, wie er jetzt ist, ehrlich mit einer Gesamtnote 1–10 ("note") und nenne die drei wichtigsten Mängel ("maengel"), so wie die Prüferin sie sähe. Häufig bemängelt sie: leere Flächen oder eine leere Raumhälfte, während anderswo alles dicht steht; ein Sessel, der abseits steht oder nicht zur Gruppe schaut; ein Teppich ohne Möbel darauf; eine Sitzecke ohne Ablage und ohne Leselicht; ein Sofa ohne Gegenüber; Möbel vor dem Fenster; eine Küche ohne durchgehende Arbeitsfläche.
Behebe dann diese Mängel im Programm: ergänze, was fehlt, verschiebe Zonen in leere Bereiche, lass Überflüssiges weg, ohne Wege, Türen oder Funktionen zu verschlechtern. Sag in "why" des geänderten Teils kurz, warum. Ist die Note schon ${LOOK_ENOUGH} oder mehr, gib das Programm unverändert zurück.`
    : `Ändere nur, was die Befunde verlangen, und sag in "why" des geänderten Teils kurz, warum. Was gut ist, bleibt wie es ist: dieselben ids, dieselben Plätze.
Passt ein Möbel nur kleiner hinein, steht etwas weit außerhalb seiner Zone oder sind Abstände zu knapp, ist der Raum für dein Programm zu voll. Verschieben allein hilft dann nicht: Plane das kleinere Teil gleich selbst ein, nimm weniger Plätze am Tisch oder ordne die Gruppe anders an (das Sofa an eine andere Wand, die Medienwand dorthin, wo der Weg nicht vorbeiführt).`;
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

Antworte wieder mit dem vollständigen Programm im selben JSON-Format (alle Zonen, alle Teile, alle Beziehungen)${input.look ? ', dazu "note" (deine Note 1–10 für den Raum, wie er jetzt ist) und "maengel" (die drei Mängel)' : ''}.`;
}

export const parseCritique = (raw: unknown, input: CritiqueInput): Checked<RoomProgram> => parseRoomProgram(raw, input.base);
