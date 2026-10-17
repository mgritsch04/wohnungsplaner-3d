import { useMemo, useState } from 'react';
import { derivePlan } from '../model/derived';
import type { Automation, Project, SmartDevice, SmartDeviceKind } from '../model/schema';
import { polygonCentroid } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { Badge, CheckField, NumberField, Section, SelectField, TextField } from '../ui/fields';
import { downloadBlob, safeFileName } from '../ui/fileUtils';
import { addAutomationFor, addDevice, deleteAutomation, deleteDevice, roomAt, updateAutomation, updateDevice } from './actions';
import { DEVICE_PRODUCTS, KIND_LABEL, productById } from './catalog';
import { automationsYaml } from './haYaml';
import { formatSimHour, occludersOf, roomCoverage, sensorParams } from './simulation';
import { SPEEDS, useSimStore } from './simStore';
import css from './SmartHomePanel.module.css';

const GENERIC = '__generic';
const KINDS = Object.keys(KIND_LABEL) as SmartDeviceKind[];
const isSensor = (d: SmartDevice) => d.kind === 'motion' || d.kind === 'presence';
const deg = (rad: number) => Math.round(((((rad * 180) / Math.PI) % 360) + 360) % 360);

/**
 * Smart-home simulation (#170): place devices from the catalog (datasheet values with
 * sources), link them with automations, run the simulation with a person in the plan or
 * the walkthrough, check the coverage per room and export the automations for
 * Home Assistant. Nothing connects to real devices.
 */
