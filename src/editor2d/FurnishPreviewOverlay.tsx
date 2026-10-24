import { useFurnishStore } from '../suggest/furnishStore';
import { furnitureCorners } from './furnitureGeometry';

/**
 * Furnishing suggestion (#137) in the plan: the proposed items as dashed outlines with their
 * names, clearly marked as a suggestion – they are not part of the project until applied. The
 * new proposal (#442) also brings the zones it planned: faint areas with their purpose.
 */
export function FurnishPreviewOverlay({ px }: { px: number }) {
  const preview = useFurnishStore((s) => s.preview);
  if (!preview?.items.length) return null;
  return (
    <g className="furnish-preview" data-testid="furnish-preview" pointerEvents="none">
      {(preview.zones ?? []).map((z) => {
        const cx = z.points.reduce((a, p) => a + p.x, 0) / z.points.length;
        const top = Math.min(...z.points.map((p) => p.y));
        return (
          <g key={`${z.roomId}:${z.id}`} data-furnish-zone={z.id}>
            <polygon className="furnish-zone" points={z.points.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
            <text className="furnish-zone-label" x={cx} y={top + 14 * px} fontSize={9 * px} textAnchor="middle" strokeWidth={3 * px}>
              {z.label}
            </text>
          </g>
        );
      })}
      {preview.items.map((f) => {
        const pts = furnitureCorners(f);
        return (
          <g key={f.id} data-furnish-item={f.name}>
            <polygon className="furnish-ghost" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
            {Math.min(f.width, f.depth) > 30 * px && (
              <text className="furnish-ghost-label" x={f.x} y={f.y + 4 * px} fontSize={10 * px} textAnchor="middle" strokeWidth={3 * px}>
                {f.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
