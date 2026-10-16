import { groupName, groupOf, selectedGroup } from '../../model/groups';
import { useProjectStore } from '../../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../../store/uiStore';
import { TextField } from '../fields';
import { groupSelection, removeItemFromGroup, renameGroupAction, rotateSelectedGroup, selectGroupOf, ungroupSelection } from '../groupActions';

const ROTATIONS: { delta: number; label: string; title: string }[] = [
  { delta: -Math.PI / 2, label: '⟲ 90°', title: 'Gruppe 90° gegen den Uhrzeigersinn drehen' },
  { delta: -Math.PI / 12, label: '⟲ 15°', title: 'Gruppe 15° gegen den Uhrzeigersinn drehen (Taste Q)' },
  { delta: Math.PI / 12, label: '⟳ 15°', title: 'Gruppe 15° im Uhrzeigersinn drehen (Taste E)' },
  { delta: Math.PI / 2, label: '⟳ 90°', title: 'Gruppe 90° im Uhrzeigersinn drehen' },
];

/**
 * Furniture groups (#65) in the properties panel: „Gruppieren“ for a multi-selection; name,
 * turning and „Gruppe auflösen“ for a selected group; for a single member its group.
 */
export function GroupControls() {
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const multi = useUiStore((s) => s.multi);
  const ids = selectedFurnitureIds({ selection, multi });
  if (!ids.length) return null;
  const gid = selectedGroup(project, ids);

  if (gid) {
    const locked = project.furniture.some((f) => ids.includes(f.id) && f.locked);
    return (
      <section className="panel-section group-controls" data-testid="group-controls" data-group-id={gid}>
        <header>
          <h3>Gruppe</h3>
        </header>
        <div className="panel-section-body">
          <TextField label="Name der Gruppe" value={groupName(project, gid)} onChange={(v) => renameGroupAction(gid, v)} />
          <p className="muted small">
            Drehen um die Gruppenmitte (auch Q/E oder Griff über der Umrandung im 2D-Plan). Ein zweiter Klick auf ein Möbel wählt es einzeln.
            {locked && ' Ein Möbel der Gruppe ist gesperrt – die Gruppe bleibt stehen.'}
          </p>
          <span className="rotate-group" role="group" aria-label="Gruppe drehen">
            {ROTATIONS.map((r) => (
              <button key={r.label} type="button" title={r.title} disabled={locked} onClick={() => rotateSelectedGroup(r.delta)}>
                {r.label}
              </button>
            ))}
          </span>
          <div className="btn-row">
            <button type="button" onClick={ungroupSelection} title="Strg+Umschalt+G – die Möbel bleiben an ihrem Platz">
              Gruppe auflösen
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (ids.length >= 2) {
    return (
      <section className="panel-section group-controls" data-testid="group-controls">
        <header>
          <h3>Gruppe</h3>
        </header>
        <div className="panel-section-body">
          <p className="muted small">Zusammengehörige Möbel (z. B. Küchenzeile, Essgruppe) dauerhaft zusammenfassen: dann gemeinsam auswählen, verschieben und drehen.</p>
          <div className="btn-row">
            <button type="button" onClick={groupSelection} title="Strg+G">
              Gruppieren
            </button>
          </div>
        </div>
      </section>
    );
  }

  const member = groupOf(project, ids[0]);
  if (!member) return null;
  return (
    <section className="panel-section group-controls" data-testid="group-controls" data-group-id={member}>
      <header>
        <h3>Gruppe</h3>
      </header>
      <div className="panel-section-body">
        <p className="muted small">
          Teil der Gruppe „{groupName(project, member)}“. Änderungen hier betreffen nur dieses Möbel.
        </p>
        <div className="btn-row">
          <button type="button" onClick={() => selectGroupOf(ids[0])}>
            Ganze Gruppe auswählen
          </button>
          <button type="button" onClick={() => removeItemFromGroup(ids[0])} title="Das Möbel gehört danach nicht mehr zur Gruppe">
            Aus der Gruppe lösen
          </button>
        </div>
      </div>
    </section>
  );
}
