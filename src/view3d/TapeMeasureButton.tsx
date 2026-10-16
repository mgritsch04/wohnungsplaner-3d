import { useTapeStore } from './tapeStore';

/** Entry point of the 3D tape measure (#88) in the 3D view, top left. */
export function TapeMeasureButton() {
  const { active, items, pending, toggle, clear } = useTapeStore();
  return (
    <div className="tape-tools">
      <button className={active ? 'active' : ''} aria-pressed={active} onClick={toggle} title="Maßband: zwei Punkte in 3D anklicken (Taste K)">
        Maßband
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
