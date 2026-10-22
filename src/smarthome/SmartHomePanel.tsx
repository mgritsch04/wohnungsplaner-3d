import { useMemo, useState } from 'react';
import { derivePlan, type DerivedPlan } from '../model/derived';
import type { Automation, Project, SmartDevice, SmartDeviceKind } from '../model/schema';
import { polygonCentroid } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Badge, CheckField, NumberField, Section, SelectField, TextField } from '../ui/fields';
import { downloadBlob, safeFileName } from '../ui/fileUtils';
import { addAutomationFor, deleteAutomation, makeLightSmartWithFeedback, placeDevice, roomAt, unlinkedLights, updateAutomation } from './actions';
import { DEVICE_PRODUCTS, KIND_LABEL } from './catalog';
import { deviceOn, statusLabel } from './DeviceInfo';
import { DeviceGlyph, KIND_COLOR } from './glyphs';
import { automationsYaml } from './haYaml';
import { ruleSentence } from './rules';
import { formatSimHour, occludersOf, roomCoverage } from './simulation';
import { parseWishes, SPEAKER_TYPES, suggestAudio } from './audio';
import { suggestSmartHome } from './suggest';
import { applySmartHomeSuggestion, useSmartSuggestStore } from './suggestStore';
import { useFurnishStore } from '../suggest/furnishStore';
import { WifiSection } from './WifiPanel';
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
  const [existingLight, setExistingLight] = useState('');
  const freeLights = unlinkedLights(project);
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
      <SuggestSection project={project} room={room} />
      <AudioSection project={project} room={room} />
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
        {kind === 'light' && freeLights.length > 0 && (
          <SelectField
            label="Vorhandenes Licht nutzen"
            value={existingLight}
            options={[
              { value: '', label: 'Nein, neues Licht anlegen' },
              ...freeLights.map((l) => ({ value: l.id, label: `${l.name} (${project.rooms.find((r) => r.id === roomAt(project, derived, l))?.name ?? 'außerhalb'})` })),
            ]}
            onChange={setExistingLight}
          />
        )}
        <RoomSelect project={project} room={room} setRoomId={setRoomId} />
        <div className="btn-row">
          {kind === 'light' && existingLight && freeLights.some((l) => l.id === existingLight) ? (
            <button className="primary" onClick={() => { makeLightSmartWithFeedback(existingLight, product); setExistingLight(''); }} data-testid="device-add-existing">
              Vorhandenes Licht smart machen
            </button>
          ) : (
            <button className="primary" onClick={() => placeDevice(kind, product, room?.id ?? null)} disabled={!room} data-testid="device-add">
              In „{room?.name ?? '–'}“ platzieren
            </button>
          )}
          <button onClick={clickToPlace} aria-pressed={!!placing} data-testid="device-place-click">
            {placing ? 'Abbrechen' : 'Im Plan klicken'}
          </button>
        </div>
        {placing && (
          <p className={`small ${css.hint}`} data-testid="device-placing-hint">
            {placing.kind === 'strip' ? 'Klicke im 2D-Plan zuerst den Anfang, dann das Ende des LED-Streifens. An Schrank und Wand rastet er ein. Esc bricht ab.' : `Klicke im 2D-Plan dorthin, wo ${KIND_LABEL[placing.kind]} hin soll. Esc bricht ab.`}
          </p>
        )}
      </Section>
      <DeviceList project={project} derived={derived} />
      <WifiSection project={project} />
    </>
  );
}

