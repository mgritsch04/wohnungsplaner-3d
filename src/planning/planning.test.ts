import { beforeEach, describe, expect, it } from 'vitest';
import { migrateProjectObject, parseProject } from '../formats/project/projectFile';
import { createSampleProject } from '../model/sample';
import { derivePlan } from '../model/derived';
import { deleteFurniture, deleteRoom } from '../model/operations';
import { PROJECT_SCHEMA_VERSION } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { addMoveTemplate, addNote, addTask, deleteNote, isOverdue, MOVE_TEMPLATE, noteAnchor, notesOf, taskProgress, tasksOf, updateNote, updateTask } from './planning';

const load = () => useProjectStore.getState().load(createSampleProject());
const proj = () => useProjectStore.getState().project;

describe('Notizen, Aufgaben, Umzugs-Checkliste', () => {
  beforeEach(load);

  it('heftet Notizen an Raum und Möbel, bearbeitet und löscht sie', () => {
    const room = proj().rooms[0];
    const f = proj().furniture[0];
    const n1 = addNote('room', room.id, 'Streichen');
    const n2 = addNote('furniture', f.id, 'Lampe bestellen');
    expect(notesOf(proj(), 'room', room.id)).toHaveLength(1);
    updateNote(n2, 'Lampe bestellen!');
    expect(proj().notes.find((n) => n.id === n2)?.text).toBe('Lampe bestellen!');
    const derived = derivePlan(proj());
    expect(noteAnchor(proj(), derived, proj().notes.find((n) => n.id === n2)!)).toEqual({ x: f.x, y: f.y });
    expect(noteAnchor(proj(), derived, proj().notes.find((n) => n.id === n1)!)).not.toBeNull();
    deleteNote(n1);
    expect(proj().notes).toHaveLength(1);
  });

  it('entfernt Notizen und Aufgaben mit ihrem Raum bzw. Möbel', () => {
    const room = proj().rooms[0];
    const f = proj().furniture[0];
    addNote('room', room.id, 'a');
    addNote('furniture', f.id, 'b');
    addTask(room.id, 'Streichen');
    addTask(undefined, 'Ummeldung');
    const d = structuredClone(proj());
    deleteFurniture(d, [f.id]);
    expect(d.notes).toHaveLength(1);
    deleteRoom(d, room.id);
    expect(d.notes).toHaveLength(0);
    expect(d.tasks.map((t) => t.text)).toEqual(['Ummeldung']);
  });

  it('trennt Raumaufgaben von der Umzugs-Checkliste und zählt Fortschritt', () => {
    const room = proj().rooms[0];
    const t = addTask(room.id, 'Vorhang messen');
    addTask(undefined, 'Kündigen', '2026-11-01');
    expect(tasksOf(proj(), room.id)).toHaveLength(1);
    expect(tasksOf(proj(), undefined)).toHaveLength(1);
    updateTask(t, (x) => void (x.done = true));
    expect(taskProgress(tasksOf(proj(), room.id))).toEqual({ done: 1, total: 1 });
  });

  it('Vorlage fügt Standardschritte einmalig ein', () => {
    expect(addMoveTemplate()).toBe(MOVE_TEMPLATE.length);
    expect(addMoveTemplate()).toBe(0);
    expect(tasksOf(proj(), undefined)).toHaveLength(MOVE_TEMPLATE.length);
  });

  it('erkennt überfällige Schritte', () => {
    const t = { id: 'x', text: 't', done: false, due: '2026-10-01' };
    expect(isOverdue(t, '2026-10-22')).toBe(true);
    expect(isOverdue({ ...t, done: true }, '2026-10-22')).toBe(false);
    expect(isOverdue({ ...t, due: undefined }, '2026-10-22')).toBe(false);
  });

  it('übersteht Speichern/Laden und migriert Schema 3', () => {
    addNote('room', proj().rooms[0].id, 'x');
    addTask(undefined, 'y', '2026-11-02');
    const again = parseProject(JSON.parse(JSON.stringify(proj())));
    expect(again.project.notes).toHaveLength(1);
    expect(again.project.tasks[0].due).toBe('2026-11-02');
    const v3 = { ...JSON.parse(JSON.stringify(createSampleProject())), schemaVersion: 3 };
    delete v3.notes;
    delete v3.tasks;
    expect(migrateProjectObject(v3)).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, notes: [], tasks: [] });
  });
});
