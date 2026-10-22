import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { derivePlan } from '../model/derived';
import type { Project, SmartDevice } from '../model/schema';
import { useUiStore } from '../store/uiStore';
import { Badge, NumberField, SelectField, TextField } from '../ui/fields';
import { deleteSelection, toggleOpening } from '../ui/actions';
import { addAutomationFor, roomAt, setStripPoints, updateDevice } from './actions';
import { KIND_LABEL, productById } from './catalog';
import { DeviceGlyph, KIND_COLOR } from './glyphs';
import { rulesOf, ruleSentence } from './rules';
import { sensorParams } from './simulation';
import { formatLength, STRIP_DIRECTIONS, stripColor, stripLengthM, stripPoints } from './strip';
import { useSimStore } from './simStore';
import css from './SmartHomePanel.module.css';

const isSensor = (d: SmartDevice) => d.kind === 'motion' || d.kind === 'presence';
const deg = (rad: number) => Math.round(((((rad * 180) / Math.PI) % 360) + 360) % 360);

/** Slider 0–360° for the view direction; one drag is one undo step (transaction like dragging in the plan). */
function DirectionSlider({ id, rotation }: { id: string; rotation: number }) {
  const st = () => useProjectStore.getState();
  const set = (value: number) => {
    const rad = (value * Math.PI) / 180;
    if (st().txBase) {
      st().updateTransient((p) => {
        const dev = p.devices.find((x) => x.id === id);
        if (dev) dev.rotation = rad;
      });
    } else updateDevice(id, { rotation: rad });
  };
  const end = () => st().commitTransaction();
  return (
    <input
      type="range"
      min={0}
      max={360}
      step={1}
      value={deg(rotation)}
      aria-label="Blickrichtung (Regler)"
      data-testid="device-rotation-slider"
      onPointerDown={() => st().beginTransaction()}
      onPointerUp={end}
      onPointerCancel={end}
      onBlur={end}
      onChange={(e) => set(Number(e.target.value))}
    />
  );
}

/** Status text of a device in the simulation (or its resting state while it is stopped). */
export function statusLabel(d: SmartDevice, on: boolean, brightness?: number): string {
  if (d.kind === 'contact') return on ? 'offen' : 'zu';
  if (d.kind === 'light' || d.kind === 'strip') return on ? `an ${brightness ?? 100} %` : 'aus';
  if (d.kind === 'plug') return on ? 'an' : 'aus';
  if (d.kind === 'router') return 'sendet';
  return on ? 'Bewegung' : 'ruhig';
}

/** Current on/off state: simulation if running, else the planned state (lamp switch, door/window). */
export function deviceOn(project: Project, d: SmartDevice, entities: Record<string, { on: boolean; brightness?: number }> | undefined): { on: boolean; brightness?: number } {
  const e = entities?.[d.id];
  if (e) return e;
  if (d.kind === 'contact') return { on: project.openings.find((o) => o.id === d.openingId)?.open ?? false };
  return { on: false };
}

/** Settings of an LED strip (#238): direction, colour or colour temperature, brightness in the simulation, bends. */
function StripSettings({ d, brightness, entityColor }: { d: SmartDevice; brightness: number; entityColor?: string }) {
  const pts = stripPoints(d);
  const color = stripColor(d, { color: entityColor });
  const sim = useSimStore.getState();
  const addSection = () => {
    // continue the last section with a 90° turn, 0.5 m long (then pull it into place)
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    setStripPoints(d.id, [...pts, { x: Math.round((b.x + nx * 0.5) * 1000) / 1000, y: Math.round((b.y + ny * 0.5) * 1000) / 1000 }]);
  };
  return (
    <>
      <SelectField
        label="Leuchtrichtung"
        value={d.direction ?? 'down'}
        options={Object.entries(STRIP_DIRECTIONS).map(([value, label]) => ({ value, label }))}
        onChange={(direction) => updateDevice(d.id, { direction: direction as NonNullable<SmartDevice['direction']> })}
      />
      <label className="small">
        Farbe (RGB)
        <input type="color" value={color} aria-label="Farbe des LED-Streifens" data-testid="strip-color" onChange={(e) => { updateDevice(d.id, { color: e.target.value, kelvin: undefined }); if (sim.state?.entities[d.id]) sim.setLevel(d.id, { color: e.target.value }); }} />
      </label>
      <NumberField
        label="oder Farbtemperatur"
        unit="K"
        digits={0}
        value={d.kelvin ?? 2700}
        min={1500}
        max={10000}
        onChange={(kelvin) => { updateDevice(d.id, { kelvin, color: undefined }); if (sim.state?.entities[d.id]?.color) sim.setLevel(d.id, { color: stripColor({ kelvin }) }); }}
        title="Warmweiß ca. 2700 K, Kaltweiß ca. 6500 K"
      />
      <label className="small">
        Helligkeit {Math.round(brightness)} %
        <input type="range" min={1} max={100} step={1} value={brightness} aria-label="Helligkeit des LED-Streifens" data-testid="strip-brightness" onChange={(e) => sim.setLevel(d.id, { brightness: Number(e.target.value) })} />
      </label>
      <div className="btn-row">
        <button onClick={addSection} disabled={pts.length >= 12} data-testid="strip-add-section">
          Knick anfügen
        </button>
        <button onClick={() => setStripPoints(d.id, pts.slice(0, -1))} disabled={pts.length <= 2} data-testid="strip-remove-section">
          Letzten Abschnitt entfernen
        </button>
      </div>
    </>
  );
}

