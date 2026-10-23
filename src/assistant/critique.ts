/**
 * Room critique by Claude (#365, stage 2 of #151): Claude gets the findings of the Wohnungs-Check
 * (#357) plus a summary of the room(s) and returns 3–5 concrete rearrangement suggestions, each a
 * reason and a few moves of existing furniture.
 *
 * Claude only proposes target positions; the app checks every suggestion against the real
 * placement rules (walls, door leaves, other furniture) and drops what would collide. Taking a
 * suggestion is one undo step. Only plan geometry and furniture names/sizes go out – no project
 * name, notes, links or prices.
 */
import { z } from 'zod';
import { derivePlan, type DerivedPlan } from '../model/derived';
import { buildPlacementObstacles, issueLevel, placementIssues } from '../model/placement';
import { runPlanCheck, type CheckItem } from '../model/planCheck';
import type { Furniture, Project } from '../model/schema';
import { boundsOf } from '../model/vec';
import { roomIdAt, type RoomType } from '../suggest/furnishing';
import { summarizePlan } from './planSummary';

export const MIN_SUGGESTIONS = 3;
export const MAX_SUGGESTIONS = 5;
export const MAX_MOVES = 4;
/** At most this many pieces of furniture and findings go into one request. */
export const MAX_FURNITURE = 60;
export const MAX_FINDINGS = 30;

const cm = (v: number) => Math.round(v * 100);
const m2 = (v: number) => v.toFixed(2).replace(/\.?0+$/, '');
const deg = (rad: number) => ((Math.round((rad * 180) / Math.PI) % 360) + 360) % 360;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export interface CritiqueInput {
  /** Text for the prompt: rooms, furniture with keys M1…, findings. */
  text: string;
  /** M1 → furniture id */
  furnitureKeys: Record<string, string>;
  /** R1 → room id */
  roomKeys: Record<string, string>;
  /** Room ids the critique covers. */
  roomIds: string[];
}

/** Findings of the Wohnungs-Check that concern the chosen room (all findings for the whole apartment). */
function relevantFindings(project: Project, derived: DerivedPlan, items: CheckItem[], roomIds: Set<string>, all: boolean): CheckItem[] {
  if (all) return items;
  return items.filter((it) => {
    if (it.select?.type === 'room') return roomIds.has(it.select.id);
    const rid = it.at ? roomIdAt(project, derived, it.at) : null;
    return rid !== null && roomIds.has(rid);
  });
}

export function buildCritiqueInput(project: Project, scope: string | null, roomTypes: Record<string, RoomType> = {}): CritiqueInput {
  const derived = derivePlan(project);
  const plan = summarizePlan(project, { roomTypes, focusRoomId: scope });
  const roomIds = scope ? [scope] : project.rooms.map((r) => r.id);
  const inScope = new Set(roomIds);
  const roomKeyOf = new Map(Object.entries(plan.roomKeys).map(([k, id]) => [id, k]));

  const furnitureKeys: Record<string, string> = {};
  const lines: string[] = [];
  let n = 0;
  for (const f of project.furniture) {
    const rid = roomIdAt(project, derived, f);
    if (!rid || !inScope.has(rid) || f.kitchen || n >= MAX_FURNITURE) continue;
    n++;
    const key = `M${n}`;
    furnitureKeys[key] = f.id;
    lines.push(`${key}: ${f.name}${f.quantity > 1 ? ` (${f.quantity}×)` : ''}, ${cm(f.width)}×${cm(f.depth)} cm, in ${roomKeyOf.get(rid)}, Mitte x=${m2(f.x)} y=${m2(f.y)} m, gedreht ${deg(f.rotation)}°`);
  }

  const bounds = roomIds
    .map((id) => {
      const g = derived.rooms.get(id);
      const b = g ? boundsOf(g.interior) : null;
      return b ? `${roomKeyOf.get(id)}: x ${m2(b.minX)}…${m2(b.maxX)} m, y ${m2(b.minY)}…${m2(b.maxY)} m` : null;
    })
    .filter(Boolean);

  const check = runPlanCheck(project, derived);
  const findings = relevantFindings(project, derived, check.items, inScope, scope === null).slice(0, MAX_FINDINGS);
  const findingLines = findings.map((it) => `- [${it.severity === 'error' ? 'Problem' : it.severity === 'warn' ? 'Prüfen' : 'Hinweis'}] ${it.title}${it.detail ? ` ${it.detail}` : ''}`);

  const text = [
    plan.text,
    '',
    'Begrenzung der Räume (Innenmaß, Plan-Koordinaten; y wächst nach unten/Süden):',
    bounds.join('\n') || '(unbekannt)',
    '',
    'Möbel (Schlüssel, Größe, Raum, Lage; Drehung 0° = Vorderseite nach unten, im Uhrzeigersinn):',
    lines.join('\n') || '(keine Möbel)',
    '',
    'Ergebnis des Wohnungs-Checks für diesen Bereich:',
    findingLines.join('\n') || '- keine Auffälligkeiten',
  ].join('\n');
  return { text, furnitureKeys, roomKeys: plan.roomKeys, roomIds };
}

