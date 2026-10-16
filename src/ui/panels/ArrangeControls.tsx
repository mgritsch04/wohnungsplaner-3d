import type { AlignEdge, DistributeAxis } from '../../model/arrange';
import { useUiStore } from '../../store/uiStore';
import { arrangeSelection } from '../arrangeActions';

/** Align/distribute buttons for a multi-selection of furniture (#51). */
const ALIGN: { edge: AlignEdge; label: string; icon: string }[] = [
  // icons: guide line (edge or middle) + two bars of different length flush with it
  { edge: 'left', label: 'Links ausrichten', icon: 'M4 3v18M8 7h10M8 15h6' },
  { edge: 'centerX', label: 'Waagrecht mittig ausrichten', icon: 'M12 3v18M6 7h12M8 15h8' },
  { edge: 'right', label: 'Rechts ausrichten', icon: 'M20 3v18M6 7h10M10 15h6' },
  { edge: 'top', label: 'Oben ausrichten', icon: 'M3 4h18M7 8v10M15 8v6' },
  { edge: 'centerY', label: 'Senkrecht mittig ausrichten', icon: 'M3 12h18M7 6v12M15 8v8' },
  { edge: 'bottom', label: 'Unten ausrichten', icon: 'M3 20h18M7 6v10M15 10v6' },
];

const DISTRIBUTE: { axis: DistributeAxis; label: string; icon: string }[] = [
  { axis: 'x', label: 'Waagrecht verteilen', icon: 'M3 4v16M21 4v16M9 8v8M15 8v8' },
  { axis: 'y', label: 'Senkrecht verteilen', icon: 'M4 3h16M4 21h16M8 9h8M8 15h8' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function ArrangeControls() {
  const count = useUiStore((s) => (s.selection?.type === 'furniture' ? 1 + s.multi.length : 0));
  if (count < 2) return null;
  const canDistribute = count >= 3;
  return (
    <section className="panel-section arrange-controls" data-testid="arrange-controls">
      <header>
        <h3>Ausrichten</h3>
      </header>
      <div className="panel-section-body">
        <div className="arrange-row" role="group" aria-label="Ausrichten">
          {ALIGN.map((a) => (
            <button key={a.edge} type="button" className="arrange-btn" title={a.label} aria-label={a.label} onClick={() => arrangeSelection({ kind: 'align', edge: a.edge })}>
              <Icon d={a.icon} />
            </button>
          ))}
        </div>
        <div className="arrange-label">Verteilen</div>
        <div className="arrange-row" role="group" aria-label="Verteilen">
          {DISTRIBUTE.map((a) => (
            <button
              key={a.axis}
              type="button"
              className="arrange-btn"
              title={canDistribute ? `${a.label} (gleiche Abstände zwischen den Kanten)` : `${a.label} – ab 3 Möbeln`}
              aria-label={a.label}
              disabled={!canDistribute}
              onClick={() => arrangeSelection({ kind: 'distribute', axis: a.axis })}
            >
              <Icon d={a.icon} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
