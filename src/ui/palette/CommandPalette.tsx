import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogStore } from '../dialogStore';
import { useUiStore } from '../../store/uiStore';
import { buildCommands, type Command } from './commands';
import { searchCommands } from './search';

const RECENT_KEY = 'wohnplan.palette.recent';
const MAX_RECENT = 5;

function readRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function writeRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, MAX_RECENT)));
  } catch {
    /* private mode / blocked storage: the palette works without */
  }
}

const isEnabled = (c: Command) => (c.enabled ? c.enabled() : true);

/**
 * Command palette (Strg+K): search all functions of the app by name or synonym and run them
 * directly. Arrow keys choose, Enter runs, Esc closes.
 */
export function CommandPalette() {
  const close = () => useDialogStore.getState().setPaletteOpen(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const all = useMemo(() => buildCommands(), []);
  const recent = useMemo(() => readRecent(), []);

  const { rows, recentCount } = useMemo(() => {
    if (query.trim()) {
      const found = searchCommands(query, all);
      // runnable commands first, unavailable ones (greyed out) at the end
      return { rows: [...found.filter(isEnabled), ...found.filter((c) => !isEnabled(c))], recentCount: 0 };
    }
    const byId = new Map(all.map((c) => [c.id, c]));
    const rec = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c && isEnabled(c));
    return { rows: [...rec, ...all.filter((c) => !rec.includes(c))], recentCount: rec.length };
  }, [query, all, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, rows]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    if (!isEnabled(c)) {
      useUiStore.getState().toast(c.why ?? 'Gerade nicht verfügbar', 'info');
      return;
    }
    close();
    writeRecent(c.id);
    // run after the palette is gone, so dialogs / file pickers opened by the command keep the focus
    setTimeout(() => void Promise.resolve(c.run()).catch((e) => useUiStore.getState().toast(`${c.label}: ${e instanceof Error ? e.message : String(e)}`, 'error')), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[active]);
    }
  };

  const trimmed = query.trim();
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Funktionen suchen" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          className="palette-input"
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={rows[active] ? `palette-${rows[active].id}` : undefined}
          aria-label="Funktion suchen"
          placeholder="Funktion suchen, z. B. „Wand“, „Export“, „Budget“ …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {rows.length === 0 && <li className="palette-empty">Nichts gefunden. Anderes Wort versuchen, z. B. „Tür“, „Drucken“ oder „Rückgängig“.</li>}
          {rows.map((c, i) => {
            const enabled = isEnabled(c);
            const heading = trimmed
              ? null
              : i === 0 && recentCount > 0
                ? 'Zuletzt benutzt'
                : i >= recentCount && (i === recentCount || rows[i - 1].group !== c.group)
                  ? c.group
                  : null;
            return (
              <li key={c.id} role="presentation">
                {heading && <div className="palette-heading">{heading}</div>}
                <div
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={!enabled}
                  className={`palette-item${i === active ? ' active' : ''}${enabled ? '' : ' disabled'}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(c)}
                >
                  <span className="palette-label">{c.label}</span>
                  {trimmed && <span className="palette-group">{c.group}</span>}
                  {!enabled && c.why && <span className="palette-why">{c.why}</span>}
                  {c.shortcut && enabled && <kbd>{c.shortcut}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot">↑↓ wählen · Enter ausführen · Esc schließen</div>
      </div>
    </div>
  );
}
