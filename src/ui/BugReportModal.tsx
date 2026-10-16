import { useMemo, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useDialogStore } from './dialogStore';
import { buildBugReport, currentEnv, currentSaveState, newIssueUrl, recentErrorMessages } from './bugReport';

const SAVE_LABEL: Record<string, string> = { saved: 'gespeichert', pending: 'Änderungen ausstehend', saving: 'speichert …', error: 'Fehler beim Speichern' };

/** "Problem melden" (#62): shows the report, copies it, or opens a prefilled GitHub issue. */
export function BugReportModal() {
  const close = useDialogStore((s) => s.closeModal);
  const project = useProjectStore((s) => s.project);
  const [description, setDescription] = useState('');
  const [includeProject, setIncludeProject] = useState(false);
  const env = useMemo(() => currentEnv(), []);
  const errors = useMemo(() => recentErrorMessages(), []);
  const ui = useUiStore.getState();
  const report = buildBugReport({
    version: __APP_VERSION__,
    env,
    project,
    errors,
    description,
    includeProject,
    state: {
      viewMode: ui.viewMode,
      cameraMode: ui.cameraMode,
      tool: ui.tool,
      selection: ui.selection ? ui.selection.type : 'nichts',
      saveState: SAVE_LABEL[currentSaveState()] ?? currentSaveState(),
    },
  });
  const title = `Problem: ${description.trim().split('\n')[0].slice(0, 70) || '…'}`;
  const issue = newIssueUrl(title, report);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      useUiStore.getState().toast('Bericht kopiert', 'success');
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="bug-report-text"]');
      ta?.select();
      useUiStore.getState().toast('Kopieren nicht erlaubt – Text ist markiert, bitte Strg+C drücken.', 'info');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Problem melden" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header className="modal-head">
          <h2>Problem melden</h2>
          <button onClick={close} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>Was ist passiert?</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="z. B. Beim Ziehen des Sofas in 3D springt es zur Wand" />
          </label>
          <label className="check">
            <input type="checkbox" checked={includeProject} onChange={(e) => setIncludeProject(e.target.checked)} />
            Projektdaten anfügen (Grundriss, Möbelnamen, Preise, Links – nur wenn du das teilen möchtest)
          </label>
          <p className="muted small">
            Der Bericht enthält Browser, Bildschirmgröße, App-Version, Ansicht und Anzahl der Objekte. Ohne Häkchen keine Namen, Adressen oder Projektinhalte.
          </p>
          <textarea className="bug-report-text" rows={12} readOnly value={report} data-testid="bug-report-text" aria-label="Bericht" />
          <div className="btn-row end">
            <button onClick={() => void copy()}>Bericht kopieren</button>
            <button className="primary" onClick={() => window.open(issue.url, '_blank', 'noopener,noreferrer')}>
              Issue auf GitHub öffnen{issue.bodyIncluded ? '' : ' (Bericht danach einfügen)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
