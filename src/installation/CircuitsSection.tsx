import { useMemo, useState } from 'react';
import { checkCircuits, FUSE_OPTIONS, formatWatts, LOAD_PRESETS, MAINS_VOLTAGE, type CircuitStatus } from '../model/circuits';
import type { Load, Project } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { Badge, NumberField, Section, TextField } from '../ui/fields';
import { addCircuit, addLoad, deleteCircuit, deleteLoad, updateCircuit, updateLoad } from './circuitActions';

const STATUS_LABEL: Record<CircuitStatus, string> = { ok: 'ok', warn: 'Dauerlast hoch', over: 'Überlast' };
const STATUS_KIND: Record<CircuitStatus, 'ok' | 'warn' | 'error'> = { ok: 'ok', warn: 'warn', over: 'error' };

export const CIRCUIT_DISCLAIMER = 'Richtwert, keine fachliche Freigabe: ersetzt keine Elektroplanung und keine Prüfung durch einen Fachbetrieb.';

/** One consumer row: name, watts, remove. */
function LoadRow({ load }: { load: Load }) {
  return (
    <li className="load-row" data-testid="load-row">
      <TextField label="Gerät" value={load.name} onChange={(v) => updateLoad(load.id, (l) => void (l.name = v.slice(0, 80)))} />
      <NumberField label="Leistung" value={load.watts} digits={0} unit="W" min={0} max={30000} step={50} onChange={(v) => updateLoad(load.id, (l) => void (l.watts = Math.round(v)))} />
      <button onClick={() => deleteLoad(load.id)} title="Verbraucher entfernen">
        Entfernen
      </button>
    </li>
  );
}

/** Add a consumer from the list of typical appliances (value editable afterwards) or an empty one. */
export function AddLoad({ target }: { target: { fixtureId?: string; circuitId?: string } }) {
  const [preset, setPreset] = useState('');
  return (
    <div className="field">
      <span className="field-label">Verbraucher hinzufügen</span>
      <span className="field-input">
        <select
          aria-label="Verbraucher hinzufügen"
          value={preset}
          onChange={(e) => {
            const v = e.target.value;
            setPreset('');
            if (v === '__custom') addLoad('Verbraucher', 100, target);
            else {
              const p = LOAD_PRESETS.find((x) => x.name === v);
              if (p) addLoad(p.name, p.watts, target);
            }
          }}
        >
          <option value="">– wählen –</option>
          {LOAD_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} (ca. {p.watts} W)
            </option>
          ))}
          <option value="__custom">Eigenes Gerät …</option>
        </select>
      </span>
    </div>
  );
}

/** Consumers on one socket (#135), shown in the socket properties. */
export function SocketLoads({ fixtureId, project }: { fixtureId: string; project: Project }) {
  const loads = project.loads.filter((l) => l.fixtureId === fixtureId);
  return (
    <div data-testid="socket-loads">
      {loads.length > 0 && <ul className="issues">{loads.map((l) => <LoadRow key={l.id} load={l} />)}</ul>}
      <AddLoad target={{ fixtureId }} />
      {loads.length > 0 && <p className="muted small">Zusammen {formatWatts(loads.reduce((s, l) => s + l.watts, 0))}. Die Auslastung steht unter „Projekt“ › Stromkreise.</p>}
    </div>
  );
}

/** Circuits with fuse, consumers and load per circuit (#135). */
export function CircuitsSection() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const check = useMemo(() => checkCircuits(project), [project]);
  const sockets = project.fixtures.filter((f) => f.kind === 'socket');
  return (
    <Section title="Stromkreise & Leistung" actions={<button onClick={() => void addCircuit()}>+ Stromkreis</button>}>
      <p className="muted small" data-testid="circuit-disclaimer">
        {CIRCUIT_DISCLAIMER}
      </p>
      <NumberField
        label="Dauerlast-Grenze"
        value={project.settings.circuitLimitPct}
        digits={0}
        unit="%"
        min={10}
        max={100}
        step={5}
        title={`Anteil der Absicherung, ab dem gewarnt wird (üblich 80 %). Rechnung mit ${MAINS_VOLTAGE} V.`}
        onChange={(v) => apply((d) => void (d.settings.circuitLimitPct = Math.round(v)))}
      />
      {check.circuits.length === 0 ? (
        <p className="muted small">Noch kein Stromkreis. Mit „+ Stromkreis“ anlegen, dann Steckdosen im Installationsplan zuordnen und Geräte eintragen.</p>
      ) : (
        <ul className="issues" data-testid="circuit-list">
          {check.circuits.map(({ circuit, loads, totalW, capacityW, limitW, percent, status }) => (
            <li key={circuit.id} data-testid="circuit-item" data-status={status}>
              <TextField label="Name" value={circuit.name} onChange={(v) => updateCircuit(circuit.id, (c) => void (c.name = v.slice(0, 60)))} />
              <label className="field">
                <span className="field-label">Absicherung</span>
                <span className="field-input">
                  <select value={circuit.amps} onChange={(e) => updateCircuit(circuit.id, (c) => void (c.amps = Number(e.target.value)))}>
                    {[...new Set([...FUSE_OPTIONS, circuit.amps])].sort((a, b) => a - b).map((a) => (
                      <option key={a} value={a}>
                        {a} A ({formatWatts(a * MAINS_VOLTAGE)})
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <p className="small" data-testid="circuit-summary">
                <strong>{formatWatts(totalW)}</strong> von {formatWatts(capacityW)} ({percent} %) · Grenze {formatWatts(limitW)}{' '}
                <Badge kind={STATUS_KIND[status]}>{STATUS_LABEL[status]}</Badge>
              </p>
              <progress max={capacityW} value={Math.min(totalW, capacityW)} aria-label={`Auslastung ${circuit.name}`} />
              {status !== 'ok' && (
                <p className="small" role="alert" data-testid="circuit-warning">
                  {status === 'over' ? `Überlast: ${formatWatts(totalW)} übersteigen die Absicherung (${formatWatts(capacityW)}).` : `Über der Dauerlast-Grenze (${project.settings.circuitLimitPct} % = ${formatWatts(limitW)}).`} Geräte auf einen anderen Stromkreis verteilen.
                </p>
              )}
              <p className="muted small">Steckdosen: {sockets.filter((f) => f.circuitId === circuit.id).length} (Zuordnung in den Eigenschaften der Steckdose)</p>
              {loads.length > 0 && <ul className="issues">{loads.map((l) => <LoadRow key={l.id} load={l} />)}</ul>}
              <AddLoad target={{ circuitId: circuit.id }} />
              <button className="danger" onClick={() => deleteCircuit(circuit.id)}>
                Stromkreis entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
      {check.unassigned.length > 0 && (
        <div data-testid="unassigned-loads">
          <p className="small">Nicht zugeordnet (Steckdose ohne Stromkreis): {check.unassigned.map((l) => `${l.name} (${formatWatts(l.watts)})`).join(', ')}</p>
        </div>
      )}
    </Section>
  );
}