/** „Smart Home vorschlagen“ (#225): basic equipment for one room or the whole flat as a preview in the plan. */
function SuggestSection({ project, room }: { project: Project; room: Project['rooms'][number] | undefined }) {
  const preview = useSmartSuggestStore((s) => s.preview);
  const setPreview = useSmartSuggestStore((s) => s.setPreview);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const [scope, setScope] = useState<'room' | 'all'>('room');
  const roomName = (id: string) => project.rooms.find((r) => r.id === id)?.name ?? '';
  const propose = () => {
    const ids = scope === 'room' && room ? [room.id] : undefined;
    const ui = useUiStore.getState();
    if (ui.viewMode === '3d') ui.setViewMode('split');
    const s = suggestSmartHome(project, ids, roomTypes);
    setPreview(s);
    if (!s.items.length) ui.toast('Nichts mehr vorzuschlagen – die Räume sind schon ausgestattet.', 'info');
  };
  const price = (c: { min: number; max: number }) => (c.min === c.max ? `${c.min.toFixed(2)} €` : `${c.min.toFixed(0)}–${c.max.toFixed(0)} €`);
  return (
    <Section title="Smart Home vorschlagen">
      <p className="muted small">Grundausstattung nach Raumart: Melder dort, wo sie laut Datenblatt den Raum abdecken, Kontakte an Fenstern und Außentüren, vorhandene Lampen smart. Erst Vorschau, dann übernehmen oder verwerfen.</p>
      <SelectField
        label="Für"
        value={scope}
        options={[
          { value: 'room', label: `Nur „${room?.name ?? '–'}“` },
          { value: 'all', label: 'Ganze Wohnung' },
        ]}
        onChange={(v) => setScope(v as 'room' | 'all')}
      />
      <button className="primary block" onClick={propose} disabled={!room} data-testid="sh-suggest">
        Vorschlag zeigen
      </button>
      {preview && preview.items.length > 0 && (
        <div data-testid="sh-suggest-result">
          <ul className={css.list}>
            {preview.items.map((it) => (
              <li key={it.key} className="small" data-testid="sh-suggest-item" data-kind={it.kind}>
                <strong>{it.name}</strong> – {it.reason}
              </li>
            ))}
          </ul>
          {preview.coverage.map((c) => (
            <p key={c.roomId} className="small" data-testid="sh-suggest-coverage">
              {roomName(c.roomId)}: {Math.round(c.before * 100)} % → {Math.round(c.after * 100)} % erfasst
            </p>
          ))}
          <p className="small" data-testid="sh-suggest-cost">
            Kosten (Schätzung, Preise vor dem Kauf prüfen): {price(preview.cost)}
            {preview.cost.unknown > 0 && ` + ${preview.cost.unknown} Gerät(e) ohne Preisangabe`}
          </p>
          {preview.later.map((l) => (
            <p key={l.roomId} className="muted small">
              {roomName(l.roomId)}: {l.text}
            </p>
          ))}
          <div className="btn-row">
            <button className="primary" onClick={() => applySmartHomeSuggestion(preview)} data-testid="sh-suggest-apply">
              Übernehmen
            </button>
            <button onClick={() => setPreview(null)} data-testid="sh-suggest-discard">
              Verwerfen
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/** „Audio-Setup vorschlagen“ (#138): speaker types per room as a preview; wishes in plain text make a new proposal, the old one stays until one is applied. */
function AudioSection({ project, room }: { project: Project; room: Project['rooms'][number] | undefined }) {
  const preview = useSmartSuggestStore((s) => s.preview);
  const setPreview = useSmartSuggestStore((s) => s.setPreview);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const [wish, setWish] = useState('');
  const [scope, setScope] = useState<'room' | 'all'>('room');
  const audio = preview?.items.some((i) => i.kind === 'speaker') ? preview : null;
  const propose = () => {
    const ui = useUiStore.getState();
    if (ui.viewMode === '3d') ui.setViewMode('split');
    const s = suggestAudio(project, scope === 'room' && room ? [room.id] : undefined, parseWishes(wish), roomTypes);
    if (!s.items.length) {
      ui.toast(s.later[0]?.text ?? 'Kein Audio-Vorschlag möglich: Sofa, Bett oder Schreibtisch fehlen im Raum.', 'info');
      return;
    }
    setPreview(s);
  };
  const roomName = (id: string) => project.rooms.find((r) => r.id === id)?.name ?? '';
  return (
    <Section title="Audio-Setup vorschlagen">
      <p className="muted small">Lautsprecher-Arten (keine Modelle, keine Preise) je Raum mit Platz und Abstand: Wohnzimmer zum Sofa, Schlafzimmer am Bett, Arbeitszimmer am Schreibtisch. Wünsche wie „kompakter“, „Design nicht gut“ oder „mit Subwoofer“ geben einen neuen Vorschlag; der alte bleibt, bis du einen übernimmst.</p>
      <SelectField label="Bereich" value={scope} options={[{ value: 'room', label: `Nur „${room?.name ?? '–'}“` }, { value: 'all', label: 'Ganze Wohnung' }]} onChange={(v) => setScope(v as 'room' | 'all')} />
      <TextField label="Wunsch (optional)" value={wish} onChange={setWish} />
      <button className="primary block" onClick={propose} disabled={!room} data-testid="audio-suggest">
        {audio ? 'Neuer Vorschlag mit Wunsch' : 'Vorschlag zeigen'}
      </button>
      {audio && (
        <div data-testid="audio-result">
          <ul className={css.list}>
            {audio.items.map((it) => (
              <li key={it.key} className="small" data-testid="audio-item" data-type={it.speakerType}>
                <strong>{it.name}</strong> ({it.speakerType ? SPEAKER_TYPES[it.speakerType].label : ''}) – {it.reason}
              </li>
            ))}
          </ul>
          {audio.later.map((l) => (
            <p key={l.roomId} className="muted small">{roomName(l.roomId)}: {l.text}</p>
          ))}
          <p className="small" data-testid="audio-cost">Preis: offen – erst ein echtes Produkt wählen, dann Preis und Quelle prüfen.</p>
          <div className="btn-row">
            <button className="primary" onClick={() => applySmartHomeSuggestion(audio)} data-testid="audio-apply">Übernehmen</button>
            <button onClick={() => setPreview(null)} data-testid="audio-discard">Verwerfen</button>
          </div>
        </div>
      )}
    </Section>
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
  const targets = project.devices.filter((d) => d.kind === 'light' || d.kind === 'plug' || d.kind === 'strip');
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
      {a.action.deviceIds.some((id) => project.devices.find((d) => d.id === id)?.kind === 'strip') && (
        <label className="small">
          Farbe der LED-Streifen
          <input type="color" value={a.action.color ?? '#ffb46b'} aria-label="Farbe der LED-Streifen" data-testid="automation-color" onChange={(e) => updateAutomation(a.id, (x) => void (x.action.color = e.target.value))} />
          {a.action.color && <button className="small" onClick={() => updateAutomation(a.id, (x) => void delete x.action.color)}>zurücksetzen</button>}
        </label>
      )}
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
  const { running, speed, state, start, stop, setSpeed, setPerson, setHour } = useSimStore();
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
          <>
            <p className="small" data-testid="sim-clock">
              Simulierte Uhrzeit {formatSimHour(state.hour)} · {Math.round(state.t)} s simuliert
            </p>
            <label className="small">
              Simulierte Uhrzeit
              <input type="range" min={0} max={24} step={0.25} value={state.hour} aria-label="Simulierte Uhrzeit" data-testid="sim-hour" onChange={(e) => setHour(Number(e.target.value))} />
            </label>
            <div className="btn-row">
              <button onClick={() => setHour(12)} data-testid="sim-day">
                Tag (12:00)
              </button>
              <button onClick={() => setHour(22)} data-testid="sim-night">
                Nacht (22:00)
              </button>
            </div>
          </>
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
