import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, ProjectSchema, type Project } from '../../model/schema';
import type { z } from 'zod';
import { newId } from '../../model/ids';
import { validateModel } from '../../model/validation';
import { FileFormatError, formatZodError } from '../zodErrors';

/**
 * Project save format
 * -------------------
 * The project JSON is exactly the `Project` object (see model/schema.ts) with
 * `format: "wohnungsplaner-project"` and an integer `schemaVersion`.
 *
 * Migrations: each entry upgrades a raw object from version N to N+1. Add a
 * function here whenever PROJECT_SCHEMA_VERSION is increased.
 */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const PROJECT_MIGRATIONS: Record<number, Migration> = {
  // 1 → 2 (#170): simulated smart-home devices and automations
  1: (raw) => ({ ...raw, schemaVersion: 2, devices: raw.devices ?? [], automations: raw.automations ?? [] }),
  // 2 → 3 (#80): optional wall assembly (Wall.assembly) – nothing to convert
  2: (raw) => ({ ...raw, schemaVersion: 3 }),
  // 3 → 4 (#83, #84, #91): notes and tasks (room task lists + moving checklist)
  3: (raw) => ({ ...raw, schemaVersion: 4, notes: raw.notes ?? [], tasks: raw.tasks ?? [] }),
  // 4 → 5 (#86): reference photos on walls
  4: (raw) => ({ ...raw, schemaVersion: 5, photos: raw.photos ?? [] }),
};

export function migrateProjectObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FileFormatError('Die Datei enthält kein Projekt-Objekt.');
  let obj = raw as Record<string, unknown>;
  if (obj.format !== PROJECT_FORMAT) {
    throw new FileFormatError(
      obj.format === 'apartment-plan'
        ? 'Dies ist eine Grundriss-Datei (apartment-plan.json). Bitte über „Grundriss-JSON importieren“ laden.'
        : 'Unbekanntes Dateiformat (erwartet: wohnungsplaner-project).',
    );
  }
  const rawVersion = obj.schemaVersion;
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1) throw new FileFormatError('Ungültige oder fehlende Schema-Version.');
  let version: number = rawVersion;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new FileFormatError(
      `Das Projekt wurde mit einer neueren Version erstellt (Schema ${version}, unterstützt bis ${PROJECT_SCHEMA_VERSION}). Bitte die Anwendung aktualisieren.`,
    );
  }
  while (version < PROJECT_SCHEMA_VERSION) {
    const m = PROJECT_MIGRATIONS[version];
    if (!m) throw new FileFormatError(`Keine Migration von Schema ${version} verfügbar.`);
    obj = m(obj);
    version = obj.schemaVersion as number;
  }
  return obj;
}

export interface ParsedProject {
  project: Project;
  warnings: string[];
  /** What was repaired while loading (also part of `warnings`). */
  repaired?: string[];
}

/**
 * Invalid settings values (e.g. a range tightened by an update) fall back to their defaults
 * instead of making the whole project unreadable (#268). Returns the names of the reset settings.
 */
function resetInvalidSettings(obj: Record<string, unknown>, error: z.ZodError): string[] | null {
  const keys = new Set<string>();
  for (const i of error.issues) {
    if (i.path[0] !== 'settings' || typeof i.path[1] !== 'string') return null;
    keys.add(i.path[1]);
  }
  const settings = obj.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== 'object') return null;
  for (const k of keys) delete settings[k];
  return [...keys];
}

/**
 * The same furniture id twice (e.g. a suggestion taken over twice) made saved projects
 * unloadable (#268): an exact copy is dropped, a changed copy keeps its data under a new id.
 */
function repairDuplicateFurniture(p: Project): string[] {
  const seen = new Map<string, string>();
  const warnings: string[] = [];
  p.furniture = p.furniture.filter((f) => {
    const json = JSON.stringify(f);
    const first = seen.get(f.id);
    if (first === undefined) {
      seen.set(f.id, json);
      return true;
    }
    if (first === json) {
      warnings.push(`Doppelt gespeichertes Möbel „${f.name}“ wurde entfernt.`);
      return false;
    }
    f.id = newId('item');
    seen.set(f.id, json);
    warnings.push(`Möbel „${f.name}“ hatte dieselbe ID wie ein anderes und hat eine neue bekommen.`);
    return true;
  });
  return warnings;
}

/** Parse + migrate + validate a project from a JSON value. Throws FileFormatError. */
export function parseProject(raw: unknown): ParsedProject {
  const migrated = migrateProjectObject(raw);
  let res = ProjectSchema.safeParse(migrated);
  const repaired: string[] = [];
  if (!res.success) {
    const copy = structuredClone(migrated);
    const reset = resetInvalidSettings(copy, res.error);
    if (reset) {
      const retry = ProjectSchema.safeParse(copy);
      if (retry.success) {
        res = retry;
        repaired.push(`Ungültige Einstellungen auf Standard zurückgesetzt: ${reset.join(', ')}.`);
      }
    }
  }
  if (!res.success) throw new FileFormatError('Das Projekt ist ungültig.', formatZodError(res.error));
  const project = res.data;
  repaired.push(...repairDuplicateFurniture(project));
  const issues = validateModel(project);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new FileFormatError('Das Projekt enthält inkonsistente Daten.', errors.map((e) => e.message));
  return { project, warnings: [...repaired, ...issues.map((i) => i.message)], ...(repaired.length ? { repaired } : {}) };
}

export function parseProjectJson(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FileFormatError('Die Datei ist kein gültiges JSON.', [e instanceof Error ? e.message : String(e)]);
  }
  return parseProject(raw);
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p);
}
