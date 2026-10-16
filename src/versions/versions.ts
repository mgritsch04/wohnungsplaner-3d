import { pruneGroups } from '../model/groups';
import { ProjectSchema, type Project } from '../model/schema';

/**
 * Project versions / saved states (#66, #58) – pure helpers
 * ---------------------------------------------------------
 * A saved state ("Stand") is the full project document at one point in time.
 * It is stored next to the project (see persistence/versions.ts), not inside
 * the project schema, so saving or deleting a state is never undone by Ctrl+Z
 * and the undo history does not carry dozens of snapshots.
 *
 * Opening a state replaces the project CONTENT (plan, furniture, lights,
 * materials, settings, underlay) in one `apply` call – one undo step. Identity
 * (id, name, creation date) stays with the current project.
 */

/** Maximum number of saved states per project (manual + automatic). */
export const VERSION_LIMIT = 30;
export const VERSION_NAME_MAX = 100;

/** The parts of a project that a saved state restores. */
export const CONTENT_KEYS = ['settings', 'nodes', 'walls', 'openings', 'rooms', 'furniture', 'lights', 'materials', 'underlay'] as const;
type ContentKey = (typeof CONTENT_KEYS)[number];

/** Replace the content of `draft` with the content of `snapshot` (use inside `apply`). */
export function restoreVersionContent(draft: Project, snapshot: Project): void {
  const target = draft as Record<ContentKey, unknown>;
  for (const k of CONTENT_KEYS) target[k] = structuredClone(snapshot[k]);
  // furniture groups (#65) belong to the furniture: their names come along (states saved before lack them)
  draft.groups = structuredClone(snapshot.groups ?? []);
  pruneGroups(draft);
}

/** JSON with sorted object keys and without undefined values. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Canonical text of the restorable content: identical content gives an identical
 * key, independent of key order or schema defaults that are filled in on loading.
 */
export function contentKey(p: Project): string {
  const parsed = ProjectSchema.safeParse(p);
  const src = parsed.success ? parsed.data : p;
  // furniture group names (#65) only when there are any – keeps the keys of earlier states unchanged
  const groups = src.groups?.length ? [src.groups] : [];
  return stableStringify([...CONTENT_KEYS.map((k) => src[k]), ...groups]);
}

/** 64-bit (two 32-bit FNV-1a variants) hex hash – used to skip duplicate automatic states. */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export const contentHash = (p: Project) => hashText(contentKey(p));

export function cleanVersionName(name: string, fallback: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, VERSION_NAME_MAX);
  return n || fallback;
}

export function defaultVersionName(date = new Date()): string {
  return `Stand ${date.toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** Name of the automatic state saved before switching to `target`. */
export function autoVersionName(target: string): string {
  return cleanVersionName(`Automatisch vor dem Wechsel zu „${target}“`, 'Automatisch vor dem Wechsel');
}

export class VersionLimitError extends Error {
  constructor() {
    super(`Es sind bereits ${VERSION_LIMIT} Stände gespeichert (Obergrenze). Bitte zuerst ältere Stände löschen.`);
    this.name = 'VersionLimitError';
  }
}
