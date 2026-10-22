import { useState } from 'react';
import { CheckField } from './fields';
import { useHintsStore } from './hintsPreference';

/** Schalter für die Info-Symbole (ⓘ) (#79). Geräte-Einstellung, nicht im Projekt. */
export function HintsControl() {
  const visible = useHintsStore((s) => s.visible);
  const [notSaved, setNotSaved] = useState(false);
  return (
    <>
      <CheckField label="Info-Symbole (ⓘ) anzeigen" checked={visible} onChange={(v) => setNotSaved(!useHintsStore.getState().setVisible(v))} title="Kurze Erklärungen zu Begriffen wie Realismus oder Tageszeit ein- oder ausblenden" />
      {notSaved && <p className="muted small">Die Einstellung konnte nicht gespeichert werden und gilt nur bis zum Neuladen.</p>}
    </>
  );
}
