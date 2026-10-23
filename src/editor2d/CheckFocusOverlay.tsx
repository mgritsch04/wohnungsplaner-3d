import { useCheckStore } from '../ui/checkStore';

/** Pulsing ring around the finding the user jumped to from the Wohnungs-Check (#357). */
export function CheckFocusOverlay({ px }: { px: number }) {
  const focus = useCheckStore((s) => s.focus);
  if (!focus) return null;
  return (
    <g pointerEvents="none" data-testid="check-focus" data-item={focus.id}>
      <circle cx={focus.at.x} cy={focus.at.y} r={26 * px} fill="none" stroke="#2563eb" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />
      <circle cx={focus.at.x} cy={focus.at.y} r={4 * px} fill="#2563eb" />
    </g>
  );
}
