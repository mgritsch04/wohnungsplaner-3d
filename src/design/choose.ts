/**
 * Two designs, one choice (mgritsch04/wohnungsplaner-3d#436): an interior designer sketches more
 * than one arrangement before deciding. For a main room Claude writes a second, fundamentally
 * different room programme after the first; both are placed and walked through, and Claude
 * compares the two in pictures – the same pair comparison the independent image review uses
 * (`scripts/design-image-review.mjs --vergleich`), asked in both orders, a winner only when both
 * answers agree. The same comparison decides whether the look before handing over is kept.
 *
 * Pure logic: prompts, parsing and the decision. Claude and the pictures come from the caller.
 */
import { programAsAnswer, LOOK_CHECKS } from './critique';
import { buildRoomProgramPrompt, type RoomProgramInput } from './concept/roomProgram';
import { rulebookPrompt } from './rulebook';
import type { RoomAnalysis, RoomProgram, RoomResult, RoomType } from './types';

/** Marks the prompt of the second design (the benchmark tells the requests apart by it). */
export const VARIANT_MARK = 'Zweiter Entwurf:';
/** Marks the prompt of the pair comparison. */
export const COMPARE_MARK = 'vergleichst zwei Einrichtungsvorschläge';

/** The prompt for the second design: the room programme prompt, the first design, and the ask for another arrangement. */
export function buildVariantPrompt(base: RoomProgramInput, first: RoomProgram): string {
  return `${buildRoomProgramPrompt(base)}

────────────────────────────────────────
${VARIANT_MARK} Eine Innenarchitektin skizziert für einen Raum immer mindestens zwei grundverschiedene Anordnungen und wählt dann die bessere. Unten steht dein erster Entwurf. Entwirf jetzt den zweiten:
- eine wirklich andere Grundanordnung, keine kleine Verschiebung: zum Beispiel die Hauptgruppe (Sofa, Bett, Esstisch, Schreibtisch) an einer anderen Wand oder frei im Raum, die Zonen anders geschnitten oder getauscht, der Blickpunkt an einer anderen Wand;
- er erfüllt alle Bedürfnisse und Pflichtteile genauso, mit denselben Regeln;
- nutze die Schwächen des ersten Entwurfs als Anlass: eine leere Raumhälfte, eine Gruppe, die nicht geschlossen ist, ein Sessel ohne Bezug, fehlendes Licht oder Stauraum, Möbel vor dem Fenster.
Lassen Türen, Fenster, Küche oder Bestand wirklich nur eine sinnvolle Anordnung zu, behalte sie und verbessere den ersten Entwurf genau an diesen Schwächen.

Dein erster Entwurf:
${programAsAnswer(first, base.room.origin)}

Antworte mit dem vollständigen zweiten Programm im selben JSON-Format (alle Zonen, alle Teile, alle Beziehungen).`;
}

const MAIN: Partial<Record<RoomType, string>> = { living: 'Wohnzimmer', bedroom: 'Schlafzimmer', kitchen: 'Küche', dining: 'Esszimmer', kids: 'Kinderzimmer', office: 'Arbeitszimmer' };
const SIDES = ['O', 'SO', 'S', 'SW', 'W', 'NW', 'N', 'NO'];
/** Which way a piece faces: rotation r looks along (−sin r, cos r), y grows to the south. */
const facing = (r: number) => SIDES[(Math.round(Math.atan2(Math.cos(r), -Math.sin(r)) / (Math.PI / 4)) + 16) % 8];
const cm = (m: number) => Math.round(m * 100);

