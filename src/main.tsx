import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import './styles.css';
import { useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';
import { useImportStore, useSourceAnalysis } from './import/importStore';
import { usePerformanceStore } from './view3d/performanceStore';
import { installErrorCapture } from './ui/bugReport';
// temporary tool results (measuring lines, tape, walking path, viewpoint) follow the project (#133)
import './ui/projectSwitch';
import { useCameraRig } from './view3d/cameraBookmarks';
import { useObjectMenuStore } from './ui/objectMenu';
import { useCatalogStore } from './catalog/catalogStore';
import { applyMotionPreference, loadMotionPreference } from './ui/motionPreference';

installErrorCapture();
applyMotionPreference(loadMotionPreference());

// Test/debug hook: exposes the stores for end-to-end tests (?e2e) and during development.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  (window as unknown as Record<string, unknown>).__wp = { useProjectStore, useUiStore, useImportStore, useSourceAnalysis, usePerformanceStore, useCameraRig, useObjectMenuStore, useCatalogStore };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
