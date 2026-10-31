/**
 * What a designer notes about a room before placing anything (mgritsch04/wohnungsplaner-3d#436),
 * as lines for the room programme prompt: the daylight of each window by the direction it faces,
 * the walls one would rather not sleep or work against (bath, WC, kitchen, outside the flat
 * without a window: staircase or neighbours), and how much of the floor a good room furnishes.
 */
import type { Project } from '../../model/schema';
import { sideOfVector } from '../coords';
import type { FlatConcept, RoomAnalysis, RoomType, Side } from '../types';
import { roomConceptOf } from './flatConcept';
import type { RuleArea } from '../rulebook';
import { planBearing } from '../../model/daylight';
import { roomSun, roomSunLabel } from '../../model/sunPath';
import { isCooking, isDining, isSleeping } from './needs';

const DAYLIGHT: Record<Side, string> = {
  N: 'Nordfenster: gleichmäßiges, blendfreies Licht ohne direkte Sonne – gut zum Arbeiten und Lesen, der Raum wirkt eher kühl (warme Farben, warmweißes Licht)',
  O: 'Ostfenster: Morgensonne – gut zum Aufwachen und Frühstücken, abends schattig',
  S: 'Südfenster: Sonne über den Tag, im Sommer warm – gut zum Sitzen, Essen und für Pflanzen; Bildschirme nicht gegenüber',
  W: 'Westfenster: Nachmittags- und Abendsonne – gut zum Wohnen am Abend; tief stehende Sonne blendet auf Bildschirmen',
};

/** Direction a window looks out to: away from the room, the reverse of its wall's inward normal. */
function outward(room: RoomAnalysis, wallId: string): Side | null {
  const w = room.walls.find((x) => x.id === wallId);
  return w ? sideOfVector({ x: -w.inward.x, y: -w.inward.y }, 46) : null;
}

const NOISY: RoomType[] = ['bath', 'kitchen', 'utility'];

/** Room facts as prompt lines. */
export function roomFacts(room: RoomAnalysis, project: Project, concept: FlatConcept): string {
  const lines: string[] = [];
  for (const w of room.walls) {
    for (const o of w.openings) {
      if (o.kind !== 'window') continue;
      const side = outward(room, w.id);
      lines.push(`- ${o.id} (${w.id}): ${side ? DAYLIGHT[side] : 'schräg gestellt, Licht je nach Tageszeit'}.`);
    }
  }
  const bearings = room.walls.flatMap((w) =>
    w.openings.filter((o) => o.kind === 'window').map(() => planBearing({ x: -w.inward.x, y: -w.inward.y }, project.settings.northDirection)),
  );
  if (bearings.length) {
    lines.push(`- Direkte Sonne im Raum: Sommer ${roomSunLabel(roomSun(bearings, 'summer'))}; Winter ${roomSunLabel(roomSun(bearings, 'winter'))}. Sonnige Ecken für Sitzplatz, Essen und Pflanzen; Bildschirme und Bett nicht in die tiefe Sonne.`);
  }
  if (!lines.length) lines.push('- Kein Fenster: der Raum lebt vom Kunstlicht, hell und gleichmäßig beleuchten.');
  const typeOf = (id: string) => roomConceptOf(concept, { roomId: id, name: project.rooms.find((r) => r.id === id)?.name ?? '' }).type;
  const nameOf = (id: string) => project.rooms.find((r) => r.id === id)?.name ?? id;
  const loud = room.walls.flatMap((w) => {
    const why = [
      ...w.behind.filter((b): b is string => !!b && NOISY.includes(typeOf(b))).map((b) => `„${nameOf(b)}“ dahinter`),
      ...(w.behind.includes(null) && !w.openings.some((o) => o.kind === 'window') ? ['außerhalb der Wohnung ohne Fenster (Stiegenhaus oder Nachbarn möglich)'] : []),
    ];
    return why.length ? [`${w.id} (${[...new Set(why)].join(', ')})`] : [];
  });
  if (loud.length) lines.push(`- Laute oder kalte Wände, nicht ans Kopfteil eines Bettes und nicht hinter einen Arbeitsplatz, wenn es eine bessere Wand gibt (S1): ${loud.join('; ')}.`);
  const quiet = room.walls.filter((w) => w.behind.every((b) => b && !NOISY.includes(typeOf(b))) && w.free.reduce((s, f) => s + f.t1 - f.t0, 0) >= 1.6).map((w) => w.id);
  if (quiet.length) lines.push(`- Ruhige Wände mit genug freier Fläche (über 1,6 m): ${quiet.join(', ')}.`);
  lines.push(`- Fläche ${room.area.toFixed(1).replace('.', ',')} m²: gut möbliert sind etwa ${Math.round(room.area * 0.25)}–${Math.round(room.area * 0.4)} m² Stellfläche (ohne Teppiche, R5); die Mitte bleibt frei, wo ein Weg läuft, sonst gehört sie einer Gruppe (R4).`);
  return lines.join('\n');
}

/** Rule areas the functions of a room bring beside its type (a living room with a bed: the sleeping rules). */
export function extraAreas(functions: readonly string[]): RuleArea[] {
  const out = new Set<RuleArea>();
  for (const f of functions) {
    if (isSleeping(f)) out.add('sleeping');
    if (isDining(f)) out.add('dining');
    if (isCooking(f)) out.add('kitchen');
    if (/arbeit|pc|büro|schreib|home.?office|lernen/i.test(f)) out.add('work');
    if (/kind|spiel/i.test(f)) out.add('kids');
    if (/sitz|fernseh|wohn|lesen|gäste/i.test(f)) out.add('living');
  }
  return [...out];
}
