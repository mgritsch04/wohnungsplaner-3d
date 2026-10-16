import { showCompareSide, stopCompare, useCompareStore, type CompareSide } from './compareStore';
import { diffSummary } from './diff';
import './versions.css';

/** Overlay of the before/after comparison in the 3D view (#76): A | B switch, legend, end. */
export function CompareBar() {
  const session = useCompareStore((s) => s.session);
  const showing = useCompareStore((s) => s.showing);
  if (!session) return null;
  const { counts } = session.diff;
  const side = (s: CompareSide, label: string) => (
    <button
      type="button"
      className={showing === s ? 'active' : ''}
      aria-pressed={showing === s}
      title={`${s.toUpperCase()}: ${label} (Taste ${s.toUpperCase()})`}
      onClick={() => showCompareSide(s)}
    >
      <strong>{s.toUpperCase()}</strong> <span className="compare-side-name">{label}</span>
    </button>
  );
  return (
    <div className="compare-bar" role="region" aria-label="Vorher-nachher-Vergleich" data-testid="compare-bar">
      <div className="compare-bar-row">
        <div className="compare-switch" role="group" aria-label="Gezeigter Stand">
          {side('a', session.a.label)}
          {side('b', session.b.label)}
        </div>
        <button type="button" className="primary" onClick={stopCompare}>
          Vergleich beenden
        </button>
      </div>
      <p className="compare-legend-summary" data-testid="compare-legend">
        {diffSummary(counts)}
      </p>
      <ul className="compare-legend" aria-label="Legende">
        <li>
          <span className="compare-swatch added" aria-hidden /> neu (in B)
        </li>
        <li>
          <span className="compare-swatch moved" aria-hidden /> verschoben/gedreht
        </li>
        <li>
          <span className="compare-swatch removed" aria-hidden /> entfernt ({showing === 'b' ? 'Geist an alter Stelle' : 'fehlt in B'})
        </li>
      </ul>
      <p className="compare-lock" role="note">
        Nur Ansicht – Bearbeiten ist im Vergleich gesperrt. Leertaste: A/B umschalten · Esc: beenden
      </p>
    </div>
  );
}
