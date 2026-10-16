import { closestPointOnSegment, cross, dist, normalize, sub } from '../model/vec';
import type { ReconstructionDraft } from './draft';

export interface DraftConflict {
  ids: string[];
  message: string;
}

/** Find overlapping/duplicate walls and openings that are not on any wall. */
export function findDraftConflicts(d: ReconstructionDraft): DraftConflict[] {
  const out: DraftConflict[] = [];
  const walls = d.walls.filter((w) => w.accepted);
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      const da = normalize(sub(a.b, a.a));
      const db = normalize(sub(b.b, b.a));
      if (Math.abs(cross(da, db)) > 0.02) continue;
      // collinear & overlapping?
      const lineDist = Math.abs(cross(da, sub(b.a, a.a)));
      if (lineDist > Math.max(a.thickness, b.thickness) / 2) continue;
      const s = (p: { x: number; y: number }) => (p.x - a.a.x) * da.x + (p.y - a.a.y) * da.y;
      const La = dist(a.a, a.b);
      const s0 = Math.min(s(b.a), s(b.b));
      const s1 = Math.max(s(b.a), s(b.b));
      const overlap = Math.min(La, s1) - Math.max(0, s0);
      if (overlap > 0.05) {
        out.push({ ids: [a.id, b.id], message: `Wände überlappen auf ${overlap.toFixed(2)} m${lineDist > 0.01 ? ' (leicht versetzt)' : ''}.` });
      }
    }
  }
  for (const o of d.openings.filter((x) => x.accepted)) {
    const near = walls.some((w) => closestPointOnSegment(o.center, w.a, w.b).distance <= Math.max(0.3, w.thickness));
    if (!near) out.push({ ids: [o.id], message: `${o.kind === 'window' ? 'Fenster' : 'Tür/Durchgang'} liegt auf keiner Wand.` });
  }
  return out;
}
