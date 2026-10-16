import { exportPackage } from './actions';

/**
 * Clearly visible warning when the automatic save failed (#60): what happened, that the
 * latest changes are not secured yet, and what to do. Disappears after the next successful save.
 */
export function SaveErrorBanner({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="save-error-banner" role="alert" data-testid="save-error-banner">
      <strong>Speichern fehlgeschlagen – deine letzten Änderungen sind noch nicht gesichert.</strong>
      <span>{reason}</span>
      <span>Exportiere das Projekt jetzt als Datei, damit nichts verloren geht, und versuche es dann erneut.</span>
      <span className="btn-row">
        <button className="primary" onClick={() => void exportPackage()}>
          Jetzt als Datei exportieren
        </button>
        <button onClick={onRetry}>Erneut speichern</button>
      </span>
    </div>
  );
}