export function SmartHomePanel() {
  const project = useProjectStore((s) => s.project);
  const derived = useMemo(() => derivePlan(project), [project]);
  const { running, speed, state, selectedDeviceId, start, stop, setSpeed, setPerson, select } = useSimStore();
  const [roomId, setRoomId] = useState<string>('');
  const [kind, setKind] = useState<SmartDeviceKind>('motion');
  const [productId, setProductId] = useState<string>(DEVICE_PRODUCTS.find((p) => p.kind === 'motion')?.id ?? GENERIC);
  const room = project.rooms.find((r) => r.id === roomId) ?? project.rooms[0];
  const coverage = useMemo(() => roomCoverage(project, derived, occludersOf(project, derived)), [project, derived]);
  const selected = project.devices.find((d) => d.id === selectedDeviceId) ?? null;

  const products = DEVICE_PRODUCTS.filter((p) => p.kind === kind);
  const onKind = (k: SmartDeviceKind) => {
    setKind(k);
    setProductId(DEVICE_PRODUCTS.find((p) => p.kind === k)?.id ?? GENERIC);
  };
  const add = () => select(addDevice(kind, productId === GENERIC ? undefined : productId, room?.id ?? null));
  const placePerson = () => {
    const g = room && derived.rooms.get(room.id);
    if (g) setPerson(polygonCentroid(g.interior));
  };
  const exportYaml = () => downloadBlob(automationsYaml(project), `${safeFileName(project.name)}-automations.yaml`, 'text/yaml');

  return (
    <div className={`panel-scroll ${css.panel}`} data-testid="smarthome-panel">
      <Section title="Smart Home simulieren">
        <p className="muted small">
          Geräte mit Werten aus dem Datenblatt platzieren, mit Automationen verknüpfen und testen: Die Person im Plan (ziehbar) oder du selbst im Rundgang löst die
          Melder aus. Keine Verbindung zu echten Geräten.
        </p>
        {project.rooms.length === 0 && <p className="warning small">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>}
        <SelectField label="Raum" value={room?.id ?? ''} options={project.rooms.map((r) => ({ value: r.id, label: r.name }))} onChange={setRoomId} />
        <div className="btn-row">
          {running ? (
            <button className="primary" onClick={stop} data-testid="sim-stop">
              Simulation stoppen
            </button>
          ) : (
            <button className="primary" onClick={start} disabled={!project.devices.length} data-testid="sim-start">
              Simulation starten
            </button>
          )}
          <button onClick={placePerson} disabled={!room} data-testid="sim-person">
            Person in den Raum stellen
          </button>
        </div>
        <SelectField label="Tempo" value={String(speed)} options={SPEEDS.map((s) => ({ value: String(s), label: s === 1 ? 'Echtzeit' : `${s}× schneller` }))} onChange={(v) => setSpeed(Number(v))} />
        {state && (
          <p className="small" data-testid="sim-clock">
            Simulierte Uhrzeit {formatSimHour(state.hour)} · {Math.round(state.t)} s simuliert
          </p>
        )}
      </Section>

      <Section title="Gerät hinzufügen">
        <SelectField label="Art" value={kind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={onKind} />
        <SelectField
          label="Produkt"
          value={productId}
          options={[...products.map((p) => ({ value: p.id, label: `${p.brand} ${p.model}` })), { value: GENERIC, label: 'Allgemein (Annahmewerte)' }]}
          onChange={setProductId}
        />
        <button className="primary block" onClick={add} disabled={!room} data-testid="device-add">
          In „{room?.name ?? '–'}“ platzieren
        </button>
      </Section>

      <Section title={`Geräte (${project.devices.length})`}>
        {project.devices.length === 0 && <p className="muted small">Noch keine Geräte.</p>}
        <ul className={css.list}>
          {project.devices.map((d) => {
            const e = state?.entities[d.id];
            return (
              <li key={d.id}>
                <button className={d.id === selectedDeviceId ? `${css.row} ${css.active}` : css.row} onClick={() => select(d.id === selectedDeviceId ? null : d.id)} data-testid="device-row" data-device={d.name}>
                  <span>{d.name}</span>
                  {e && <Badge kind={e.on ? 'ok' : 'muted'}>{stateLabel(d, e.on, e.brightness)}</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
        {selected && <DeviceDetails project={project} device={selected} />}
      </Section>

      {project.devices.some(isSensor) && (
        <Section title="Abdeckung durch Melder">
          <ul className={css.list}>
            {project.rooms.map((r) => (
              <li key={r.id} className={css.cover} data-testid="coverage" data-room={r.name} data-share={(coverage.get(r.id) ?? 0).toFixed(3)}>
                <span>{r.name}</span>
                <span>{Math.round((coverage.get(r.id) ?? 0) * 100)} %</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Anteil der Bodenfläche im Erfassungsbereich (Reichweite, Winkel, Sichtlinie; Wände und geschlossene Türen blockieren).</p>
        </Section>
      )}

      <Section title={`Automationen (${project.automations.length})`}>
        {project.automations.length === 0 && <p className="muted small">Gerät auswählen › „Automation anlegen“.</p>}
        {project.automations.map((a) => (
          <AutomationEditor key={a.id} project={project} a={a} />
        ))}
        <button className="block" onClick={exportYaml} disabled={!project.automations.length} data-testid="ha-export">
          Als Home-Assistant-YAML herunterladen
        </button>
      </Section>

      {state && state.events.length > 0 && (
        <Section title="Protokoll">
          <ol className={css.log} data-testid="sim-log">
            {state.events
              .slice(-8)
              .reverse()
              .map((ev, i) => (
                <li key={`${ev.t}-${i}`}>
                  <span className="muted">{formatSimHour(ev.hour)}</span> {ev.text}
                </li>
              ))}
          </ol>
        </Section>
      )}
    </div>
  );
}

function stateLabel(d: SmartDevice, on: boolean, brightness?: number) {
  if (d.kind === 'contact') return on ? 'offen' : 'zu';
  if (d.kind === 'light') return on ? `an ${brightness ?? 100} %` : 'aus';
  if (d.kind === 'plug') return on ? 'an' : 'aus';
  return on ? 'Bewegung' : 'ruhig';
}

function DeviceDetails({ project, device: d }: { project: Project; device: SmartDevice }) {
  const product = productById(d.productId);
  const params = isSensor(d) ? sensorParams(d) : null;
  const assumed = <Badge kind="warn" title="Kein Datenblattwert – Annahme, bitte prüfen">Annahme</Badge>;
  return (
    <div className={css.details} data-testid="device-details">
      <TextField label="Name" value={d.name} onChange={(name) => updateDevice(d.id, { name })} />
      {product ? (
        <div className="small">
          <strong>
            {product.brand} {product.model}
          </strong>
          <br />
          {product.protocol} · {product.power}
          {product.batteryLife ? ` · Batterie ${product.batteryLife}` : ''}
          <br />
          Mesh-Router: {product.router === 'stated' ? 'ja' : product.router === 'inferred' ? 'vermutlich (Netzbetrieb)' : product.router === 'no' ? 'nein (Batterie)' : 'unbekannt'}
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
        </div>
      ) : (
        <p className="muted small">Allgemeines Gerät ohne Produktdaten.</p>
      )}
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
        </>
      )}
      {d.kind === 'contact' && (
        <SelectField
          label="Fenster/Tür"
          value={d.openingId ?? ''}
          options={[{ value: '', label: '–' }, ...project.openings.filter((o) => o.kind !== 'passage').map((o, i) => ({ value: o.id, label: `${o.kind === 'door' ? 'Tür' : 'Fenster'} ${i + 1}` }))]}
          onChange={(openingId) => updateDevice(d.id, { openingId: openingId || undefined })}
        />
      )}
      <NumberField label="Höhe" unit="m" digits={2} value={d.elevation} min={0} max={10} onChange={(elevation) => updateDevice(d.id, { elevation })} />
      <div className="btn-row">
        {(isSensor(d) || d.kind === 'contact') && (
          <button onClick={() => addAutomationFor(d.id)} data-testid="automation-add">
            Automation anlegen
          </button>
        )}
        <button className="danger" onClick={() => deleteDevice(d.id)}>
          Entfernen
        </button>
      </div>
    </div>
  );
}

function AutomationEditor({ project, a }: { project: Project; a: Automation }) {
  const derived = useMemo(() => derivePlan(project), [project]);
  const trigger = project.devices.find((d) => 'deviceId' in a.trigger && d.id === a.trigger.deviceId);
  const targets = project.devices.filter((d) => d.kind === 'light' || d.kind === 'plug');
  const roomName = (d: SmartDevice) => project.rooms.find((r) => r.id === roomAt(project, derived, d))?.name;
  return (
    <div className={css.automation} data-testid="automation" data-name={a.name}>
      <TextField label="Name" value={a.name} onChange={(name) => updateAutomation(a.id, (x) => void (x.name = name))} />
      <p className="small">
        Wenn: {a.trigger.type === 'time' ? `es ${formatSimHour(a.trigger.hour)} ist` : a.trigger.type === 'contact' ? `${trigger?.name ?? '?'} ${a.trigger.to === 'open' ? 'geöffnet' : 'geschlossen'} wird` : `${trigger?.name ?? '?'} Bewegung meldet`}
      </p>
      <CheckField label="Aktiv" checked={a.enabled} onChange={(v) => updateAutomation(a.id, (x) => void (x.enabled = v))} />
      <CheckField label="Nur wenn es dunkel ist" checked={a.onlyWhenDark} onChange={(v) => updateAutomation(a.id, (x) => void (x.onlyWhenDark = v))} />
      <p className="small">Dann einschalten:</p>
      {targets.length === 0 && <p className="muted small">Noch keine smarte Lampe oder Steckdose.</p>}
      {targets.map((t) => (
        <CheckField
          key={t.id}
          label={`${t.name}${roomName(t) ? ` (${roomName(t)})` : ''}`}
          checked={a.action.deviceIds.includes(t.id)}
          onChange={(v) => updateAutomation(a.id, (x) => void (x.action.deviceIds = v ? [...x.action.deviceIds, t.id] : x.action.deviceIds.filter((id) => id !== t.id)))}
        />
      ))}
      <NumberField label="Helligkeit" unit="%" digits={0} value={a.action.brightness ?? 100} min={1} max={100} onChange={(v) => updateAutomation(a.id, (x) => void (x.action.brightness = v))} />
      {a.trigger.type === 'motion' && (
        <NumberField label="Aus nach" unit="s" digits={0} value={a.offAfterS ?? 0} min={0} max={7200} onChange={(v) => updateAutomation(a.id, (x) => void (x.offAfterS = v))} title="Sekunden ohne Bewegung, bis das Licht wieder ausgeht" />
      )}
      <button className="small danger" onClick={() => deleteAutomation(a.id)}>
        Automation löschen
      </button>
    </div>
  );
}
