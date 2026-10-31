import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildFeatures, type Feature } from './features';
import { searchEntries } from './match';
import { usePaletteStore } from './paletteStore';
import { useCompareStore } from '../../versions/compareStore';
import './search.css';

/** Strg+K / ⌘K opens the feature search from everywhere, also while typing in a field. */
export function useFeatureSearchShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        // the before/after comparison keeps everything that edits locked (#76)
        if (useCompareStore.getState().session) return;
        e.preventDefault();
        e.stopPropagation();
        const s = usePaletteStore.getState();
        s.setOpen(!s.open);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/**
 * Feature search (#461): a field at the top, a list of matching functions below. ↑/↓ choose,
 * Enter runs, Esc closes. Every result says where the function lives, so the search also
 * teaches the layout of the app.
 */
export function FeatureSearch() {
  const open = usePaletteStore((s) => s.open);
  if (!open) return null;
  return <FeatureSearchDialog />;
}

function FeatureSearchDialog() {
  const setOpen = usePaletteStore((s) => s.setOpen);
  const features = useMemo(() => buildFeatures(), []);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchEntries(features, query), [features, query]);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const restoreFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) restoreFocus.current?.focus?.();
  };
  const choose = (f: Feature | undefined) => {
    if (!f) return;
    close(false);
    // after the dialog is gone, so focus/scroll of the target is not disturbed
    requestAnimationFrame(() => f.run());
  };

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={() => close()}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Funktion suchen" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-field">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Funktion suchen"
            placeholder="Funktion suchen, z. B. Begehen, Übergabe, Dunkelmodus…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="search-results" id={listId} role="listbox" ref={listRef} aria-label="Treffer">
          {results.length === 0 && <li className="search-empty">Keine Funktion gefunden. Andere Worte versuchen, z. B. „Licht“ oder „Export“.</li>}
          {results.map((f, i) => (
            <li
              key={f.id}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => choose(f)}
            >
              <span className="search-group">{f.group}</span>
              <span className="search-title">{f.title}</span>
              {f.hint && <span className="search-hint">{f.hint}</span>}
              {f.keys && <kbd>{f.keys}</kbd>}
            </li>
          ))}
        </ul>
        <footer className="search-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> wählen
          </span>
          <span>
            <kbd>Enter</kbd> öffnen
          </span>
          <span>
            <kbd>Strg</kbd>+<kbd>K</kbd> jederzeit
          </span>
        </footer>
      </div>
    </div>
  );
}
