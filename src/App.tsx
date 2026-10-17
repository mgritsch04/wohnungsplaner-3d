import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Editor2D } from './editor2d/Editor2D';
import { useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';
import { Toolbar } from './ui/Toolbar';
import { StatusBar } from './ui/StatusBar';
import { ModalHost, Toasts } from './ui/Modals';
import { FurnitureHoverCard } from './ui/FurnitureHoverCard';
import { SaveErrorBanner } from './ui/SaveErrorBanner';
import { useShortcuts } from './ui/useShortcuts';
import { useAutosave } from './persistence/useAutosave';
import { noteSaveState } from './ui/bugReport';
import { lastProjectId, loadProject, saveProject } from './persistence/projects';
import { ToolsPanel } from './ui/panels/ToolsPanel';
import { CatalogPanel } from './ui/panels/CatalogPanel';
import { ImportPanel } from './ui/panels/ImportPanel';
import { KitchenPanel } from './ui/panels/KitchenPanel';
import { FurnishPanel } from './ui/panels/FurnishPanel';
import { SmartHomePanel } from './smarthome/SmartHomePanel';
import { PropertiesPanel } from './ui/panels/PropertiesPanel';
import { BudgetPanel } from './ui/panels/BudgetPanel';
import { ProjectPanel } from './ui/panels/ProjectPanel';
import { useCatalogStore } from './catalog/catalogStore';
import { useImportStore } from './import/importStore';
import { PrintViewHost } from './export/PrintView';
import { useCompareStore } from './versions/compareStore';
import { WalkPostureBadge } from './view3d/WalkPostureBadge';
import { StartCard } from './ui/StartCard';
import { MobileBar } from './ui/MobileBar';
import { isEditableTarget, isPhoneLayout, usePhoneLayout, useTouchUi, type PhoneSheet } from './ui/phoneLayout';
import './ui/phone.css';

// The 3D scene (three.js) is loaded lazily so the 2D editor starts fast.
const Scene3D = lazy(() => import('./view3d/Scene3D').then((m) => ({ default: m.Scene3D })));

// on a phone the room should be visible right away: start in 3D instead of 2D + 3D side by side (#129)
if (isPhoneLayout() && useUiStore.getState().viewMode === 'split') useUiStore.setState({ viewMode: '3d' });

export default function App() {
  const [ready, setReady] = useState(false);
  useShortcuts();
  const autosave = useAutosave(ready);
  useEffect(() => noteSaveState(autosave.state), [autosave.state]);

  // restore the last project (or keep the sample project on first launch)
  useEffect(() => {
    (async () => {
      try {
        const id = await lastProjectId();
        if (id) {
          const res = await loadProject(id);
          if (res) useProjectStore.getState().load(res.project);
        } else {
          await saveProject(useProjectStore.getState().project);
        }
      } catch (e) {
        console.error(e);
        useUiStore.getState().toast('Das zuletzt geöffnete Projekt konnte nicht geladen werden – Beispielprojekt wird angezeigt.', 'error');
      } finally {
        void useCatalogStore.getState().load();
        useUiStore.getState().requestFit();
        setReady(true);
      }
    })();
  }, []);

  const uiViewMode = useUiStore((s) => s.viewMode);
  // before/after comparison (#76): 3D only, everything that edits is inert until it ends
  const comparing = useCompareStore((s) => s.session !== null);
  const viewMode = comparing ? '3d' : uiViewMode;
  const locked = comparing ? 'compare-locked' : undefined;
  const leftTab = useUiStore((s) => s.leftTab);
  const setLeftTab = useUiStore((s) => s.setLeftTab);
  const rightTab = useUiStore((s) => s.rightTab);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const hasDraft = useImportStore((s) => !!s.draft);
  // phone view (#129): plan/3D get the whole screen, the side panels open as a sheet from the bottom
  const phone = usePhoneLayout();
  const [sheet, setSheet] = useState<PhoneSheet>(null);
  const hasSelection = useUiStore((s) => s.selection !== null);
  const phoneClass = phone ? ` phone${sheet ? ` sheet-${sheet}` : ''}${hasSelection && !sheet ? ' has-selection' : ''}` : '';
  const [sheetHeight, setSheetHeight] = useState(0.55);
  // touch screens (#164): long press / drag must never select page text (iOS shows its
  // copy/look-up bubble then); input fields keep normal selection
  const touchUi = useTouchUi();
  useEffect(() => {
    if (!touchUi) return;
    const onSelectStart = (e: Event) => {
      if (!isEditableTarget(e.target)) e.preventDefault();
    };
    document.addEventListener('selectstart', onSelectStart);
    return () => document.removeEventListener('selectstart', onSelectStart);
  }, [touchUi]);
  const grip = phone ? <SheetGrip height={sheetHeight} onHeight={setSheetHeight} /> : null;

  return (
    <div className={`app${phoneClass}`} data-ready={ready} style={phone ? ({ '--sheet-height': `${Math.round(sheetHeight * 100)}%` } as CSSProperties) : undefined}>
      <div className={locked ? `app-header ${locked}` : 'app-header'} inert={comparing}>
        <Toolbar saveState={autosave.state} />
        {autosave.state === 'error' && autosave.error && <SaveErrorBanner reason={autosave.error} onRetry={autosave.retry} />}
      </div>
      <div className="main">
        <aside className={`panel left ${locked ?? ''}`.trim()} aria-label="Werkzeuge und Katalog" inert={comparing}>
          {grip}
          <nav className="tabs">
            {(
              [
                ['tools', 'Werkzeuge'],
                ['catalog', 'Katalog'],
                ['kitchen', 'Küche'],
                ['furnish', 'Einrichten'],
                ['smarthome', 'Smart Home'],
                ['import', hasDraft ? 'Import •' : 'Import'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={leftTab === id ? 'active' : ''} onClick={() => setLeftTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {leftTab === 'tools' && <ToolsPanel />}
          {leftTab === 'catalog' && <CatalogPanel />}
          {leftTab === 'kitchen' && <KitchenPanel />}
          {leftTab === 'furnish' && <FurnishPanel />}
          {leftTab === 'smarthome' && <SmartHomePanel />}
          {leftTab === 'import' && <ImportPanel />}
        </aside>
        <main className={`workspace view-${viewMode}`}>
          <StartCard />
          {viewMode !== '3d' && (
            <div className="pane pane-2d">
              <Editor2D />
            </div>
          )}
          {viewMode !== '2d' && (
            <div className="pane pane-3d">
              <Suspense fallback={<div className="empty-state">3D-Ansicht wird geladen…</div>}>
                <Scene3D />
              </Suspense>
              <WalkPostureBadge />
            </div>
          )}
        </main>
        <aside className={`panel right ${locked ?? ''}`.trim()} aria-label="Eigenschaften" inert={comparing}>
          {grip}
          <nav className="tabs">
            {(
              [
                ['properties', 'Eigenschaften'],
                ['budget', 'Budget'],
                ['project', 'Projekt'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={rightTab === id ? 'active' : ''} onClick={() => setRightTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {rightTab === 'properties' && <PropertiesPanel />}
          {rightTab === 'budget' && <BudgetPanel />}
          {rightTab === 'project' && <ProjectPanel />}
        </aside>
      </div>
      <div className={`compare-lock-contents ${locked ?? ''}`.trim()} inert={comparing}>
        {phone ? <MobileBar sheet={sheet} onSheet={setSheet} /> : <StatusBar />}
      </div>
      <ModalHost />
      <PrintViewHost />
      <Toasts />
      <FurnitureHoverCard />
    </div>
  );
}

/**
 * Griff oben am Handy-Blatt (#164): nach oben/unten ziehen ändert die Höhe (25–85 % des Platzes
 * unter der Werkzeugleiste); Plan/3D darüber werden entsprechend kleiner oder größer.
 */
function SheetGrip({ height, onHeight }: { height: number; onHeight: (h: number) => void }) {
  const drag = useRef<{ id: number; y: number; h: number; total: number } | null>(null);
  return (
    <div
      className="sheet-grip"
      role="slider"
      aria-label="Höhe des Blatts"
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={85}
      aria-valuenow={Math.round(height * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onHeight(Math.min(0.85, height + 0.1));
        if (e.key === 'ArrowDown') onHeight(Math.max(0.25, height - 0.1));
      }}
      onPointerDown={(e) => {
        const main = e.currentTarget.closest('.main');
        if (!main) return;
        drag.current = { id: e.pointerId, y: e.clientY, h: height, total: main.getBoundingClientRect().height };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        onHeight(Math.max(0.25, Math.min(0.85, d.h + (d.y - e.clientY) / d.total)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}
