import { useId, useState } from 'react';
import { HELP_TEXTS, type HelpId } from './helpTexts';
import { useHintsStore } from './hintsPreference';

/** Kleines ⓘ neben einem Bedienelement; Klick blendet die kurze Erklärung ein und wieder aus (#79). */
export function InfoHint({ id }: { id: HelpId }) {
  const visible = useHintsStore((s) => s.visible);
  const [open, setOpen] = useState(false);
  const textId = useId();
  if (!visible) return null;
  const { term, text } = HELP_TEXTS[id];
  return (
    <span className="info-hint">
      <button type="button" className="info-hint-btn" aria-label={`Erklärung: ${term}`} aria-expanded={open} aria-controls={textId} title={`Was ist „${term}“?`} onClick={() => setOpen((o) => !o)}>
        ⓘ
      </button>
      {open && (
        <span id={textId} className="info-hint-text" role="note">
          {text}
        </span>
      )}
    </span>
  );
}
