import { useState } from 'react';
import { CheckField } from './fields';
import { useAimHintStore } from './aimHintPreference';

/** Schalter für den Hinweistext unter dem Fadenkreuz (#263). Geräte-Einstellung, nicht im Projekt. */
export function AimHintControl() {
  const visible = useAimHintStore((s) => s.visible);
  const [notSaved, setNotSaved] = useState(false);
  return (
    <>
      <CheckField
        label="Hinweistext in 3D anzeigen"
        checked={visible}
        onChange={(v) => setNotSaved(!useAimHintStore.getState().setVisible(v))}
        title="Entfernung und Höhe des Punkts unter dem Fadenkreuz beim Begehen mit „Gefühlt echt“ ein- oder ausblenden"
      />
      {notSaved && <p className="muted small">Die Einstellung konnte nicht gespeichert werden und gilt nur bis zum Neuladen.</p>}
    </>
  );
}
