import { useFurnishStore } from '../suggest/furnishStore';
import { furnitureCorners } from './furnitureGeometry';

/**
 * Furnishing suggestion (#137) in the plan: the proposed items as dashed outlines with their
 * names, clearly marked as a suggestion – they are not part of the project until applied.
 */
export function FurnishPreviewOverlay({ px }: { px: number }) {
  const preview = useFurnishStore((s) => s.preview);
  if (!preview?.items.length) return null;
  return (
    <g className="furnish-preview" data-testid="furnish-preview" pointerEvents="none">
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
