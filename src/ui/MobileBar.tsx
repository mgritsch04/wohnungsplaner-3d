import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore, type Selection } from '../store/uiStore';
import type { Project } from '../model/schema';
import { fixtureLabel } from '../model/fixtures';
import { deleteSelection, duplicateSelection, rotateSelection } from './actions';
import { openObjectMenu } from './objectMenu';
import type { PhoneSheet } from './phoneLayout';
import { IconDuplicate, IconRotateLeft, IconRotateRight, IconTrash } from './icons';

/**
 * Untere Leiste der Handy-Ansicht (#129, Backlog-Zeile 89): Plan/3D bekommen den ganzen Platz, die beiden
 * Seitenpanels öffnen sich als Blatt von unten (erneut tippen schließt).
 */
export function MobileBar({ sheet, onSheet, onShop }: { sheet: PhoneSheet; onSheet: (s: PhoneSheet) => void; onShop: () => void }) {
  const hasSelection = useUiStore((s) => s.selection !== null || s.multi.length > 0);
  const toggle = (s: Exclude<PhoneSheet, null>) => onSheet(sheet === s ? null : s);
  return (
    <div className="mobile-bottom">
      {!sheet && <MobileSelectionBar onDetails={() => onSheet('right')} />}
      <nav className="mobile-bar" aria-label="Panels">
        <button className={sheet === 'left' ? 'active' : ''} aria-pressed={sheet === 'left'} onClick={() => toggle('left')}>
          Werkzeuge
        </button>
        <button className={sheet === 'right' ? 'active' : ''} aria-pressed={sheet === 'right'} onClick={() => toggle('right')}>
          Details{hasSelection && <span className="mobile-bar-dot" aria-label="(Auswahl)" />}
        </button>
        <button onClick={onShop} data-testid="open-shop-mode">
          Laden
        </button>
        {sheet && (
          <button className="mobile-bar-close" aria-label="Panel schließen" onClick={() => onSheet(null)}>
            ✕
          </button>
        )}
      </nav>
    </div>
  );
}

/** Short name of the selection for the phone bar (#164). */
export function selectionLabel(p: Project, sel: Selection, count: number): string {
  if (sel.type === 'furniture') {
    if (count > 1) return `${count} Möbel`;
    return p.furniture.find((f) => f.id === sel.id)?.name || 'Möbel';
  }
  if (sel.type === 'room') return p.rooms.find((r) => r.id === sel.id)?.name || 'Raum';
  if (sel.type === 'opening') {
    const kind = p.openings.find((o) => o.id === sel.id)?.kind;
    return kind === 'window' ? 'Fenster' : kind === 'passage' ? 'Durchgang' : 'Tür';
  }
  if (sel.type === 'light') return p.lights.find((l) => l.id === sel.id)?.name || 'Licht';
  if (sel.type === 'fixture') {
    const f = p.fixtures.find((x) => x.id === sel.id);
    return f ? fixtureLabel(f) : 'Anschluss';
  }
  if (sel.type === 'device') return p.devices.find((d) => d.id === sel.id)?.name || 'Gerät';
  return sel.type === 'wall' ? 'Wand' : 'Ecke';
}

/**
 * Handy (#164): was ausgewählt ist, mit den häufigsten Aktionen zum Antippen – drehen,
 * duplizieren, löschen und „Details“ für alle Eigenschaften (statt Tastenkürzeln).
 */
function MobileSelectionBar({ onDetails }: { onDetails: () => void }) {
  const selection = useUiStore((s) => s.selection);
  const count = useUiStore((s) => selectedFurnitureIds(s).length);
  const walking = useUiStore((s) => s.cameraMode === 'walk' && s.viewMode !== '2d');
  const label = useProjectStore((s) => (selection ? selectionLabel(s.project, selection, count) : ''));
  if (!selection) return null;
  const furniture = selection.type === 'furniture';
  return (
    <div className="mobile-selection" role="toolbar" aria-label="Auswahl">
      <span className="mobile-selection-name" title={label}>
        {label}
      </span>
      {furniture && !walking && (
        <>
          <button type="button" aria-label="Nach links drehen (15°)" onClick={() => rotateSelection(-Math.PI / 12)}>
            <IconRotateLeft />
          </button>
          <button type="button" aria-label="Nach rechts drehen (15°)" onClick={() => rotateSelection(Math.PI / 12)}>
            <IconRotateRight />
          </button>
          <button type="button" aria-label="Duplizieren" onClick={duplicateSelection}>
            <IconDuplicate />
          </button>
        </>
      )}
      {!walking && (
        <button type="button" className="danger" aria-label="Löschen" onClick={() => void deleteSelection()}>
          <IconTrash />
        </button>
      )}
      <button type="button" aria-label="Aktionen" title="Aktionen und Infos zum Objekt" data-testid="mobile-object-menu" onClick={() => openObjectMenu(selection, 0, 0, 'sheet')}>
        ⋯
      </button>
      <button type="button" onClick={onDetails}>
        Details
      </button>
      <button type="button" aria-label="Auswahl aufheben" onClick={() => useUiStore.getState().setSelection(null)}>
        ✕
      </button>
    </div>
  );
}
