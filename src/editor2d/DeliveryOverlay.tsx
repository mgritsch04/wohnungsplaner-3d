import { useDeliveryStore } from './deliveryStore';

/** Delivery route (#358): entrance → place, green when the piece fits, red when it does not. */
export function DeliveryOverlay({ px }: { px: number }) {
  const result = useDeliveryStore((s) => s.result);
  if (!result || !result.ok) return null;
  const color = result.fits ? '#16a34a' : '#dc2626';
  const at = result.bottleneck?.at;
  return (
    <g pointerEvents="none" data-testid="delivery-route" data-fits={result.fits ? '1' : '0'}>
      <polyline
        points={result.points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={result.entrance.x} cy={result.entrance.y} r={6 * px} fill="#ffffff" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={result.goal.x} cy={result.goal.y} r={6 * px} fill={color} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {at && <circle cx={at.x} cy={at.y} r={10 * px} fill="none" stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" data-testid="delivery-bottleneck" />}
    </g>
  );
}
