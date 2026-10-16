import { Component, type ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { downloadBlob } from './fileUtils';

/** Last-resort error screen that lets the user rescue their project data. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Unerwarteter Fehler', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Es ist ein unerwarteter Fehler aufgetreten</h1>
        <p>{this.state.error.message}</p>
        <p>Deine Daten sind lokal gespeichert. Du kannst das aktuelle Projekt zur Sicherheit herunterladen und die Seite neu laden.</p>
        <div className="btn-row">
          <button onClick={() => downloadBlob(JSON.stringify(useProjectStore.getState().project), 'projekt-sicherung.json')}>Projekt herunterladen</button>
          <button
            onClick={() => {
              // try undoing the last change, which may have caused the problem
              useProjectStore.getState().undo();
              this.setState({ error: null });
            }}
          >
            Letzte Änderung rückgängig & weiter
          </button>
          <button className="primary" onClick={() => location.reload()}>
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
