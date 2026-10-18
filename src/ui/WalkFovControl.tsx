import { useProjectStore } from '../store/projectStore';
import { FEEL_FOV, WALK_FOV, WALK_FOV_DEFAULT, WALK_FOV_SLIDER_MIN } from '../view3d/walkZoom';

/**
 * Field of view of the walkthrough (#263): slider plus quick choices "Gefühlt echt" (62° with scale
 * hints), "Normal" (50°) and "Weit" (70°, the old wide angle). Dragging = one undo step.
 */
export function WalkFovControl() {
  const fov = useProjectStore((s) => s.project.settings.walkFov);
  const trueScale = useProjectStore((s) => s.project.settings.walkTrueScale);
  const st = useProjectStore.getState;
  const setFov = (v: number, transient: boolean) => {
    const fn = (d: { settings: { walkFov: number; walkTrueScale: boolean } }) => {
      d.settings.walkFov = Math.round(Math.max(WALK_FOV_SLIDER_MIN, Math.min(WALK_FOV, v)));
      d.settings.walkTrueScale = false;
    };
    if (transient) st().updateTransient(fn);
    else st().apply(fn);
  };
  const quick = (label: string, title: string, active: boolean, onClick: () => void) => (
    <button type="button" aria-pressed={active} className={active ? 'active' : undefined} title={title} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <div className="field">
      <label className="field-label" htmlFor="walk-fov">
        Sichtfeld beim Begehen {trueScale ? `Gefühlt echt (${FEEL_FOV}°)` : `${fov}°`}
      </label>
      <div className="field-row">
        <input
          id="walk-fov"
          type="range"
          min={WALK_FOV_SLIDER_MIN}
          max={WALK_FOV}
          step={1}
          value={fov}
          aria-label="Sichtfeld beim Begehen"
          onPointerDown={() => st().beginTransaction()}
          onPointerUp={() => st().commitTransaction()}
          onBlur={() => st().commitTransaction()}
          onChange={(e) => setFov(Number(e.target.value), !!st().txBase)}
        />
      </div>
      <div className="segmented" role="group" aria-label="Sichtfeld-Schnellwahl">
        {quick('Gefühlt echt', `Gefühlt echt: ${FEEL_FOV}° mit Maßstabshinweisen (Entfernung und Höhe am Fadenkreuz, Türhöhen)`, trueScale, () =>
          st().apply((d) => void (d.settings.walkTrueScale = true)),
        )}
        {quick(`Normal (${WALK_FOV_DEFAULT}°)`, 'Natürlich wirkendes Sichtfeld (Standard)', !trueScale && fov === WALK_FOV_DEFAULT, () => setFov(WALK_FOV_DEFAULT, false))}
        {quick(`Weit (${WALK_FOV}°)`, 'Weitwinkel: man sieht viel, alles wirkt weiter weg', !trueScale && fov === WALK_FOV, () => setFov(WALK_FOV, false))}
      </div>
      <p className="muted small">Kleiner = näher und größer, wie mit einem Teleobjektiv; größer = mehr im Bild, alles wirkt weiter weg. Mausrad zoomt zusätzlich, Z springt zurück.</p>
    </div>
  );
}