export function buildCritiquePrompt(input: CritiqueInput): string {
  return [
    'Du bist Innenarchitekt für einen Wohnungsplaner und gibst eine ehrliche Raumkritik (Antwort auf Deutsch).',
    `Schlage ${MIN_SUGGESTIONS} bis ${MAX_SUGGESTIONS} konkrete Umstell-Vorschläge vor, die die Probleme des Wohnungs-Checks beheben oder Raumaufteilung, Laufwege, Tageslicht und Nutzbarkeit verbessern. Jeder Vorschlag verschiebt und/oder dreht 1–${MAX_MOVES} vorhandene Möbel.`,
    '',
    input.text,
    '',
    'Regeln:',
    '- Nur Möbel mit Schlüssel (M1, M2 …) aus der Liste; keine neuen Möbel, nichts entfernen.',
    '- "x"/"y" = neue Mitte des Möbels in Metern (Plan-Koordinaten), innerhalb des Raums; "rotation" = neue Drehung in Grad (0–359).',
    '- Möbel dürfen weder Wände, Türflügel, Türaufschlag noch andere Möbel berühren; Wege (mind. 80 cm) und Fenster freihalten.',
    '- Jeder Vorschlag: kurzer Titel (max. 8 Wörter), Begründung (1–2 Sätze, Bezug auf den Check bzw. den Raum).',
    '- Besser wenige gute Vorschläge als viele schwache; sind keine sinnvollen Änderungen nötig, gib weniger Vorschläge zurück und sag es in "summary".',
    '',
    'Antworte nur mit JSON in genau dieser Form:',
    '{"summary":"1–2 Sätze Gesamteindruck","suggestions":[{"title":"…","reason":"…","moves":[{"item":"M1","x":1.5,"y":2.0,"rotation":90}]}]}',
  ].join('\n');
}

export interface CritiqueMove {
  furnitureId: string;
  name: string;
  from: { x: number; y: number; rotation: number };
  to: { x: number; y: number; rotation: number };
}

export interface CritiqueSuggestion {
  id: string;
  title: string;
  reason: string;
  moves: CritiqueMove[];
}

export interface Critique {
  summary: string;
  suggestions: CritiqueSuggestion[];
  /** Suggestions Claude made that were dropped (unknown piece of furniture, outside the room or colliding). */
  dropped: number;
}

const MoveSchema = z.object({ item: z.unknown(), x: z.unknown(), y: z.unknown(), rotation: z.unknown().optional() });
const CritiqueSchema = z.object({
  summary: z.unknown().optional(),
  suggestions: z.array(z.object({ title: z.unknown().optional(), reason: z.unknown().optional(), moves: z.array(MoveSchema).catch([]) })).catch([]),
});

const sameAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.02;

/** True when the move changes nothing noticeable (< 2 cm and < ~1°). */
const isNoop = (mv: CritiqueMove) => Math.hypot(mv.to.x - mv.from.x, mv.to.y - mv.from.y) < 0.02 && sameAngle(mv.to.rotation, mv.from.rotation);

/** Furniture of `project` with the moves applied (a copy; the project stays untouched). */
function withMoves(project: Project, moves: CritiqueMove[]): Project {
  const copy = structuredClone(project);
  for (const mv of moves) {
    const f = copy.furniture.find((x) => x.id === mv.furnitureId);
    if (f) Object.assign(f, mv.to);
  }
  return copy;
}

