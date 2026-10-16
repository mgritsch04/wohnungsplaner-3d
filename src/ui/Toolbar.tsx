import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { usePerformanceStore } from '../view3d/performanceStore';
import { useDialogStore } from './dialogStore';
import { exportPackage, importProjectFile, newProject, saveNow } from './actions';
import type { SaveState } from '../persistence/useAutosave';
import { exportFloorPlanJson, importFloorPlanJsonFile } from '../import/floorPlanActions';
import { exportShoppingCsv } from '../budget/budgetActions';
import { openPrintView } from '../export/PrintView';
import { TimeOfDayControl } from './TimeOfDayControl';

export function Toolbar({ saveState }: { saveState: SaveState }) {
  const name = useProjectStore((s) => s.project.name);
  const apply = useProjectStore((s) => s.apply);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const quality = useProjectStore((s) => s.project.settings.quality);
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const cameraMode = useUiStore((s) => s.cameraMode);
  const setCameraMode = useUiStore((s) => s.setCameraMode);
  const cutaway = usePerformanceStore((s) => s.cutaway);
  const setCutaway = usePerformanceStore((s) => s.setCutaway);
  const resetCamera = usePerformanceStore((s) => s.resetCamera);
  const openModal = useDialogStore((s) => s.openModal);
  const [menu, setMenu] = useState<'file' | 'export' | null>(null);
  const show3d = viewMode !== '2d';

  const closeAfter = (fn: () => unknown) => () => {
    setMenu(null);
    void fn();
  };

  return (
    <header className="toolbar">
      <div className="toolbar-group brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="6" fill="#2563eb" />
          <path d="M6 26V12l10-7 10 7v14H19v-8h-6v8z" fill="#fff" />
        </svg>
        <input
          className="project-name"
          value={name}
          aria-label="Projektname"
          onChange={(e) => {
            const v = e.target.value;
            apply((d) => {
              d.name = v.slice(0, 200);
            });
          }}
        />
        <span className={`save-state save-${saveState}`} title="Automatische Speicherung im Browser (IndexedDB)">
          {saveState === 'saved' ? 'Gespeichert' : saveState === 'error' ? 'Speicherfehler' : 'Speichert…'}
        </span>
      </div>

      <div className="toolbar-group">
        <div className="menu-wrap">
          <button onClick={() => setMenu(menu === 'file' ? null : 'file')} aria-expanded={menu === 'file'}>
            Projekt ▾
          </button>
          {menu === 'file' && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <button onClick={closeAfter(() => newProject(false))}>Neues leeres Projekt</button>
              <button onClick={closeAfter(() => newProject(true))}>Neues Beispielprojekt</button>
              <button onClick={closeAfter(() => openModal('projects'))}>Projekte öffnen…</button>
              <button onClick={closeAfter(saveNow)}>Jetzt speichern (Strg+S)</button>
              <hr />
              <button onClick={closeAfter(importProjectFile)}>Projekt importieren (.wohnplan.json)…</button>
              <button onClick={closeAfter(importFloorPlanJsonFile)}>Grundriss-JSON importieren…</button>
              <button onClick={closeAfter(() => useUiStore.getState().setLeftTab('import'))}>Plan als PDF/Bild importieren…</button>
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button onClick={() => setMenu(menu === 'export' ? null : 'export')} aria-expanded={menu === 'export'}>
            Export ▾
          </button>
          {menu === 'export' && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <button onClick={closeAfter(exportPackage)}>Projektpaket (.wohnplan.json)</button>
              <button onClick={closeAfter(exportFloorPlanJson)}>Grundriss (apartment-plan.json)</button>
              <button onClick={closeAfter(exportShoppingCsv)}>Einkaufsliste (CSV)</button>
              <button onClick={closeAfter(openPrintView)}>Plan drucken / PDF / PNG…</button>
            </div>
          )}
        </div>
        <button onClick={undo} disabled={!canUndo} title="Rückgängig (Strg+Z)" aria-label="Rückgängig">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Wiederholen (Strg+Y)" aria-label="Wiederholen">
          ↷
        </button>
      </div>

      <div className="toolbar-group segmented" role="group" aria-label="Ansicht">
        {(['2d', 'split', '3d'] as const).map((m, i) => (
          <button key={m} className={viewMode === m ? 'active' : ''} onClick={() => setViewMode(m)} title={`Taste ${i + 1}`}>
            {m === '2d' ? '2D' : m === '3d' ? '3D' : '2D + 3D'}
          </button>
        ))}
      </div>

      {show3d && (
        <div className="toolbar-group">
          <div className="segmented" role="group" aria-label="Kamera">
            <button className={cameraMode === 'orbit' ? 'active' : ''} onClick={() => setCameraMode('orbit')} title="Umkreisen und inspizieren">
              Übersicht
            </button>
            <button className={cameraMode === 'walk' ? 'active' : ''} onClick={() => setCameraMode('walk')} title="Ich-Perspektive mit WASD + Maus">
              Begehen
            </button>
          </div>
          {cameraMode === 'orbit' && (
            <>
              <button className={cutaway ? 'active' : ''} onClick={() => setCutaway(!cutaway)} title="Schnitt in 1,20 m Höhe – Blick in die Räume">
                Schnitt
              </button>
              <button onClick={resetCamera} title="Kamera zurücksetzen">
                ⟲ Kamera
              </button>
            </>
          )}
        </div>
      )}

      {show3d && quality === 'realism' && (
        <div className="toolbar-group">
          <TimeOfDayControl compact />
        </div>
      )}

      <div className="toolbar-group segmented" role="group" aria-label="Qualität">
        <button
          className={quality === 'planning' ? 'active' : ''}
          onClick={() =>
            apply((d) => {
              d.settings.quality = 'planning';
            })
          }
          title="Planungsmodus: schnell, einfache Materialien, keine Schatten"
        >
          Planung
        </button>
        <button
          className={quality === 'realism' ? 'active' : ''}
          onClick={() =>
            apply((d) => {
              d.settings.quality = 'realism';
            })
          }
          title="Realismus: Texturen, Schatten, Umgebungslicht"
        >
          Realismus
        </button>
      </div>

      <div className="toolbar-group right">
        <button onClick={() => openModal('help')} title="Hilfe & Tastenkürzel">
          ?
        </button>
      </div>
    </header>
  );
}
