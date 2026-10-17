/**
 * Question → prompt and Claude's answer → checked suggestions (#151).
 *
 * Claude answers with JSON; everything is checked here before the app shows it: unknown rooms
 * are dropped, furniture is only kept when its id is in the offered catalogue (no invented
 * products or prices), quantities are clamped. Furniture suggestions are later placed by the
 * rule-based placement of `src/suggest/` (collision-free), never at positions from Claude.
 */
import { z } from 'zod';
import type { CatalogItem } from '../catalog/types';
import type { WishItem } from '../suggest/furnishing';
import { summarizeCatalog, type PlanSummary } from './planSummary';

export const MAX_SUGGESTIONS = 6;
export const MAX_QUANTITY = 6;
export const MAX_QUESTION = 500;

export interface AssistantSuggestion {
  title: string;
  detail: string;
  /** Project room id, or null for the whole apartment. */
  roomId: string | null;
  /** Catalogue furniture to add (only ids from the offered catalogue). */
  furniture: WishItem[];
  /** Ids Claude named that are not in the catalogue (dropped, only counted for a hint). */
  dropped: number;
}

export function buildPrompt(question: string, plan: PlanSummary, catalog: CatalogItem[]): string {
  return [
    'Du bist Einrichtungsberater für einen Wohnungsplaner. Beantworte die Frage zum Plan mit konkreten, umsetzbaren Vorschlägen auf Deutsch.',
    '',
    `Frage: ${question.trim().slice(0, MAX_QUESTION)}`,
    '',
    plan.text,
    '',
    'Katalog (nur diese Möbel dürfen vorgeschlagen werden; Format „id: Name, Breite×Tiefe×Höhe, Kategorie“):',
    summarizeCatalog(catalog),
    '',
    'Regeln:',
    `- Höchstens ${MAX_SUGGESTIONS} Vorschläge, jeder mit kurzem Titel (höchstens 80 Zeichen) und 1–3 Sätzen Begründung.`,
    '- Neue Möbel nur mit einer catalogId aus dem Katalog oben. Keine Marken, Produkte, Händler oder Preise erfinden oder nennen.',
    '- Ein Vorschlag mit Möbeln braucht einen Raum (room = R1, R2 …). Die App stellt die Möbel selbst kollisionsfrei auf; Positionen nicht angeben.',
    '- Vorschläge ohne neue Möbel (umstellen, Farben, Licht, Wege) haben eine leere furniture-Liste.',
    '',
    'Antworte nur mit JSON in genau dieser Form:',
    '{"suggestions":[{"title":"…","detail":"…","room":"R1","furniture":[{"catalogId":"generic-armchair","quantity":1}]}]}',
    'room ist null, wenn der Vorschlag die ganze Wohnung betrifft.',
  ].join('\n');
}

const AnswerSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.unknown().optional(),
        detail: z.unknown().optional(),
        room: z.unknown().optional(),
        furniture: z.array(z.object({ catalogId: z.unknown(), quantity: z.unknown().optional() })).optional().catch([]),
      }),
    )
    .catch([]),
});

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Checks Claude's answer; throws when it holds no usable suggestion. */
export function parseAnswer(raw: unknown, plan: PlanSummary, catalog: CatalogItem[], focusRoomId: string | null = null): AssistantSuggestion[] {
  const parsed = AnswerSchema.safeParse(Array.isArray(raw) ? { suggestions: raw } : raw);
  if (!parsed.success) throw new Error('Antwort hat nicht die erwartete Form.');
  const ids = new Set(catalog.map((c) => c.id));
  const out: AssistantSuggestion[] = [];
  for (const s of parsed.data.suggestions.slice(0, MAX_SUGGESTIONS)) {
    const title = clip(s.title, 80);
    if (!title) continue;
    const key = typeof s.room === 'string' ? s.room.trim().toUpperCase() : '';
    const roomId = plan.roomKeys[key] ?? focusRoomId;
    const furniture: WishItem[] = [];
    let dropped = 0;
    for (const f of s.furniture ?? []) {
      const id = typeof f.catalogId === 'string' ? f.catalogId.trim() : '';
      if (!ids.has(id)) {
        dropped++;
        continue;
      }
      const q = Math.max(1, Math.min(MAX_QUANTITY, Math.round(Number(f.quantity ?? 1)) || 1));
      const same = furniture.find((w) => w.catalogId === id);
      if (same) same.quantity = Math.min(MAX_QUANTITY, same.quantity + q);
      else furniture.push({ catalogId: id, quantity: q });
    }
    // furniture without a room cannot be placed
    if (!roomId && furniture.length) {
      dropped += furniture.length;
      furniture.length = 0;
    }
    out.push({ title, detail: clip(s.detail, 600), roomId, furniture, dropped });
  }
  if (!out.length) throw new Error('Keine verwertbaren Vorschläge.');
  return out;
}
