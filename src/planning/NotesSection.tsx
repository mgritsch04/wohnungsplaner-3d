import type { Project } from '../model/schema';
import { Section } from '../ui/fields';
import { addNote, deleteNote, notesOf, updateNote } from './planning';
import { usePlanningStore } from './planningStore';

/** Notes pinned to the selected room or furniture (#83), under „Eigenschaften“. */
export function NotesSection({ project, type, targetId }: { project: Project; type: 'room' | 'furniture'; targetId: string }) {
  const notes = notesOf(project, type, targetId);
  const setOpen = usePlanningStore((s) => s.setOpenNote);
  return (
    <Section
      title="Notizen"
      actions={
        <button type="button" onClick={() => setOpen(addNote(type, targetId))}>
          + Notiz
        </button>
      }
    >
      {notes.length === 0 && <p className="muted small">Keine Notiz. „+ Notiz“ heftet einen Pin an – er erscheint im Plan und zeigt den Text beim Anklicken.</p>}
      <ul className="plain-list">
        {notes.map((n) => (
          <li key={n.id} data-testid="note-row" className="field-row">
            <textarea
              aria-label="Notiz"
              rows={2}
              maxLength={500}
              value={n.text}
              placeholder="z. B. Lampe bestellen"
              onFocus={() => setOpen(n.id)}
              onChange={(e) => updateNote(n.id, e.target.value)}
            />
            <button type="button" className="danger" onClick={() => deleteNote(n.id)} title="Notiz löschen">
              Löschen
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
