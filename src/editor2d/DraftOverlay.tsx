import { add, closestPointOnSegment, dist, normalize, perp, scale, sub, type Vec2 } from '../model/vec';
import type { ReconstructionDraft } from '../import/draft';
import type { DraftSelection } from '../import/importStore';

export const STATUS_COLOR = { confirmed: '#16a34a', estimated: '#d97706', uncertain: '#dc2626' } as const;

function quad(a: Vec2, b: Vec2, t: number): Vec2[] {
  const n = scale(perp(normalize(sub(b, a))), t / 2);
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

const INSTALL_LETTER = { socket: 'S', switch: 'L', radiator: 'H', water: 'W', drain: 'A' } as const;

export function DraftOverlay({ draft, selected, px }: { draft: ReconstructionDraft; selected: DraftSelection; px: number }) {
  return (
    <g>
      {draft.walls.map((w) => {
        const sel = selected?.type === 'wall' && selected.id === w.id;
        const c = STATUS_COLOR[w.status];
        return (
          <polygon
            key={w.id}
            points={quad(w.a, w.b, w.thickness).map((p) => `${p.x},${p.y}`).join(' ')}
            fill={c}
            fillOpacity={w.accepted ? (sel ? 0.75 : 0.45) : 0.08}
            stroke={sel ? '#1d4ed8' : c}
            strokeWidth={sel ? 2.5 : 1}
            strokeDasharray={w.accepted ? undefined : '4 3'}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {draft.openings.map((o) => {
        const sel = selected?.type === 'opening' && selected.id === o.id;
        const c = STATUS_COLOR[o.status];
        return (
          <g key={o.id} opacity={o.accepted ? 1 : 0.35}>
            <circle cx={o.center.x} cy={o.center.y} r={Math.max(o.width / 2, 6 * px)} fill="none" stroke={sel ? '#1d4ed8' : c} strokeWidth={sel ? 2.5 : 1.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
            <text x={o.center.x} y={o.center.y + 4 * px} fontSize={11 * px} textAnchor="middle" fill={c} fontWeight={700} paintOrder="stroke" stroke="#fff" strokeWidth={3 * px}>
              {o.kind === 'window' ? 'F' : o.kind === 'door' ? 'T' : 'D'}
            </text>
          </g>
        );
      })}
      {(draft.installations ?? []).map((x) => {
        const sel = selected?.type === 'installation' && selected.id === x.id;
        const c = STATUS_COLOR[x.status];
        return (
          <g key={x.id} opacity={x.accepted ? 1 : 0.35}>
            <circle cx={x.center.x} cy={x.center.y} r={Math.max(0.1, 6 * px)} fill="#fff" fillOpacity={0.7} stroke={sel ? '#1d4ed8' : c} strokeWidth={sel ? 2.5 : 1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            <text x={x.center.x} y={x.center.y + 4 * px} fontSize={10 * px} textAnchor="middle" fill={c} fontWeight={700}>
              {INSTALL_LETTER[x.kind]}
            </text>
          </g>
        );
      })}
      {draft.rooms.map((r) => {
        const sel = selected?.type === 'room' && selected.id === r.id;
        return (
          <g key={r.id} opacity={r.accepted ? 1 : 0.4}>
            <circle cx={r.labelPoint.x} cy={r.labelPoint.y} r={5 * px} fill={sel ? '#1d4ed8' : STATUS_COLOR[r.status]} />
            <text x={r.labelPoint.x} y={r.labelPoint.y - 8 * px} fontSize={12 * px} textAnchor="middle" fill="#111827" fontWeight={600} paintOrder="stroke" stroke="#fff" strokeWidth={3 * px}>
              {r.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function hitTestDraft(draft: ReconstructionDraft, p: Vec2, tol: number): DraftSelection {
  for (const o of draft.openings) if (dist(o.center, p) <= Math.max(o.width / 2, tol)) return { type: 'opening', id: o.id };
  for (const x of draft.installations ?? []) if (dist(x.center, p) <= Math.max(0.1, tol)) return { type: 'installation', id: x.id };
  for (const r of draft.rooms) if (dist(r.labelPoint, p) <= tol * 2) return { type: 'room', id: r.id };
  let best: { id: string; d: number } | null = null;
  for (const w of draft.walls) {
    const d = closestPointOnSegment(p, w.a, w.b).distance;
    if (d <= w.thickness / 2 + tol && (!best || d < best.d)) best = { id: w.id, d };
  }
  return best ? { type: 'wall', id: best.id } : null;
}
