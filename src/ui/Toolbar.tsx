import { useState, type ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { usePerformanceStore } from '../view3d/performanceStore';
import { useDialogStore } from './dialogStore';
import { exportPackage, importProjectFile, newProject, saveNow } from './actions';
import type { SaveState } from '../persistence/useAutosave';
import { exportFloorPlanJson, importFloorPlanJsonFile } from '../import/floorPlanActions';
import { exportShoppingCsv } from '../budget/budgetActions';
import { openPrintView } from '../export/PrintView';
import { exportGlbFile } from '../export/exportGlbFile';
import { LampsSelect, TimeOfDayControl, TimePresetSelect } from './TimeOfDayControl';
import { ToolbarMenu } from './ToolbarMenu';
import { isProjectEmpty, reopenStartCard } from './StartCard';
import { IconCutaway, IconHelp, IconMore, IconOrbit, IconRedo, IconResetCamera, IconSit, IconSplitView, IconStand, IconUndo, IconWalk } from './icons';

/**
 * Button that shows only an icon (#103). The name is the `aria-label` (screen readers, tests),
 * the tooltip (`title`, plus `data-tip` for keyboard focus) adds the key where there is one.
 */
function IconButton({
  label,
  tip,
  keys,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tip?: string;
  /** `aria-keyshortcuts`, e.g. "Control+Z". */
  keys?: string;
  /** For toggles: shown as active and announced as pressed. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const t = tip ?? label;
  return (
    <button
      type="button"
      className={pressed ? 'icon-btn active' : 'icon-btn'}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={keys}
      title={t}
      data-tip={t}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Top toolbar (#100, #103): only the frequent tools stay visible – undo/redo, view, camera,
 * quality, help. Project/import actions are in "Projekt ▾"; exports and the light presets
 * (Realismus) in the "Mehr" menu (⋯). Unambiguous tools are icons with tooltip and name.
 */
export function Toolbar({ saveState }: { saveState: SaveState }) {
  const name = useProjectStore((s) => s.project.name);
  const projectId = useProjectStore((s) => s.project.id);
  const empty = useProjectStore((s) => isProjectEmpty(s.project));
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
  const walkSit = useUiStore((s) => s.walkSit);
  const setWalkSit = useUiStore((s) => s.setWalkSit);
  const cutaway = usePerformanceStore((s) => s.cutaway);
  const setCutaway = usePerformanceStore((s) => s.setCutaway);
  const resetCamera = usePerformanceStore((s) => s.resetCamera);
  const openModal = useDialogStore((s) => s.openModal);
  const [menu, setMenu] = useState<'file' | 'more' | null>(null);
  const show3d = viewMode !== '2d';
  const realism = quality === 'realism';
  const saveLabel = saveState === 'saved' ? 'Gespeichert' : saveState === 'error' ? 'Speicherfehler' : 'Speichert…';

  const menuProps = (m: 'file' | 'more') => ({
    open: menu === m,
    onOpenChange: (open: boolean) => setMenu((cur) => (open ? m : cur === m ? null : cur)),
  });
  const closeAfter = (fn: () => unknown) => () => {
    setMenu(null);
    void fn();
  };
  const setQuality = (q: 'planning' | 'realism') =>
    apply((d) => {
      d.settings.quality = q;
    });

  return (
    <header className="toolbar">
      <div className="toolbar-group brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="6" style={{ fill: 'var(--color-accent)' }} />
          <path d="M6 26V12l10-7 10 7v14H19v-8h-6v8z" style={{ fill: 'var(--color-on-accent)' }} />
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
        <span className={`save-state save-${saveState}`} title={`${saveLabel} – automatische Speicherung im Browser (IndexedDB)`}>
          {/* narrow windows show only the dot; the text stays for screen readers */}
          <span className="save-dot" aria-hidden />
          <span className="save-text">{saveLabel}</span>
        </span>
      </div>

      <div className="toolbar-group">
        <ToolbarMenu id="toolbar-menu-project" label="Projekt ▾" title="Neu, öffnen, speichern, Versionen, importieren" {...menuProps('file')}>
          <button onClick={closeAfter(() => newProject(false))}>Neues leeres Projekt</button>
          <button onClick={closeAfter(() => newProject(true))}>Neues Beispielprojekt</button>
          <button
            onClick={closeAfter(() => reopenStartCard(projectId))}
            disabled={!empty}
            title={empty ? 'Startkarte mit den ersten Schritten wieder anzeigen' : 'Nur bei einem leeren Projekt (ohne Wände, Räume und Möbel)'}
          >
            Erste Schritte{!empty && <span className="menu-note"> – nur bei leerem Projekt</span>}
          </button>
          <hr />
          <button onClick={closeAfter(() => openModal('projects'))}>Projekte öffnen…</button>
          <button onClick={closeAfter(saveNow)}>Jetzt speichern (Strg+S)</button>
          <button onClick={closeAfter(() => openModal('versions'))}>Versionen (Stände speichern/vergleichen)…</button>
          <hr />
          <button onClick={closeAfter(importProjectFile)}>Projekt importieren (.wohnplan.json)…</button>
          <button onClick={closeAfter(importFloorPlanJsonFile)}>Grundriss-JSON importieren…</button>
          <button onClick={closeAfter(() => useUiStore.getState().setLeftTab('import'))}>Plan als PDF/Bild importieren…</button>
        </ToolbarMenu>
        <IconButton label="Rückgängig" tip="Rückgängig (Strg+Z)" keys="Control+Z" onClick={undo} disabled={!canUndo}>
          <IconUndo />
        </IconButton>
        <IconButton label="Wiederholen" tip="Wiederholen (Strg+Y)" keys="Control+Y" onClick={redo} disabled={!canRedo}>
          <IconRedo />
        </IconButton>
      </div>

      <div className="toolbar-group segmented" role="group" aria-label="Ansicht">
        <button className={viewMode === '2d' ? 'active' : ''} aria-pressed={viewMode === '2d'} aria-keyshortcuts="1" onClick={() => setViewMode('2d')} title="Nur 2D-Plan (Taste 1)">
          2D
        </button>
        <IconButton label="2D + 3D" tip="2D-Plan und 3D nebeneinander (Taste 2)" keys="2" pressed={viewMode === 'split'} onClick={() => setViewMode('split')}>
          <IconSplitView />
        </IconButton>
        <button className={viewMode === '3d' ? 'active' : ''} aria-pressed={viewMode === '3d'} aria-keyshortcuts="3" onClick={() => setViewMode('3d')} title="Nur 3D (Taste 3)">
          3D
        </button>
      </div>

      {show3d && (
        <div className="toolbar-group">
          <div className="segmented" role="group" aria-label="Kamera">
            <IconButton label="Übersicht" tip="Übersicht: umkreisen und inspizieren" pressed={cameraMode === 'orbit'} onClick={() => setCameraMode('orbit')}>
              <IconOrbit />
            </IconButton>
            <IconButton label="Begehen" tip="Begehen: Ich-Perspektive mit WASD + Maus" pressed={cameraMode === 'walk'} onClick={() => setCameraMode('walk')}>
              <IconWalk />
            </IconButton>
          </div>
          {cameraMode === 'orbit' && (
            <>
              <IconButton label="Schnitt" tip="Schnitt in 1,20 m Höhe – Blick in die Räume" pressed={cutaway} onClick={() => setCutaway(!cutaway)}>
                <IconCutaway />
              </IconButton>
              <IconButton label="Kamera zurücksetzen" onClick={resetCamera}>
                <IconResetCamera />
              </IconButton>
            </>
          )}
          {cameraMode === 'walk' && (
            <div className="segmented" role="group" aria-label="Haltung beim Begehen">
              <IconButton label="Stehen" tip="Stehen (Taste X schaltet um)" keys="X" pressed={!walkSit} onClick={() => setWalkSit(false)}>
                <IconStand />
              </IconButton>
              <IconButton label="Sitzen" tip="Sitzen (Taste X schaltet um; Sitzhöhe im Projekt-Panel)" keys="X" pressed={walkSit} onClick={() => setWalkSit(true)}>
                <IconSit />
              </IconButton>
            </div>
          )}
        </div>
      )}

      {show3d && realism && (
        <div className="toolbar-group">
          <TimeOfDayControl compact />
        </div>
      )}

      <div className="toolbar-group right">
        <div className="segmented" role="group" aria-label="Qualität">
          <button className={quality === 'planning' ? 'active' : ''} aria-pressed={quality === 'planning'} onClick={() => setQuality('planning')} title="Planungsmodus: schnell, einfache Materialien, keine Schatten">
            Planung
          </button>
          <button className={realism ? 'active' : ''} aria-pressed={realism} onClick={() => setQuality('realism')} title="Realismus: Texturen, Schatten, Umgebungslicht">
            Realismus
          </button>
        </div>
        <IconButton label="Hilfe & Tastenkürzel" tip="Hilfe & Tastenkürzel (?)" keys="?" onClick={() => openModal('help')}>
          <IconHelp />
        </IconButton>
        <ToolbarMenu
          id="toolbar-menu-more"
          label={<IconMore />}
          ariaLabel="Mehr"
          title={show3d && realism ? 'Mehr: Export, Tageszeit und Lampen' : 'Mehr: Export'}
          className="icon-btn"
          align="right"
          {...menuProps('more')}
        >
          <div className="menu-heading">Exportieren</div>
          <button onClick={closeAfter(exportPackage)}>Projektpaket (.wohnplan.json)</button>
          <button onClick={closeAfter(exportFloorPlanJson)}>Grundriss (apartment-plan.json)</button>
          <button onClick={closeAfter(exportShoppingCsv)}>Einkaufsliste (CSV)</button>
          <button onClick={closeAfter(openPrintView)}>Plan drucken / PDF / PNG…</button>
          <button onClick={closeAfter(exportGlbFile)}>3D-Modell als GLB …</button>
          {show3d && realism && (
            <>
              <hr />
              <div className="menu-heading">Licht (Realismus)</div>
              <div className="menu-fields">
                <TimePresetSelect />
                <LampsSelect />
              </div>
            </>
          )}
        </ToolbarMenu>
      </div>
    </header>
  );
}
