import { coveredConnections, FIXTURE_KINDS, FIXTURE_LABEL, fixtureLabel, isWaterConnection } from '../model/fixtures';
import type { FixtureKind, Project } from '../model/schema';
import { deleteSelection } from '../ui/actions';
import { NumberField, PanelGroup, SelectField, TextField } from '../ui/fields';
import { updateFixture } from './actions';

const HEIGHT_HINT: Record<FixtureKind, string> = {
  socket: 'Mitte der Dose über dem Boden (üblich 30 cm, über der Arbeitsplatte etwa 115 cm)',
  switch: 'Mitte des Schalters über dem Boden (üblich 105 cm)',
  radiator: 'Unterkante über dem Boden (üblich 10–15 cm)',
  water: 'Mitte des Anschlusses über dem Boden (Spüle/Waschtisch etwa 50–60 cm)',
  drain: 'Mitte des Anschlusses über dem Boden (Spüle etwa 45 cm, WC etwa 20 cm)',
};

/** Properties of an installation point (#64, #81): kind, height, size, note. */
export function FixtureProps({ id, project }: { id: string; project: Project }) {
  const f = project.fixtures.find((x) => x.id === id);
  if (!f) return <p className="muted padded">Das Element existiert nicht mehr.</p>;
  const upd = (fn: Parameters<typeof updateFixture>[1]) => updateFixture(id, fn);
  const blocking = isWaterConnection(f.kind) ? project.furniture.filter((m) => coveredConnections({ fixtures: [f] }, m).length) : [];
  return (
    <div className="panel-scroll" data-testid="fixture-props">
      <PanelGroup groupKey="fixture.object" title={fixtureLabel(f)}>
        <SelectField<FixtureKind> label="Art" value={f.kind} options={FIXTURE_KINDS.map((k) => ({ value: k, label: FIXTURE_LABEL[k] }))} onChange={(v) => upd((x) => (x.kind = v))} />
        <NumberField label={f.kind === 'radiator' ? 'Höhe Unterkante' : 'Höhe'} title={HEIGHT_HINT[f.kind]} value={f.elevation} factor={100} unit="cm" min={0} max={300} onChange={(v) => upd((x) => (x.elevation = v))} />
        {f.kind === 'socket' && <NumberField label="Anzahl Dosen" value={f.count} digits={0} min={1} max={5} step={1} onChange={(v) => upd((x) => (x.count = Math.round(v)))} />}
        {f.kind === 'radiator' && (
          <div className="field-row">
            <NumberField label="Breite" value={f.width ?? 0.8} factor={100} unit="cm" min={20} max={300} onChange={(v) => upd((x) => (x.width = v))} />
            <NumberField label="Höhe" value={f.height ?? 0.6} factor={100} unit="cm" min={20} max={200} onChange={(v) => upd((x) => (x.height = v))} />
          </div>
        )}
        <TextField label="Notiz" value={f.note ?? ''} placeholder="z. B. Kaltwasser, Herdanschluss" onChange={(v) => upd((x) => (x.note = v.trim() ? v.slice(0, 200) : undefined))} />
        <p className="muted small">Verschieben: im 2D-Plan ziehen – das Element rastet an der nächsten Wand ein.</p>
        {blocking.length > 0 && (
          <p className="small" data-testid="fixture-blocked">
            Orange markiert: davor steht {blocking.map((m) => `„${m.name}“`).join(', ')}.
          </p>
        )}
      </PanelGroup>
      <div className="btn-row padded">
        <button className="danger" onClick={() => void deleteSelection()}>
          Löschen
        </button>
      </div>
    </div>
  );
}
