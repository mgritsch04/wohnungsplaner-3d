import type { Project, Wall } from './schema';

/**
 * Rough sound-insulation estimate per wall (#80). Orientation only – no building-physics
 * calculation. The dB values are typical ballpark figures for the construction type.
 */
export type WallAssembly = NonNullable<Wall['assembly']>;

export const ASSEMBLIES: { id: WallAssembly; label: string; /** typical airborne insulation, dB */ rw: number }[] = [
  { id: 'brick', label: 'Ziegel', rw: 47 },
  { id: 'concrete', label: 'Beton', rw: 55 },
  { id: 'aerated', label: 'Porenbeton', rw: 42 },
  { id: 'drywall', label: 'Trockenbau', rw: 38 },
];

export const assemblyLabel = (a: WallAssembly | undefined): string => ASSEMBLIES.find((x) => x.id === (a ?? 'brick'))!.label;

export type SoundRating = 'schwach' | 'mittel' | 'gut';

/** Estimated airborne insulation (dB); thin walls lose a few dB. Unknown assembly counts as brick. */
export function estimateInsulation(w: Pick<Wall, 'assembly' | 'thickness'>): number {
  const base = ASSEMBLIES.find((x) => x.id === (w.assembly ?? 'brick'))!.rw;
  const thin = w.thickness < 0.1 ? -4 : 0;
  return base + thin;
}

export function ratingOf(db: number): SoundRating {
  return db >= 50 ? 'gut' : db >= 43 ? 'mittel' : 'schwach';
}

export type NoiseClass = 'loud' | 'quiet' | 'neutral';

/** Guess from the room name (the model has no room types). */
export function noiseClassOf(name: string): NoiseClass {
  const n = name.toLowerCase();
  if (/schlaf|kind|gäste|gaeste|arbeit|büro|buero|studier|bedroom|nursery|office/.test(n)) return 'quiet';
  if (/küche|kueche|wohn|ess|bad|wc|toilette|wasch|hwr|technik|musik|hobby|kitchen|living|bath/.test(n)) return 'loud';
  return 'neutral';
}

export interface SoundIssue {
  wallId: string;
  loudRoomId: string;
  quietRoomId: string;
  db: number;
  rating: SoundRating;
}

/** Wall ids that are boundary of the room (consecutive nodes of its cycle). */
function roomWallIds(p: Pick<Project, 'walls'>, nodeIds: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < nodeIds.length; i++) {
    const a = nodeIds[i];
    const b = nodeIds[(i + 1) % nodeIds.length];
    const w = p.walls.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (w) out.add(w.id);
  }
  return out;
}

/** Rooms on both sides of a wall (rooms sharing it). */
export function wallRooms(p: Pick<Project, 'walls' | 'rooms'>, wallId: string): string[] {
  return p.rooms.filter((r) => roomWallIds(p, r.nodeIds).has(wallId)).map((r) => r.id);
}

/** Loud room next to quiet room across a wall with weak or medium insulation. */
export function soundIssues(p: Pick<Project, 'walls' | 'rooms'>): SoundIssue[] {
  const out: SoundIssue[] = [];
  const walls = new Map<string, string[]>();
  for (const r of p.rooms) {
    for (const id of roomWallIds(p, r.nodeIds)) walls.set(id, [...(walls.get(id) ?? []), r.id]);
  }
  for (const [wallId, ids] of walls) {
    if (ids.length < 2) continue;
    const w = p.walls.find((x) => x.id === wallId)!;
    const db = estimateInsulation(w);
    const rating = ratingOf(db);
    if (rating === 'gut') continue;
    const rooms = ids.map((id) => p.rooms.find((r) => r.id === id)!);
    const loud = rooms.find((r) => noiseClassOf(r.name) === 'loud');
    const quiet = rooms.find((r) => noiseClassOf(r.name) === 'quiet');
    if (loud && quiet) out.push({ wallId, loudRoomId: loud.id, quietRoomId: quiet.id, db, rating });
  }
  return out;
}
