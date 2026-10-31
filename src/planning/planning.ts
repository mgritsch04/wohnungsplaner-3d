import { newId } from '../model/ids';
import type { DerivedPlan } from '../model/derived';
import type { FurniturePackage, Note, Project, Task } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';

/**
 * Notes as pins (#83), room task lists (#84) and the moving checklist (#91).
 * Every operation is one undo step. Tasks with `roomId` belong to a room, tasks without
 * `roomId` are steps of the project-wide moving checklist.
 */

const store = () => useProjectStore.getState();

/** Where a note's pin sits in the plan: room centre or furniture position; null if the target is gone. */
export function noteAnchor(project: Project, derived: DerivedPlan, note: Note): Vec2 | null {
  if (note.target.type === 'room') return derived.rooms.get(note.target.id)?.centroid ?? null;
  const f = project.furniture.find((x) => x.id === note.target.id);
  return f ? { x: f.x, y: f.y } : null;
}

export function notesOf(project: Project, type: 'room' | 'furniture', id: string): Note[] {
  return project.notes.filter((n) => n.target.type === type && n.target.id === id);
}

export function addNote(type: 'room' | 'furniture', targetId: string, text = ''): string {
  const id = newId('note');
  store().apply((d) => {
    d.notes.push({ id, target: { type, id: targetId }, text: text.slice(0, 500) });
  });
  return id;
}

export function updateNote(id: string, text: string) {
  store().apply((d) => {
    const n = d.notes.find((x) => x.id === id);
    if (n) n.text = text.slice(0, 500);
  });
}

export function deleteNote(id: string) {
  store().apply((d) => {
    d.notes = d.notes.filter((n) => n.id !== id);
  });
}

/** Tasks of one room, or (roomId undefined) the moving checklist. */
export function tasksOf(project: Project, roomId?: string): Task[] {
  return project.tasks.filter((t) => t.roomId === roomId);
}

export function addTask(roomId: string | undefined, text: string, due?: string): string {
  const id = newId('task');
  store().apply((d) => {
    d.tasks.push({ id, roomId, text: text.slice(0, 200), done: false, due });
  });
  return id;
}

export function updateTask(id: string, fn: (t: Task) => void) {
  store().apply((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (t) fn(t);
  });
}

export function deleteTask(id: string) {
  store().apply((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== id);
  });
}

/** Standard steps of a move; general hints only, no legal advice. */
export const MOVE_TEMPLATE: readonly string[] = [
  'Kündigungsfrist der alten Wohnung prüfen und kündigen',
  'Umzugstermin festlegen',
  'Umzugshelfer oder Transporter organisieren',
  'Halteverbot vor dem Haus klären',
  'Strom, Gas und Heizung ummelden',
  'Internet und Telefon ummelden oder neu einrichten',
  'Ummeldung beim Meldeamt',
  'Nachsendeauftrag einrichten',
  'Adressänderung an Bank, Versicherungen und Arbeitgeber melden',
  'Zählerstände beider Wohnungen notieren',
  'Übergabe der alten Wohnung mit Protokoll',
  'Einzug: Übergabeprotokoll der neuen Wohnung prüfen',
];

/** Adds the template steps that are not yet in the checklist (by text); returns how many were added. */
export function addMoveTemplate(): number {
  let added = 0;
  store().apply((d) => {
    const have = new Set(d.tasks.filter((t) => !t.roomId).map((t) => t.text));
    for (const text of MOVE_TEMPLATE) {
      if (have.has(text)) continue;
      d.tasks.push({ id: newId('task'), text, done: false });
      added++;
    }
  });
  return added;
}

export function taskProgress(tasks: Task[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** Overdue = not done and the date lies before `today` (YYYY-MM-DD). */
export function isOverdue(t: Task, today: string): boolean {
  return !t.done && !!t.due && t.due < today;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------- moving plan (#487) ----------

/** Set one building-access measurement (m); a value ≤ 0 clears it. */
export function setMoveAccess(key: keyof NonNullable<Project['moveAccess']>, value: number) {
  store().apply((d) => {
    const a = (d.moveAccess ??= {});
    if (value > 0) a[key] = value;
    else delete a[key];
  });
}

/** Tick a piece as set up / not set up in the moving plan. */
export function setMoveDone(furnitureId: string, done: boolean) {
  store().apply((d) => {
    const set = new Set(d.moveDone ?? []);
    if (done) set.add(furnitureId);
    else set.delete(furnitureId);
    d.moveDone = [...set];
  });
}

/** Package/part list of a piece (#487); an empty list removes the field. */
export function setPackages(furnitureId: string, packages: FurniturePackage[]) {
  store().apply((d) => {
    const f = d.furniture.find((x) => x.id === furnitureId);
    if (f) f.packages = packages.length ? packages.slice(0, 30) : undefined;
  });
}
