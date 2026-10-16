import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import './styles.css';
import { useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';
import { useImportStore } from './import/importStore';
import { installErrorCapture } from './ui/bugReport';

installErrorCapture();

// Test/debug hook: exposes the stores for end-to-end tests (?e2e) and during development.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  (window as unknown as Record<string, unknown>).__wp = { useProjectStore, useUiStore, useImportStore };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
