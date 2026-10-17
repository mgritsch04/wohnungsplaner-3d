import { useMemo, useState } from 'react';
import { derivePlan, type DerivedPlan } from '../model/derived';
import type { Automation, Project, SmartDevice, SmartDeviceKind } from '../model/schema';
import { polygonCentroid } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Badge, CheckField, NumberField, Section, SelectField, TextField } from '../ui/fields';
import { downloadBlob, safeFileName } from '../ui/fileUtils';
import { addAutomationFor, deleteAutomation, placeDevice, roomAt, updateAutomation } from './actions';
import { DEVICE_PRODUCTS, KIND_LABEL } from './catalog';
import { deviceOn, statusLabel } from './DeviceInfo';
import { DeviceGlyph, KIND_COLOR } from './glyphs';
import { automationsYaml } from './haYaml';
import { ruleSentence } from './rules';
import { formatSimHour, occludersOf, roomCoverage } from './simulation';
import { SPEEDS, useSelectedDeviceId, useSimStore, type PanelStep } from './simStore';
import css from './SmartHomePanel.module.css';

const GENERIC = '__generic';
const KINDS = Object.keys(KIND_LABEL) as SmartDeviceKind[];
const isSensor = (d: SmartDevice) => d.kind === 'motion' || d.kind === 'presence';
const OUTSIDE = '__outside';

/** Room the panel works in: chosen in the panel, else the room or device selected in the plan, else the first room. */
function useActiveRoom(project: Project, derived: DerivedPlan) {
  const [chosen, setChosen] = useState('');
  const selection = useUiStore((s) => s.selection);
  const fromSelection =
    selection?.type === 'room'
      ? selection.id
      : selection?.type === 'device'
        ? (() => {
            const d = project.devices.find((x) => x.id === selection.id);
            return d ? roomAt(project, derived, d) : null;
          })()
        : null;
  const room = project.rooms.find((r) => r.id === chosen) ?? project.rooms.find((r) => r.id === fromSelection) ?? project.rooms[0];
  return [room, setChosen] as const;
}

/**
 * Smart-home simulation (#170, #233) in three steps: place devices (datasheet values with
 * sources) by room or by a click into the plan, link them with rules, and test them with a
 * person in the plan or in the walkthrough. Clicking a device in 2D/3D shows its info and
 * actions under „Eigenschaften“. Nothing connects to real devices.
 */
export function SmartHomePanel() {
  const project = useProjectStore((s) => s.project);
  const derived = useMemo(() => derivePlan(project), [project]);
  const step = useSimStore((s) => s.step);
  const setStep = useSimStore((s) => s.setStep);
  const [room, setRoomId] = useActiveRoom(project, derived);
  const steps: { id: PanelStep; label: string }[] = [
    { id: 'devices', label: `Geräte (${project.devices.length})` },
    { id: 'rules', label: `Regeln (${project.automations.length})` },
    { id: 'test', label: 'Testen' },
  ];

  return (
    <div className={`panel-scroll ${css.panel}`} data-testid="smarthome-panel">
      <nav className={css.steps} aria-label="Smart-Home-Schritte">
        {steps.map((s, i) => (
          <button key={s.id} className={step === s.id ? css.stepActive : undefined} aria-pressed={step === s.id} onClick={() => setStep(s.id)} data-testid={`sh-step-${s.id}`}>
            <span className={css.stepNo}>{i + 1}</span> {s.label}
          </button>
        ))}
      </nav>
      {project.rooms.length === 0 && <p className="warning small panel-section">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>}
      {step === 'devices' && <DevicesStep project={project} derived={derived} room={room} setRoomId={setRoomId} />}
      {step === 'rules' && <RulesStep project={project} />}
      {step === 'test' && <TestStep project={project} derived={derived} room={room} setRoomId={setRoomId} />}
    </div>
  );
}

type RoomProps = { project: Project; derived: DerivedPlan; room: Project['rooms'][number] | undefined; setRoomId: (id: string) => void };

function RoomSelect({ project, room, setRoomId }: Omit<RoomProps, 'derived'>) {
  return <SelectField label="Raum" value={room?.id ?? ''} options={project.rooms.map((r) => ({ value: r.id, label: r.name }))} onChange={setRoomId} />;
}