/**
 * Info panel of a smart-home device (#233), shown under „Eigenschaften“ when a device is
 * clicked in 2D or 3D: name, room, status, switch/trigger, its rules, details, delete.
 */
export function DeviceInfo({ id, project }: { id: string; project: Project }) {
  const d = project.devices.find((x) => x.id === id);
  const entities = useSimStore((s) => s.state?.entities);
  const running = useSimStore((s) => s.running);
  const derived = useMemo(() => derivePlan(project), [project]);
  if (!d) return <p className="muted small panel-section">Gerät nicht mehr vorhanden.</p>;
  const room = project.rooms.find((r) => r.id === roomAt(project, derived, d));
  const product = productById(d.productId);
  const st = deviceOn(project, d, entities);
  const rules = rulesOf(project, d.id);
  const sim = useSimStore.getState();
  const openRules = () => {
    useUiStore.getState().setLeftTab('smarthome');
    sim.setStep('rules');
  };
  const params = isSensor(d) ? sensorParams(d) : null;
  const assumed = (
    <Badge kind="warn" title="Kein Datenblattwert – Annahme, bitte prüfen">
      Annahme
    </Badge>
  );

  return (
    <div className="panel-scroll" data-testid="device-info">
      <section className="panel-section">
        <header className={css.infoHead}>
          <span className={css.glyph} style={{ color: KIND_COLOR[d.kind] }}>
            <DeviceGlyph kind={d.kind} size={28} />
          </span>
          <div>
            <h3>{d.name}</h3>
            <p className="muted small">
              {KIND_LABEL[d.kind]}
              {room ? ` · ${room.name}` : ' · außerhalb der Räume'}
            </p>
          </div>
        </header>
        <div className="panel-section-body">
          <p className="small">
            Status: <Badge kind={st.on ? 'ok' : 'muted'}>{statusLabel(d, st.on, st.brightness)}</Badge>
            {!running && <span className="muted"> (Simulation aus)</span>}
          </p>
          <div className="btn-row">
            {(d.kind === 'light' || d.kind === 'plug' || d.kind === 'strip') && (
              <button className="primary" onClick={() => sim.setEntity(d.id, !st.on)} data-testid="device-toggle">
                {st.on ? 'Ausschalten' : 'Einschalten'}
              </button>
            )}
            {isSensor(d) && (
              <button className="primary" onClick={() => sim.trigger(d.id)} data-testid="device-trigger" title="Meldet sofort „Bewegung“, als wäre jemand vorbeigegangen">
                Auslösen (testen)
              </button>
            )}
            {d.kind === 'contact' && d.openingId && (
              <button className="primary" onClick={() => toggleOpening(d.openingId!)} data-testid="device-toggle">
                {st.on ? 'Schließen' : 'Öffnen'}
              </button>
            )}
          </div>
          {d.kind === 'strip' && (
            <p className="small" data-testid="strip-length">
              Länge: <strong>{formatLength(stripLengthM(stripPoints(d)))}</strong> ({stripPoints(d).length - 1} {stripPoints(d).length === 2 ? 'Abschnitt' : 'Abschnitte'})
            </p>
          )}
          <p className="muted small">{d.kind === 'strip' ? 'Verschieben: Strich im 2D-Plan ziehen, Enden und Knicke an den blauen Punkten.' : 'Verschieben: im 2D-Plan ziehen'}{d.kind === 'strip' ? '' : isSensor(d) ? ', Blickrichtung mit Regler, Zahlenfeld oder blauem Griff' : ''}{d.kind === 'strip' ? '' : '.'}</p>
        </div>
      </section>

      <section className="panel-section">
        <header>
          <h3>Regeln ({rules.length})</h3>
        </header>
        <div className="panel-section-body">
          {rules.length === 0 && <p className="muted small">Noch keine Regel mit diesem Gerät.</p>}
          <ul className={css.list}>
            {rules.map((a) => {
              const s = ruleSentence(project, a);
              return (
                <li key={a.id} className={`small ${css.rule}`} data-testid="device-rule">
                  {s.when}, {s.then}.{!a.enabled && <span className="muted"> (aus)</span>}
                </li>
              );
            })}
          </ul>
          <div className="btn-row">
            {(isSensor(d) || d.kind === 'contact') && (
              <button
                onClick={() => {
                  addAutomationFor(d.id);
                  openRules();
                }}
                data-testid="automation-add"
              >
                Regel anlegen
              </button>
            )}
            {rules.length > 0 && <button onClick={openRules}>Regeln bearbeiten</button>}
          </div>
        </div>
      </section>

      <section className="panel-section">
        <header>
          <h3>Einstellungen</h3>
        </header>
        <div className="panel-section-body">
          <TextField label="Name" value={d.name} onChange={(name) => updateDevice(d.id, { name })} />
          {params && (
            <>
              <div className={css.inline}>
                <NumberField label="Reichweite" unit="m" value={params.rangeM} min={0.5} max={20} onChange={(rangeM) => updateDevice(d.id, { rangeM })} />
                {params.assumed.range && assumed}
              </div>
              <div className={css.inline}>
                <NumberField label="Winkel" unit="°" digits={0} value={params.angleDeg} min={10} max={360} onChange={(angleDeg) => updateDevice(d.id, { angleDeg })} />
                {params.assumed.angle && assumed}
              </div>
              <div className={css.inline}>
                <NumberField
                  label="Haltezeit"
                  unit="s"
                  digits={0}
                  value={params.holdS}
                  min={1}
                  max={3600}
                  onChange={(holdS) => updateDevice(d.id, { holdS })}
                  title="So lange meldet der Sensor nach der letzten Bewegung noch „Bewegung“"
                />
                {params.assumed.hold && assumed}
              </div>
              <NumberField label="Blickrichtung" unit="°" digits={0} value={deg(d.rotation)} min={0} max={360} onChange={(v) => updateDevice(d.id, { rotation: (v * Math.PI) / 180 })} />
              <DirectionSlider id={d.id} rotation={d.rotation} />
            </>
          )}
          {d.kind === 'strip' && <StripSettings d={d} brightness={st.brightness ?? 100} entityColor={entities?.[d.id]?.color} />}
          {d.kind === 'contact' && (
            <SelectField
              label="Fenster/Tür"
              value={d.openingId ?? ''}
              options={[{ value: '', label: '–' }, ...project.openings.filter((o) => o.kind !== 'passage').map((o, i) => ({ value: o.id, label: `${o.kind === 'door' ? 'Tür' : 'Fenster'} ${i + 1}` }))]}
              onChange={(openingId) => updateDevice(d.id, { openingId: openingId || undefined })}
            />
          )}
          <NumberField label="Höhe" unit="m" digits={2} value={d.elevation} min={0} max={10} onChange={(elevation) => updateDevice(d.id, { elevation })} />
          <details className={`small ${css.product}`}>
            <summary>{product ? `${product.brand} ${product.model}` : 'Allgemeines Gerät (ohne Produktdaten)'}</summary>
            {product && (
              <>
                <p>
                  {product.protocol} · {product.power}
                  {product.batteryLife ? ` · Batterie ${product.batteryLife}` : ''}
                  <br />
                  Mesh-Router: {product.router === 'stated' ? 'ja' : product.router === 'inferred' ? 'vermutlich (Netzbetrieb)' : product.router === 'no' ? 'nein (Batterie)' : 'unbekannt'}
                </p>
                {product.note && <p className="muted">{product.note}</p>}
                <p className="muted">
                  {product.sourceKind === 'manufacturer' ? 'Quelle Hersteller' : 'Quelle Händler/Presse'}:{' '}
                  {product.sources.map((s, i) => (
                    <a key={s} href={s} target="_blank" rel="noreferrer">
                      [{i + 1}]
                    </a>
                  ))}{' '}
                  · Stand 17.10.2026, vor dem Kauf prüfen
                </p>
              </>
            )}
          </details>
          <button className="danger block" onClick={() => void deleteSelection()} data-testid="device-delete">
            Gerät löschen
          </button>
        </div>
      </section>
    </div>
  );
}
