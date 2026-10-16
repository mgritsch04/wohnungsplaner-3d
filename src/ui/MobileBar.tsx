import { useUiStore } from '../store/uiStore';
import type { PhoneSheet } from './phoneLayout';

/**
 * Untere Leiste der Handy-Ansicht (#129): Plan/3D bekommen den ganzen Platz, die beiden
 * Seitenpanels öffnen sich als Blatt von unten (erneut tippen schließt).
 */
export function MobileBar({ sheet, onSheet }: { sheet: PhoneSheet; onSheet: (s: PhoneSheet) => void }) {
  const hasSelection = useUiStore((s) => s.selection !== null || s.multi.length > 0);
  const toggle = (s: Exclude<PhoneSheet, null>) => onSheet(sheet === s ? null : s);
  return (
    <nav className="mobile-bar" aria-label="Panels">
      <button className={sheet === 'left' ? 'active' : ''} aria-pressed={sheet === 'left'} onClick={() => toggle('left')}>
        Werkzeuge
      </button>
      <button className={sheet === 'right' ? 'active' : ''} aria-pressed={sheet === 'right'} onClick={() => toggle('right')}>
        Details{hasSelection && <span className="mobile-bar-dot" aria-label="(Auswahl)" />}
      </button>
      {sheet && (
        <button className="mobile-bar-close" aria-label="Panel schließen" onClick={() => onSheet(null)}>
          ✕
        </button>
      )}
    </nav>
  );
}
