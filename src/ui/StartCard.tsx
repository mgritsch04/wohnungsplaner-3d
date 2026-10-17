import { create } from 'zustand';
import type { Project } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useImportStore } from '../import/importStore';
import { importPlanFile } from '../import/underlayImport';
import { newProject } from './actions';

/**
 * Start card for empty projects (#102): the first steps instead of an empty plan.
 * Shown while the project has no walls, rooms, furniture or plan underlay; it disappears as soon as
 * something is placed. Closing it is remembered per project (in this browser);
 * a small "Erste Schritte" button (and "Projekt ▾ › Erste Schritte") brings it back while
 * the project is still empty.
 */

export const isProjectEmpty = (p: Pick<Project, 'walls' | 'rooms' | 'furniture'>) => p.walls.length === 0 && p.rooms.length === 0 && p.furniture.length === 0;

const KEY = 'wohnungsplaner-startcard-closed';

/** localStorage may be missing or throw (privacy mode, blocked site data) – then closing lasts for this session only. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readClosedIds(s: Storage | null = storage()): string[] {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeClosed(projectId: string, closed: boolean, s: Storage | null = storage()): string[] {
  const ids = readClosedIds(s).filter((id) => id !== projectId);
  if (closed) ids.push(projectId);
  const kept = ids.slice(-200); // bounded
  try {
    s?.setItem(KEY, JSON.stringify(kept));
  } catch {
    // ignore – the in-memory state still hides the card
  }
  return kept;
}

/** Closed state shared by the card and the toolbar's "Projekt ▾ › Erste Schritte" entry (#100). */
const useStartCardStore = create<{ closed: string[]; setClosed: (projectId: string, closed: boolean) => void }>((set) => ({
  closed: readClosedIds(),
  setClosed: (projectId, closed) => set({ closed: writeClosed(projectId, closed) }),
}));

/** Shows the start card of this project again (it only appears while the project is empty). */
export const reopenStartCard = (projectId: string) => useStartCardStore.getState().setClosed(projectId, false);

export function StartCard() {
  const project = useProjectStore((s) => s.project);
  const closed = useStartCardStore((s) => s.closed);
  const importing = useImportStore((s) => !!s.draft || !!s.progress);
  // a loaded plan underlay or a running import is a first step too – the card would only cover the plan (#214)
  if (!isProjectEmpty(project) || project.underlay || importing) return null;
  const setFor = (v: boolean) => useStartCardStore.getState().setClosed(project.id, v);

  if (closed.includes(project.id)) {
    return (
      <button className="start-card-reopen" onClick={() => setFor(false)} data-testid="start-card-reopen">
        Erste Schritte
      </button>
    );
  }

  const ui = useUiStore.getState;
  return (
    <section className="start-card" role="region" aria-label="Erste Schritte" data-testid="start-card">
      <button className="start-card-close" onClick={() => setFor(true)} aria-label="Startkarte schließen" title="Schließen">
        ×
      </button>
      <h2>Los geht’s – das Projekt ist noch leer</h2>
      <p className="muted small">Drei Wege zum ersten Grundriss:</p>
      <ol className="start-card-steps">
        <li>
          <button onClick={() => void importPlanFile()}>Grundriss importieren</button>
          <span className="muted small">Plan als PDF oder Bild laden, Maßstab setzen, Wände übernehmen.</span>
        </li>
        <li>
          <button
            className="primary"
            onClick={() => {
              ui().setLeftTab('tools');
              ui().setTool('room');
            }}
          >
            Raum zeichnen
          </button>
          <span className="muted small">Rechteck im Plan aufziehen oder Innenmaße links eingeben.</span>
        </li>
        <li>
          <button onClick={() => void newProject(true)}>Beispielwohnung laden</button>
          <span className="muted small">Fertige Wohnung zum Ausprobieren – dieses Projekt bleibt in der Projektliste.</span>
        </li>
      </ol>
    </section>
  );
}
