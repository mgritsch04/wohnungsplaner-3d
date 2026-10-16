import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { BOOKMARK_KEYS, deleteCameraBookmark, jumpToBookmark, renameCameraBookmark, saveCurrentView, suggestBookmarkName } from './cameraBookmarks';

/**
 * "Ansichten" menu in the 3D view (#55): save the current view under a name, jump to a saved
 * view (also Alt+1 … Alt+9), rename and delete. Saving, renaming and deleting are one undo
 * step each; the bookmarks are part of the project.
 */
export function BookmarksMenu() {
  const bookmarks = useProjectStore((s) => s.project.cameraBookmarks);
  const [open, setOpen] = useState(false);
  /** Name being entered for a new bookmark (null = form closed). */
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // close on a click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setDraft(null);
        setEditing(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setDraft(null);
    setEditing(null);
  };
  const save = () => {
    if (draft === null) return;
    if (saveCurrentView(draft)) {
      useUiStore.getState().toast(`Ansicht „${draft.trim()}“ gespeichert`, 'success');
      setDraft(null);
    }
  };
  const commitRename = () => {
    if (editing) renameCameraBookmark(editing.id, editing.name);
    setEditing(null);
  };
  // Esc closes the form / menu without reaching the global shortcuts (deselect)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (editing) setEditing(null);
    else if (draft !== null) setDraft(null);
    else close();
  };

  return (
    <div
      ref={root}
      className="bookmarks-menu"
      data-testid="bookmarks-menu"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className={open ? 'active' : ''}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Gespeicherte Ansichten (Alt+1 … Alt+9)"
        onClick={() => (open ? close() : setOpen(true))}
      >
        Ansichten{bookmarks.length ? ` (${bookmarks.length})` : ''} ▾
      </button>
      {open && (
        <div className="bookmarks-popover" role="dialog" aria-label="Gespeicherte Ansichten">
          {draft === null ? (
            <button type="button" className="block bookmarks-save" onClick={() => setDraft(suggestBookmarkName(bookmarks))}>
              Aktuelle Ansicht speichern …
            </button>
          ) : (
            <form
              className="bookmarks-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                autoFocus
                aria-label="Name der Ansicht"
                maxLength={100}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              <button type="submit" className="primary" disabled={!draft.trim()}>
                Speichern
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                Abbrechen
              </button>
            </form>
          )}
          {bookmarks.length === 0 ? (
            <p className="bookmarks-empty">Noch keine Ansicht gespeichert.</p>
          ) : (
            <ol className="bookmarks-list">
              {bookmarks.map((b, i) => (
                <li key={b.id}>
                  {editing?.id === b.id ? (
                    <form
                      className="bookmarks-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        commitRename();
                      }}
                    >
                      <input
                        autoFocus
                        aria-label={`Neuer Name für „${b.name}“`}
                        maxLength={100}
                        value={editing.name}
                        onChange={(e) => setEditing({ id: b.id, name: e.target.value })}
                        onFocus={(e) => e.target.select()}
                      />
                      <button type="submit" className="primary" disabled={!editing.name.trim()}>
                        OK
                      </button>
                    </form>
                  ) : (
                    <>
                      <button type="button" className="bookmarks-jump" onClick={() => jumpToBookmark(b)} title={`Ansicht „${b.name}“ anspringen`}>
                        <span className="bookmarks-name">{b.name}</span>
                        <span className="bookmarks-meta">
                          {b.mode === 'walk' ? 'Begehen' : 'Übersicht'}
                          {i < BOOKMARK_KEYS && <kbd>Alt+{i + 1}</kbd>}
                        </span>
                      </button>
                      <button type="button" className="bookmarks-icon" onClick={() => setEditing({ id: b.id, name: b.name })} title="Umbenennen" aria-label={`„${b.name}“ umbenennen`}>
                        ✎
                      </button>
                      <button
                        type="button"
                        className="bookmarks-icon danger"
                        onClick={() => {
                          if (deleteCameraBookmark(b.id)) useUiStore.getState().toast(`Ansicht „${b.name}“ gelöscht (Strg+Z macht es rückgängig)`, 'info');
                        }}
                        title="Löschen"
                        aria-label={`„${b.name}“ löschen`}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
