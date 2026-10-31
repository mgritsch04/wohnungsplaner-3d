import { useTapeStore } from './tapeStore';
import { useTourStore } from '../store/tourStore';

/** Entry point of the 3D tape measure (#88) in the 3D view, top left. */
export function TapeMeasureButton() {
  const { active, items, pending, toggle, clear } = useTapeStore();
  const touring = useTourStore((s) => s.playing);
  const startTour = useTourStore((s) => s.start);
  const endTour = useTourStore((s) => s.end);
  return (
    <div className="tape-tools">
      <button className={active ? 'active' : ''} aria-pressed={active} onClick={toggle} title="Maßband: zwei Punkte in 3D anklicken (Taste K)">
        Maßband
      </button>
      <button className={touring ? 'active' : ''} aria-pressed={touring} onClick={touring ? endTour : startTour} title="Rundgang: automatische Tour in Augenhöhe durch alle Räume (Esc oder WASD beendet)">
        Rundgang
      </button>
      {(items.length > 0 || pending) && (
        <button onClick={clear} title="Alle Messungen löschen (Esc)">
          Messungen löschen
        </button>
      )}
      {active && (
        <div className="tape-hint" role="status">
          {pending ? 'Zweiten Punkt anklicken' : 'Ersten Punkt anklicken'} · Esc löscht · K beendet
        </div>
      )}
    </div>
  );
}