/** Why the moves cannot be taken in `project` now, or null when they are fine. */
export function moveProblem(project: Project, moves: CritiqueMove[]): string | null {
  for (const mv of moves) {
    const f = project.furniture.find((x) => x.id === mv.furnitureId);
    if (!f) return `„${mv.name}“ gibt es nicht mehr.`;
    if (Math.hypot(f.x - mv.from.x, f.y - mv.from.y) > 0.02 || !sameAngle(f.rotation, mv.from.rotation)) return `„${mv.name}“ wurde seit dem Vorschlag verschoben.`;
  }
  const next = withMoves(project, moves);
  const d = derivePlan(next);
  const obstacles = buildPlacementObstacles(d);
  for (const mv of moves) {
    const f = next.furniture.find((x) => x.id === mv.furnitureId) as Furniture;
    if (roomIdAt(next, d, f) === null) return `„${mv.name}“ läge außerhalb der Räume.`;
    const bad = placementIssues(next, d, f, obstacles).find((i) => issueLevel(i.kind) === 'error');
    if (bad) return `„${mv.name}“ ${bad.short}.`;
  }
  return null;
}

/**
 * Checks Claude's answer: only furniture of the request, positions inside the covered rooms,
 * no collisions (walls, door leaves, other furniture); at most 5 suggestions. Throws when
 * nothing usable is left.
 */
export function parseCritique(raw: unknown, input: CritiqueInput, project: Project): Critique {
  const parsed = CritiqueSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Antwort hat nicht die erwartete Form.');
  const inRooms = new Set(input.roomIds);
  const suggestions: CritiqueSuggestion[] = [];
  let dropped = 0;
  for (const s of parsed.data.suggestions) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const moves: CritiqueMove[] = [];
    let ok = s.moves.length > 0;
    for (const mv of s.moves.slice(0, MAX_MOVES)) {
      const key = typeof mv.item === 'string' ? mv.item.trim().toUpperCase() : '';
      const f = project.furniture.find((x) => x.id === input.furnitureKeys[key]);
      const x = Number(mv.x);
      const y = Number(mv.y);
      if (!f || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1000 || Math.abs(y) > 1000 || moves.some((o) => o.furnitureId === f.id)) {
        ok = false;
        break;
      }
      const rot = mv.rotation === undefined || mv.rotation === null || mv.rotation === '' ? f.rotation : (Number(mv.rotation) * Math.PI) / 180;
      if (!Number.isFinite(rot)) {
        ok = false;
        break;
      }
      moves.push({ furnitureId: f.id, name: f.name, from: { x: f.x, y: f.y, rotation: f.rotation }, to: { x, y, rotation: rot } });
    }
    const real = moves.filter((mv) => !isNoop(mv));
    if (!ok || !real.length) {
      dropped++;
      continue;
    }
    const d = derivePlan(withMoves(project, real));
    const after = withMoves(project, real);
    const stays = real.every((mv) => {
      const f = after.furniture.find((q) => q.id === mv.furnitureId) as Furniture;
      const rid = roomIdAt(after, d, f);
      return rid !== null && inRooms.has(rid);
    });
    if (!stays || moveProblem(project, real)) {
      dropped++;
      continue;
    }
    suggestions.push({ id: `s${suggestions.length + 1}`, title: clip(s.title, 80) || 'Umstellen', reason: clip(s.reason, 400), moves: real });
  }
  if (!suggestions.length) throw new Error('Keine verwertbaren Vorschläge.');
  return { summary: clip(parsed.data.summary, 500), suggestions, dropped };
}

/** Takes the suggestion over (call inside one `apply` → one undo step). Returns the moved ids. */
export function applyMoves(d: Project, moves: CritiqueMove[]): string[] {
  const ids: string[] = [];
  for (const mv of moves) {
    const f = d.furniture.find((x) => x.id === mv.furnitureId);
    if (!f) continue;
    f.x = mv.to.x;
    f.y = mv.to.y;
    f.rotation = mv.to.rotation;
    ids.push(f.id);
  }
  return ids;
}

/** Ghosts of the moved furniture at their new place – drawn like the furnishing preview in 2D and 3D. */
export function previewGhosts(project: Project, moves: CritiqueMove[]): Furniture[] {
  return moves.flatMap((mv) => {
    const f = project.furniture.find((x) => x.id === mv.furnitureId);
    return f ? [{ ...structuredClone(f), id: `critique-${f.id}`, ...mv.to }] : [];
  });
}
