import { useState } from 'react';
import type { Task } from '../model/schema';
import { addTask, deleteTask, isOverdue, taskProgress, todayIso, updateTask } from './planning';
import { usePlanningStore } from './planningStore';

/** Checkable list with optional dates; shared by room tasks (#84) and the moving checklist (#91). */
export function TaskList({ tasks, roomId, withDates, empty }: { tasks: Task[]; roomId?: string; withDates?: boolean; empty: string }) {
  const hideDone = usePlanningStore((s) => s.hideDone);
  const setHideDone = usePlanningStore((s) => s.setHideDone);
  const [text, setText] = useState('');
  const { done, total } = taskProgress(tasks);
  const today = todayIso();
  const shown = hideDone ? tasks.filter((t) => !t.done) : tasks;
  const add = () => {
    const t = text.trim();
    if (!t) return;
    addTask(roomId, t);
    setText('');
  };
  return (
    <div data-testid="task-list">
      <p className="muted small" data-testid="task-progress">
        {total === 0 ? empty : `${done} von ${total} erledigt`}
      </p>
      {done > 0 && (
        <label className="check small">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Erledigte ausblenden
        </label>
      )}
      <ul className="plain-list">
        {shown.map((t) => (
          <li key={t.id} data-testid="task-row" data-done={t.done ? 'true' : 'false'} className="field-row">
            <label className="check">
              <input type="checkbox" aria-label={`${t.text} erledigt`} checked={t.done} onChange={(e) => updateTask(t.id, (x) => void (x.done = e.target.checked))} />
              <span style={t.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{t.text}</span>
            </label>
            {withDates && (
              <input
                type="date"
                aria-label={`Datum für ${t.text}`}
                value={t.due ?? ''}
                style={isOverdue(t, today) ? { borderColor: 'var(--color-plan-warn)' } : undefined}
                onChange={(e) => updateTask(t.id, (x) => void (x.due = e.target.value || undefined))}
              />
            )}
            <button type="button" onClick={() => deleteTask(t.id)} title="Punkt entfernen" aria-label={`${t.text} entfernen`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="field-row">
        <input
          aria-label="Neuer Punkt"
          type="text"
          maxLength={200}
          value={text}
          placeholder="Neuer Punkt, z. B. Streichen"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          Hinzufügen
        </button>
      </div>
    </div>
  );
}
