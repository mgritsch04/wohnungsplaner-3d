import { memo } from 'react';
import type { Underlay } from '../model/schema';
import { radToDeg } from '../model/units';
import { useAssetUrl } from '../persistence/useAssetUrl';

/** The imported floor plan, drawn beneath the editable geometry. */
export const UnderlayImage = memo(function UnderlayImage({ underlay: u }: { underlay: Underlay }) {
  const { url, missing } = useAssetUrl(u.imageAssetId);
  const crop = u.crop;
  const clipId = `underlay-clip-${u.imageAssetId}`;
  return (
    <g transform={`translate(${u.x} ${u.y}) rotate(${radToDeg(u.rotation)}) scale(${u.metersPerPixel})`} pointerEvents="none">
      {crop && (
        <clipPath id={clipId}>
          <rect x={crop.x} y={crop.y} width={crop.width} height={crop.height} />
        </clipPath>
      )}
      {url ? (
        <image href={url} x={0} y={0} width={u.pixelWidth} height={u.pixelHeight} opacity={u.opacity} clipPath={crop ? `url(#${clipId})` : undefined} preserveAspectRatio="none" />
      ) : (
        <rect x={0} y={0} width={u.pixelWidth} height={u.pixelHeight} fill={missing ? '#fee2e2' : '#f1f5f9'} opacity={0.5} />
      )}
      <rect
        x={crop?.x ?? 0}
        y={crop?.y ?? 0}
        width={crop?.width ?? u.pixelWidth}
        height={crop?.height ?? u.pixelHeight}
        fill="none"
        stroke={u.calibrated ? '#94a3b8' : '#f59e0b'}
        strokeDasharray="8 6"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
});