function DevicesStep({ project, derived, room, setRoomId }: RoomProps) {
  const [kind, setKind] = useState<SmartDeviceKind>('motion');
  const [productId, setProductId] = useState<string>(DEVICE_PRODUCTS.find((p) => p.kind === 'motion')?.id ?? GENERIC);
  const placing = useSimStore((s) => s.placing);
  const setPlacing = useSimStore((s) => s.setPlacing);
  const products = DEVICE_PRODUCTS.filter((p) => p.kind === kind);
  const product = productId === GENERIC ? undefined : productId;
  const onKind = (k: SmartDeviceKind) => {
    setKind(k);
    setProductId(DEVICE_PRODUCTS.find((p) => p.kind === k)?.id ?? GENERIC);
    if (placing) setPlacing({ kind: k, productId: DEVICE_PRODUCTS.find((p) => p.kind === k)?.id });
  };
  const clickToPlace = () => {
    if (placing) return setPlacing(null);
    const ui = useUiStore.getState();
    if (ui.viewMode === '3d') ui.setViewMode('split');
    setPlacing({ kind, productId: product });
  };

  return (
    <>
      <Section title="Gerät hinzufügen">
        <div className={css.kinds} role="group" aria-label="Geräteart">
          {KINDS.map((k) => (
            <button key={k} className={k === kind ? `${css.kind} ${css.kindActive}` : css.kind} aria-pressed={k === kind} onClick={() => onKind(k)} data-testid="device-kind" data-kind={k}>
              <span style={{ color: KIND_COLOR[k] }}>
                <DeviceGlyph kind={k} size={22} />
              </span>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <SelectField
          label="Produkt"
          value={productId}
          options={[...products.map((p) => ({ value: p.id, label: `${p.brand} ${p.model}` })), { value: GENERIC, label: 'Allgemein (Annahmewerte)' }]}
          onChange={(v) => {
            setProductId(v);
            if (placing) setPlacing({ kind, productId: v === GENERIC ? undefined : v });
          }}
        />
        <RoomSelect project={project} room={room} setRoomId={setRoomId} />
        <div className="btn-row">
          <button className="primary" onClick={() => placeDevice(kind, product, room?.id ?? null)} disabled={!room} data-testid="device-add">
            In „{room?.name ?? '–'}“ platzieren
          </button>
          <button onClick={clickToPlace} aria-pressed={!!placing} data-testid="device-place-click">
            {placing ? 'Abbrechen' : 'Im Plan klicken'}
          </button>
        </div>
        {placing && (
          <p className={`small ${css.hint}`} data-testid="device-placing-hint">
            Klicke im 2D-Plan dorthin, wo {KIND_LABEL[placing.kind]} hin soll. Esc bricht ab.
          </p>
        )}
      </Section>
      <DeviceList project={project} derived={derived} />
    </>
  );
}

/** Devices grouped by room with live status and the sensor coverage of the room. */
function DeviceList({ project, derived }: { project: Project; derived: DerivedPlan }) {
  const entities = useSimStore((s) => s.state?.entities);
  const selectedId = useSelectedDeviceId();
  const coverage = useMemo(() => (project.devices.some(isSensor) ? roomCoverage(project, derived, occludersOf(project, derived)) : null), [project, derived]);
  if (!project.devices.length) return <p className="muted small panel-section">Noch keine Geräte. Art wählen und platzieren, dann erscheint das Gerät im Plan und hier.</p>;
  const groups = new Map<string, SmartDevice[]>();
  for (const d of project.devices) {
    const r = roomAt(project, derived, d) ?? OUTSIDE;
    groups.set(r, [...(groups.get(r) ?? []), d]);
  }
  const rows = [...project.rooms.map((r) => ({ id: r.id, name: r.name })), { id: OUTSIDE, name: 'Außerhalb der Räume' }];
  const select = (id: string) => useUiStore.getState().setSelection(id === selectedId ? null : { type: 'device', id });
  return (
    <Section title={`Geräte im Plan (${project.devices.length})`}>
      {rows.map((r) => {
        const list = groups.get(r.id) ?? [];
        const share = coverage?.get(r.id);
        if (!list.length && share === undefined) return null;
        return (
          <div key={r.id} className={css.group}>
            <div className={css.groupHead} data-testid={share !== undefined ? 'coverage' : undefined} data-room={r.name} data-share={share?.toFixed(3)}>
              <strong>{r.name}</strong>
              {share !== undefined && (
                <span className="small" title="Anteil der Bodenfläche im Erfassungsbereich der Melder (Reichweite, Winkel, Sichtlinie; Wände und geschlossene Türen blockieren)">
                  <span className={css.bar}>
                    <span style={{ width: `${Math.round(share * 100)}%` }} />
                  </span>
                  {Math.round(share * 100)} % erfasst
                </span>
              )}
            </div>
            {list.length === 0 && <p className="muted small">Keine Geräte.</p>}
            <ul className={css.list}>
              {list.map((d) => {
                const st = deviceOn(project, d, entities);
                return (
                  <li key={d.id}>
                    <button className={d.id === selectedId ? `${css.row} ${css.active}` : css.row} onClick={() => select(d.id)} data-testid="device-row" data-device={d.name}>
                      <span className={css.inline}>
                        <span style={{ color: KIND_COLOR[d.kind] }}>
                          <DeviceGlyph kind={d.kind} size={18} />
                        </span>
                        <span>{d.name}</span>
                      </span>
                      <Badge kind={st.on ? 'ok' : 'muted'}>{statusLabel(d, st.on, st.brightness)}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="muted small">Gerät anklicken (hier, im Plan oder in 3D) für Infos und Aktionen unter „Eigenschaften“.</p>
    </Section>
  );
}

function RulesStep({ project }: { project: Project }) {
  const triggers = project.devices.filter((d) => isSensor(d) || d.kind === 'contact');
  const [sensorId, setSensorId] = useState('');
  const sensor = triggers.find((d) => d.id === sensorId) ?? triggers[0];
  const exportYaml = () => downloadBlob(automationsYaml(project), `${safeFileName(project.name)}-automations.yaml`, 'text/yaml');
  return (
    <>
      <Section title="Neue Regel">
        {triggers.length === 0 ? (
          <p className="muted small">Für eine Regel zuerst einen Bewegungs-/Präsenzmelder oder Tür-/Fensterkontakt platzieren (Schritt 1).</p>
        ) : (
          <>
            <SelectField label="Auslöser" value={sensor?.id ?? ''} options={triggers.map((d) => ({ value: d.id, label: d.name }))} onChange={setSensorId} />
            <button className="primary block" onClick={() => sensor && addAutomationFor(sensor.id)} data-testid="automation-add">
              Regel anlegen
            </button>
            <p className="muted small">Vorschlag: Lampen im selben Raum gehen an, wenn es dunkel ist; danach alles anpassbar.</p>
          </>
        )}
      </Section>
      <Section title={`Regeln (${project.automations.length})`}>
        {project.automations.length === 0 && <p className="muted small">Noch keine Regel.</p>}
        {project.automations.map((a) => (
          <AutomationEditor key={a.id} project={project} a={a} />
        ))}
        <button className="block" onClick={exportYaml} disabled={!project.automations.length} data-testid="ha-export">
          Als Home-Assistant-YAML herunterladen
        </button>
      </Section>
    </>
  );
}

function AutomationEditor({ project, a }: { project: Project; a: Automation }) {
  const derived = useMemo(() => derivePlan(project), [project]);
  const targets = project.devices.filter((d) => d.kind === 'light' || d.kind === 'plug');
  const roomName = (d: SmartDevice) => project.rooms.find((r) => r.id === roomAt(project, derived, d))?.name;
  const s = ruleSentence(project, a);
  return (
    <details className={css.automation} data-testid="automation" data-name={a.name}>
      <summary>
        <span className={a.enabled ? undefined : 'muted'}>
          {s.when}, {s.then}.
        </span>
      </summary>
      <TextField label="Name" value={a.name} onChange={(name) => updateAutomation(a.id, (x) => void (x.name = name))} />
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
        Regel löschen
      </button>
    </details>
  );
}

function TestStep({ project, derived, room, setRoomId }: RoomProps) {
  const { running, speed, state, start, stop, setSpeed, setPerson } = useSimStore();
  const placePerson = () => {
    const g = room && derived.rooms.get(room.id);
    if (g) setPerson(polygonCentroid(g.interior));
  };
  return (
    <>
      <Section title="Simulation">
        <p className="muted small">Die Person im Plan (ziehbar) oder du selbst im Rundgang löst die Melder aus. Einzelne Geräte lassen sich auch über „Eigenschaften“ schalten oder auslösen.</p>
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
        </div>
        <RoomSelect project={project} room={room} setRoomId={setRoomId} />
        <button className="block" onClick={placePerson} disabled={!room} data-testid="sim-person">
          Person in „{room?.name ?? '–'}“ stellen
        </button>
        <SelectField label="Tempo" value={String(speed)} options={SPEEDS.map((s) => ({ value: String(s), label: s === 1 ? 'Echtzeit' : `${s}× schneller` }))} onChange={(v) => setSpeed(Number(v))} />
        {state && (
          <p className="small" data-testid="sim-clock">
            Simulierte Uhrzeit {formatSimHour(state.hour)} · {Math.round(state.t)} s simuliert
          </p>
        )}
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
    </>
  );
}
