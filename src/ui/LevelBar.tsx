import { useState } from 'react';
import { DEFAULT_STOREY_HEIGHT, sortedLevels, storeyHeight } from '../model/levels';
import { useProjectStore } from '../store/projectStore';
import { useUiStore, type OtherLevels } from '../store/uiStore';
import { useCompareStore } from '../versions/compareStore';
import { CheckField, NumberField, Section, TextField } from './fields';
import { InfoHint } from './InfoHint';
import { changeLevelElevation, createLevel, goToLevel, removeLevel, renameLevelTo } from './levelActions';

const OTHER_LEVELS: { value: OtherLevels; label: string; title: string }[] = [
  { value: 'below', label: 'darunter', title: 'In 3D die Etagen unter der aktuellen zeigen' },
  { value: 'all', label: 'alle', title: 'In 3D alle Etagen zeigen' },
  { value: 'none', label: 'keine', title: 'In 3D nur die aktuelle Etage zeigen' },
];

/**
 * Storey switch over the plan and the 3D view (#54), like the buttons of a lift: the highest
 * storey on top. Shown only when the project has more than one storey; storeys are added in
 * Projekt › Etagen.
 */
export function LevelBar() {
  const levels = useProjectStore((s) => s.project.levels);
  const active = useProjectStore((s) => s.project.activeLevelId);
  const comparing = useCompareStore((s) => s.session !== null);
  const viewMode = useUiStore((s) => s.viewMode);
  const other = useUiStore((s) => s.otherLevels);
  const setOther = useUiStore((s) => s.setOtherLevels);
  if (levels.length < 2 || comparing) return null;
  const top = [...sortedLevels({ levels })].reverse();
  return (
    <div className="level-bar" role="group" aria-label="Etage" data-testid="level-bar">
      {top.map((l) => (
        <button
          key={l.id}
          className={l.id === active ? 'active' : ''}
          aria-pressed={l.id === active}
          title={`${l.name} (Fußboden ${formatM(l.elevation)}) – Bild auf/Bild ab wechselt die Etage`}
          onClick={() => goToLevel(l.id)}
        >
          {l.name}
        </button>
      ))}
      {viewMode !== '2d' && (
        <label className="level-bar-other" title="Welche anderen Etagen die 3D-Ansicht zeigt">
          <span>3D:</span>
          <select value={other} onChange={(e) => setOther(e.target.value as OtherLevels)} data-testid="other-levels">
            {OTHER_LEVELS.map((o) => (
              <option key={o.value} value={o.value} title={o.title}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function formatM(m: number): string {
  return `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(2).replace('.', ',')} m`;
}

/** Projekt › Etagen (#54): add, name, set the floor height, remove and switch storeys. */
export function LevelsSection() {
  const project = useProjectStore((s) => s.project);
  const [copyWalls, setCopyWalls] = useState(true);
  const levels = [...sortedLevels(project)].reverse();
  const single = project.levels.length === 1;
  return (
    <Section title="Etagen" actions={<InfoHint id="levels" />}>
      {single && <p className="muted small">Für ein Haus mit mehreren Geschossen: Etage darüber oder darunter anlegen. Wechseln dann über die Etagen-Knöpfe am Plan oder Bild auf/Bild ab.</p>}
      <ul className="level-list" data-testid="level-list">
        {levels.map((l) => {
          const isActive = l.id === project.activeLevelId;
          return (
            <li key={l.id} className={isActive ? 'active' : ''} data-testid="level-row" data-level-id={l.id}>
              <TextField label={isActive ? 'Name (aktuelle Etage)' : 'Name'} value={l.name} onChange={(v) => renameLevelTo(l.id, v)} />
              <NumberField
                label="Fußbodenhöhe"
                value={l.elevation}
                factor={100}
                unit="cm"
                digits={0}
                min={-5000}
                max={50000}
                step={1}
                title="Höhe des Fußbodens über dem Erdgeschoss-Fußboden; negativ = Keller"
                onChange={(v) => changeLevelElevation(l.id, v)}
              />
              <div className="muted small">Geschosshöhe {Math.round(storeyHeight(project, l.id) * 100)} cm</div>
              <div className="btn-row">
                {!isActive && <button onClick={() => goToLevel(l.id)}>Wechseln</button>}
                {!single && (
                  <button className="danger" onClick={() => void removeLevel(l.id)}>
                    Entfernen
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <CheckField
        label="Wände, Räume und Fenster der aktuellen Etage übernehmen"
        checked={copyWalls}
        onChange={setCopyWalls}
        title="Die neue Etage bekommt denselben Umriss; Türen, Möbel und Geräte werden nicht übernommen"
      />
      <div className="btn-row">
        <button onClick={() => createLevel({ where: 'above', copyWalls })} data-testid="add-level-above">
          + Etage darüber
        </button>
        <button onClick={() => createLevel({ where: 'below', copyWalls })} title={`${Math.round(DEFAULT_STOREY_HEIGHT * 100)} cm unter der untersten Etage`}>
          + Etage darunter
        </button>
      </div>
    </Section>
  );
}
