import { useUiStore } from '../store/uiStore';

/** "Sitzen" badge over the 3D view while seated in the walkthrough (#78); same look as "Geduckt". */
export function WalkPostureBadge() {
  const show = useUiStore((s) => s.cameraMode === 'walk' && s.walkSit);
  if (!show) return null;
  return (
    <div className="walk-duck" data-testid="walk-sit">
      ⤓ Sitzen (X: aufstehen)
    </div>
  );
}
