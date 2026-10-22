import { useEffect, useState } from 'react';
import { MOTION_OPTIONS, MOTION_STORAGE_KEY, applyMotionPreference, loadMotionPreference, saveMotionPreference, type MotionPreference } from './motionPreference';

/** Schalter Animationen System / An / Aus (#101). Geräte-Einstellung, nicht im Projekt. */
export function MotionControl() {
  const [pref, setPref] = useState<MotionPreference>(() => loadMotionPreference());
  const [notSaved, setNotSaved] = useState(false);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== MOTION_STORAGE_KEY) return;
      const next = loadMotionPreference();
      setPref(next);
      applyMotionPreference(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const choose = (next: MotionPreference) => {
    setPref(next);
    applyMotionPreference(next);
    setNotSaved(!saveMotionPreference(next));
  };

  return (
    <div className="field">
      <span className="field-label" id="motion-label">
        Animationen
      </span>
      <div className="segmented" role="group" aria-labelledby="motion-label">
        {MOTION_OPTIONS.map((o) => (
          <button key={o.value} type="button" className={pref === o.value ? 'active' : ''} aria-pressed={pref === o.value} title={o.title} onClick={() => choose(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted small">Sanfte Übergänge bei Dialogen, Panels und Kamerawechseln. „Aus“ hilft bei Bewegungsempfindlichkeit. Gilt nur in diesem Browser.</p>
      {notSaved && <p className="warn-text small">Dieser Browser erlaubt kein dauerhaftes Ablegen – die Wahl gilt nur bis zum Neuladen.</p>}
    </div>
  );
}