/** The plan in numbers, as the image review gets it: doors, windows, every piece with size, place and facing (cm from the north-west corner). */
export function planFacts(a: RoomAnalysis, room: Pick<RoomResult, 'layout' | 'program'>): string {
  const at = (p: { x: number; y: number }) => `${cm(p.x - a.origin.x)},${cm(p.y - a.origin.y)}`;
  const openings = a.walls.flatMap((w) =>
    w.openings.map((o) => {
      const p = (t: number) => ({ x: w.a.x + w.dir.x * t, y: w.a.y + w.dir.y * t });
      return `- ${o.kind === 'window' ? 'Fenster' : 'Tür'} ${o.id} in der ${w.side ?? w.id}-Wand von (${at(p(o.t0))}) bis (${at(p(o.t1))})`;
    }),
  );
  const labels = new Map(room.program.items.map((i) => [i.id, (i.label ?? '').split(',')[0]]));
  const pieces = room.layout.items.map((i) => {
    const name = labels.get(i.id) || i.catalogId.replace('generic-', '');
    const up = i.elevation > 0.05 ? `, ${cm(i.elevation)} cm über dem Boden` : '';
    const ex = (Math.abs(Math.cos(i.rotation)) * i.width + Math.abs(Math.sin(i.rotation)) * i.depth) / 2;
    const ey = (Math.abs(Math.sin(i.rotation)) * i.width + Math.abs(Math.cos(i.rotation)) * i.depth) / 2;
    const x = i.x - a.origin.x;
    const y = i.y - a.origin.y;
    return `- ${name}: ${cm(i.width)} × ${cm(i.depth)} cm, belegt x ${cm(x - ex)}–${cm(x + ex)}, y ${cm(y - ey)}–${cm(y + ey)}, Front nach ${facing(i.rotation)}${up}`;
  });
  return [`Raum ${cm(a.size.x)} × ${cm(a.size.y)} cm (x nach Osten, y nach Süden, ab der Nordwest-Ecke).`, ...openings, 'Möbel:', ...pieces].join('\n');
}

const PLACEHOLDER = 'Die Möbel sind einfache Platzhalter-Modelle ohne Kissen, Plaids, Bettwäsche, Deko und Stoffstruktur. Bewerte Anordnung, Auswahl, Größe, Menge und die Farben der Möbel, nicht was Platzhalter nicht zeigen können.';
const VIEWS = 'Der erste Blick zeigt den Raum schräg von oben, so wie man ihn beim Hereinkommen sieht, waagrecht in 1,20 m Höhe aufgeschnitten: Alles darüber fehlt dort (Hängeleuchten, Oberschränke, Vorhänge, Bilder, obere Teile hoher Möbel). Der zweite zeigt denselben Raum ungeschnitten fast senkrecht von oben, mit allem, was hängt. Urteile über Licht, Oberschränke und hohe Möbel nach dem Blick von oben. Andere Räume am Bildrand gehören nicht dazu.';

/** The pair comparison for one room: plan 1 in pictures 1–2, plan 2 in pictures 3–4. */
export function buildComparePrompt(a: RoomAnalysis, type: RoomType, facts: [string, string]): string {
  return `Du bist eine erfahrene Innenarchitektin und ${COMPARE_MARK} für denselben Raum.

Raum: „${a.name}“, ${MAIN[type] ?? type}, ${a.area.toFixed(1).replace('.', ',')} m².
Bild 1 und 2 zeigen Plan 1, Bild 3 und 4 zeigen Plan 2, jeweils zuerst den Blick beim Hereinkommen und dann den Blick von oben. ${VIEWS}
${PLACEHOLDER}

Plan 1 in Zahlen:
${facts[0]}

Plan 2 in Zahlen:
${facts[1]}

Regeln (Kennung):
${rulebookPrompt(type)}

Vergleiche die beiden Pläne in jedem Punkt der Checkliste und als Ganzes: Welchen würdest du so abgeben, in welchem lebt man besser? Wenn beide praktisch gleich sind, sag „gleich“.
${LOOK_CHECKS.map(([id, text]) => `- ${id}: ${text}`).join('\n')}

Antworte nur mit JSON in dieser Form:
{"besser":"1|2|gleich","abstand":"knapp|deutlich","warum":"…"}`;
}

export type Verdict = 'first' | 'second' | 'same' | 'split';

/** „1“, „2“ or „gleich“ from an answer; anything else counts as „gleich“. */
export function pickOf(raw: unknown): '1' | '2' | 'gleich' {
  const b = String((raw as { besser?: unknown } | null)?.besser ?? '').trim();
  return b === '1' || b === '2' ? b : 'gleich';
}

/**
 * Both orders together: `ab` asked with the first plan as plan 1, `ba` with the second as plan 1.
 * A winner only when both answers agree; „split“ when they disagree (the order decided).
 */
export function verdictOf(ab: unknown, ba: unknown): Verdict {
  const x = pickOf(ab);
  const y = ({ '1': '2', '2': '1', gleich: 'gleich' } as const)[pickOf(ba)];
  if (x !== y) return 'split';
  return x === '1' ? 'first' : x === '2' ? 'second' : 'same';
}

/** The placed pieces, rounded to the centimetre: two rooms with the same key look the same. */
export function layoutKey(r: Pick<RoomResult, 'layout'>): string {
  return JSON.stringify(r.layout.items.map((i) => [i.id, i.catalogId, cm(i.x), cm(i.y), cm(i.rotation), cm(i.elevation), cm(i.width), cm(i.depth)]).sort());
}
