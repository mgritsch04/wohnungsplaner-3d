import { useEffect, useState } from 'react';
import { THEME_OPTIONS, THEME_STORAGE_KEY, applyThemePreference, loadThemePreference, saveThemePreference, type ThemePreference } from './themePreference';

/** Schalter hell / dunkel / System für die Bedienoberfläche (#73). Geräte-Einstellung, nicht im Projekt. */
export function ThemeControl() {
  const [pref, setPref] = useState<ThemePreference>(() => loadThemePreference());
  const [notSaved, setNotSaved] = useState(false);

  // another tab changed the setting → follow it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
      const next = loadThemePreference();
      setPref(next);
      applyThemePreference(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const choose = (next: ThemePreference) => {
    setPref(next);
    applyThemePreference(next);
    setNotSaved(!saveThemePreference(next));
  };

  return (
    <div className="field">
      <span className="field-label" id="theme-label">
        Farbschema
      </span>
      <div className="segmented" role="group" aria-labelledby="theme-label">
        {THEME_OPTIONS.map((o) => (
          <button key={o.value} type="button" className={pref === o.value ? 'active' : ''} aria-pressed={pref === o.value} title={o.title} onClick={() => choose(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        Gilt für die Bedienoberfläche auf diesem Gerät und wird nicht im Projekt gespeichert. 2D-Plan, 3D-Ansicht und Druckblatt behalten ihre Farben.
      </p>
      {notSaved && <p className="warn-text small">Die Einstellung konnte in diesem Browser nicht gespeichert werden und gilt nur bis zum Neuladen.</p>}
    </div>
  );
}
