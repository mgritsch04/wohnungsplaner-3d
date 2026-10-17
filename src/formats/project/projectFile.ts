import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, ProjectSchema, type Project } from '../../model/schema';
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
}

/** Parse + migrate + validate a project from a JSON value. Throws FileFormatError. */
export function parseProject(raw: unknown): ParsedProject {
  const migrated = migrateProjectObject(raw);
  const res = ProjectSchema.safeParse(migrated);
  if (!res.success) throw new FileFormatError('Das Projekt ist ungültig.', formatZodError(res.error));
  const issues = validateModel(res.data);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new FileFormatError('Das Projekt enthält inkonsistente Daten.', errors.map((e) => e.message));
  return { project: res.data, warnings: issues.map((i) => i.message) };
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
