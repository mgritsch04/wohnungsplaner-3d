import { lazy, Suspense, useEffect, useState } from 'react';
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
import { PropertiesPanel } from './ui/panels/PropertiesPanel';
import { BudgetPanel } from './ui/panels/BudgetPanel';
import { ProjectPanel } from './ui/panels/ProjectPanel';
import { useCatalogStore } from './catalog/catalogStore';
import { useImportStore } from './import/importStore';
import { PrintViewHost } from './export/PrintView';
import { StartCard } from './ui/StartCard';

// The 3D scene (three.js) is loaded lazily so the 2D editor starts fast.
const Scene3D = lazy(() => import('./view3d/Scene3D').then((m) => ({ default: m.Scene3D })));

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

  const viewMode = useUiStore((s) => s.viewMode);
  const leftTab = useUiStore((s) => s.leftTab);
  const setLeftTab = useUiStore((s) => s.setLeftTab);
  const rightTab = useUiStore((s) => s.rightTab);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const hasDraft = useImportStore((s) => !!s.draft);

  return (
    <div className="app">
      <div className="app-header">
        <Toolbar saveState={autosave.state} />
        {autosave.state === 'error' && autosave.error && <SaveErrorBanner reason={autosave.error} onRetry={autosave.retry} />}
      </div>
      <div className="main">
        <aside className="panel left" aria-label="Werkzeuge und Katalog">
          <nav className="tabs">
            {(
              [
                ['tools', 'Werkzeuge'],
                ['catalog', 'Katalog'],
                ['kitchen', 'Küche'],
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
            </div>
          )}
        </main>
        <aside className="panel right" aria-label="Eigenschaften">
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
      <StatusBar />
      <ModalHost />
      <PrintViewHost />
      <Toasts />
      <FurnitureHoverCard />
    </div>
  );
}
