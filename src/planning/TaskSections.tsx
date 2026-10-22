import type { Project } from '../model/schema';
import { Section } from '../ui/fields';
import { addMoveTemplate, tasksOf } from './planning';
import { TaskList } from './TaskList';

/** Task list of the selected room (#84). */
export function RoomTasksSection({ project, roomId }: { project: Project; roomId: string }) {
  return (
    <Section title="Aufgaben">
      <TaskList tasks={tasksOf(project, roomId)} roomId={roomId} empty="Noch keine Aufgaben – z. B. „Streichen“ oder „Vorhang messen“." />
    </Section>
  );
}

/** Project-wide moving checklist with template and dates (#91). */
export function MoveChecklistSection({ project }: { project: Project }) {
  const tasks = tasksOf(project, undefined);
  return (
    <Section
      title="Umzugs-Checkliste"
      actions={
        <button type="button" onClick={() => addMoveTemplate()} title="Fügt allgemeine Standardschritte hinzu (ohne Rechtsberatung)">
          Vorlage einfügen
        </button>
      }
    >
      <TaskList tasks={tasks} withDates empty="Leer. „Vorlage einfügen“ legt allgemeine Standardschritte an; Termine setzt du selbst." />
      <p className="muted small">Allgemeine Schritte ohne Gewähr – Fristen und Pflichten bitte selbst prüfen.</p>
    </Section>
  );
}
