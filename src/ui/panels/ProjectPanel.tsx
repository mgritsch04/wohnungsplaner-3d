import { useMemo } from 'react';
import { validateModel } from '../../model/validation';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { CheckField, NumberField, Section, Badge } from '../fields';
import { usePerformanceStore } from '../../view3d/performanceStore';
import type { Material } from '../../model/schema';
import { newId } from '../../model/ids';
import { TimeOfDayControl } from '../TimeOfDayControl';

export function ProjectPanel() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const issues = useMemo(() => validateModel(project), [project]);
  const fps = useUiStore((s) => s.fps);
  const dprCap = usePerformanceStore((s) => s.dprCap);
  const s = project.settings;

  return (
    <div className="panel-scroll">
      <Section title="Licht & Darstellung (3D)">
        <div className="field">
          <span className="field-label">Tageszeit (wirkt im Realismusmodus)</span>
          <TimeOfDayControl />
        </div>
        <label className="field">
          <span className="field-label">Belichtung {s.exposure.toFixed(2)}</span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.05}
            value={s.exposure}
            onChange={(e) =>
              apply((d) => {
                d.settings.exposure = Number(e.target.value);
              })
            }
          />
        </label>
        <CheckField
          label="Decken anzeigen"
          checked={s.showCeilings}
          onChange={(v) =>
            apply((d) => {
              d.settings.showCeilings = v;
            })
          }
          title="Decken sind nur von unten sichtbar (z. B. beim Begehen)"
        />
      </Section>

      <Section title="Leistung">
        <p className="small">
          Modus: <strong>{s.quality === 'planning' ? 'Planung' : 'Realismus'}</strong>
          {fps !== null && (
            <>
              {' '}
              · <Badge kind={fps >= 45 ? 'ok' : fps >= 25 ? 'warn' : 'error'}>{fps} FPS</Badge>
            </>
          )}
        </p>
        <p className="muted small">Pixel-Verhältnis-Obergrenze: {dprCap.toFixed(2)} (wird bei anhaltend niedriger Bildrate automatisch reduziert).</p>
        <p className="muted small">Planung: keine Schatten, einfache Materialien. Realismus: Texturen, weiche Schatten, Umgebungslicht.</p>
      </Section>

      <Section title="Materialien">
        <ul className="material-list">
          {project.materials.map((m) => (
            <MaterialRow key={m.id} m={m} />
          ))}
        </ul>
        <button
          className="block"
          onClick={() =>
            apply((d) => {
              d.materials.push({ id: newId('mat'), name: 'Eigene Wandfarbe', kind: 'paint', color: '#c9b8a6', roughness: 0.9, metalness: 0, textureScale: 1 });
            })
          }
        >
          + Eigene Farbe
        </button>
      </Section>

      <Section title={`Modellprüfung (${issues.length})`}>
        {issues.length === 0 ? (
          <p className="small">
            <Badge kind="ok">OK</Badge> Keine Probleme gefunden.
          </p>
        ) : (
          <ul className="issues">
            {issues.map((i, k) => (
              <li key={k}>
                <Badge kind={i.severity === 'error' ? 'error' : 'warn'}>{i.severity === 'error' ? 'Fehler' : 'Hinweis'}</Badge> {i.message}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Projekt">
        <p className="muted small">
          ID: {project.id}
          <br />
          Erstellt: {new Date(project.createdAt).toLocaleString('de-AT')}
          <br />
          Geändert: {new Date(project.updatedAt).toLocaleString('de-AT')}
          <br />
          Schema-Version: {project.schemaVersion}
        </p>
        <NumberField label="Wandhöhe Standard" value={s.defaultWallHeight} factor={100} unit="cm" min={50} max={1000} onChange={(v) => apply((d) => void (d.settings.defaultWallHeight = v))} />
      </Section>
    </div>
  );
}

function MaterialRow({ m }: { m: Material }) {
  const apply = useProjectStore((s) => s.apply);
  const upd = (fn: (x: Material) => void) =>
    apply((d) => {
      const x = d.materials.find((q) => q.id === m.id);
      if (x) fn(x);
    });
  return (
    <li>
      <input type="color" value={m.color} onChange={(e) => upd((x) => (x.color = e.target.value))} aria-label={`Farbe ${m.name}`} />
      <input className="material-name" value={m.name} onChange={(e) => upd((x) => (x.name = e.target.value.slice(0, 100)))} aria-label="Materialname" />
      <span className="muted small">{m.kind}</span>
    </li>
  );
}
