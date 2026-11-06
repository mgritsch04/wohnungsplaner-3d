import { useMemo, useState } from 'react';
import { derivePlan } from '../model/derived';
import { boundsOf } from '../model/vec';
import type { Project, SmartDevice, WifiAp, WifiClient, WifiClientType, WifiNeighbor, WifiStandard } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Badge, CheckField, NumberField, SelectField, Section, TextField } from '../ui/fields';
import { updateDevice } from './actions';
import { useSimStore } from './simStore';
import {
  accessPoint,
  ASSUMED_TX_DBM,
  BACKHAUL_LABEL,
  BAND_COLOR,
  BAND_LABEL,
  BAND5_MIN_DBM,
  BANDS,
  EU_EIRP_DBM,
  ITU_N,
  LEVEL_COLOR,
  LEVEL_LABEL,
  LEVEL_MIN_DBM,
  LEVEL_ORDER,
  recommendBands,
  roomWifi,
  ROLE_LABEL,
  STANDARDS,
  WALL_LOSS,
  WALL_SOURCES,
  type ApRole,
  type Backhaul,
  type WifiBand,
} from './wifi';
import { addNeighbor, applySuggestion, removeClient, removeNeighbor, updateClient, updateNeighbor } from './wifiActions';
import { signalGrid } from './WifiOverlay2D';
import {
  buildNet,
  CCA_PREAMBLE_DBM,
  channelAdvice,
  channelChoices,
  checkClients,
  CLIENT_TYPES,
  FLOOR_LABEL,
  fmtMbps,
  linkChecks,
  LOAD_LABEL,
  LOSS_COLOR,
  LOSS_LABEL,
  LOSS_ORDER,
  MAC_EFFICIENCY,
  NEIGHBOR_EXTRA_DB,
  neighborReach,
  RATE_COLOR,
  RATE_LABEL,
  RATE_MIN,
  RATE_ORDER,
  rateGrid,
  roomRates,
  routerHint,
  suggestNodes,
  TARGET_MBPS,
  type ClientCheck,
  type HeatBand,
  type HeatMode,
  type NodeSuggestion,
  type RoomRate,
} from './wifiPlan';
import css from './SmartHomePanel.module.css';

const HEAT_BANDS: { value: HeatBand; label: string }[] = [{ value: 'best', label: 'Bestes Band (automatisch)' }, ...BANDS.map((b) => ({ value: b as HeatBand, label: BAND_LABEL[b] }))];
const MODES: { value: HeatMode; label: string }[] = [
  { value: 'rate', label: 'Datenrate (Mbit/s)' },
  { value: 'signal', label: 'Signalstärke (dBm)' },
  { value: 'interference', label: 'Störung durch Nachbar-WLANs' },
];
const PLACE_ROLES: { role: ApRole; label: string }[] = [
  { role: 'router', label: 'Router' },
  { role: 'mesh', label: 'Mesh-Knoten' },
  { role: 'repeater', label: 'Repeater' },
  { role: 'ap', label: 'Access Point (Kabel)' },
];
const roomName = (p: Project, id: string) => p.rooms.find((r) => r.id === id)?.name ?? '–';

/** WLAN planning (#253, #354, #492): colour layer, access points, own devices, neighbour networks, suggestions. */
export function WifiSection({ project }: { project: Project }) {
  const { wifiOn, wifiBand, wifiRec, wifiMode, setWifi, setWifiBand, setWifiRec, setWifiMode, setPlacing, placing, wifiPlacing, setWifiPlacing, wifiSuggest, setWifiSuggest } = useSimStore();
  const derived = useMemo(() => derivePlan(project), [project]);
  const aps = project.devices.filter((d) => d.kind === 'router');
  const net = useMemo(() => (wifiOn && aps.length ? buildNet(project, derived) : null), [wifiOn, aps.length, project, derived]);
  const signalRooms = useMemo(() => (wifiOn && aps.length ? roomWifi(signalGrid(project, derived, wifiBand), project) : []), [wifiOn, aps.length, wifiBand, project, derived]);
  const rates = useMemo(() => (net ? new Map(roomRates(rateGrid(net, wifiBand), project).map((r) => [r.roomId, r])) : new Map<string, RoomRate>()), [net, wifiBand, project]);
  const recs = useMemo(() => (wifiOn && aps.length ? recommendBands(project, derived) : []), [wifiOn, aps.length, project, derived]);
  const clients = useMemo(() => (net ? checkClients(net) : []), [net]);
  const links = useMemo(() => (net ? linkChecks(net) : []), [net]);
  const channels = useMemo(() => (net ? channelAdvice(net) : []), [net]);
  const reach = useMemo(() => (net ? neighborReach(net) : []), [net]);
  const hint = useMemo(() => (wifiOn && aps.length === 1 ? routerHint(project, derived) : null), [wifiOn, aps.length, project, derived]);
  const [suggestRole, setSuggestRole] = useState<NodeSuggestion['role']>('mesh');
  const [suggested, setSuggested] = useState(false);
  const [clientType, setClientType] = useState<WifiClientType>('laptop');

  const placeAp = (role: ApRole) => {
    if (placing?.kind === 'router' && (placing.wifi?.role ?? 'router') === role) return setPlacing(null);
    setWifiPlacing(null);
    setPlacing({ kind: 'router', wifi: role === 'router' ? undefined : { role } });
  };
  const runSuggest = () => {
    setSuggested(true);
    setWifiSuggest(suggestNodes(project, derived, suggestRole, 2));
  };
  const newNeighbor = () => {
    const b = boundsOf(project.rooms.flatMap((r) => derived.rooms.get(r.id)?.interior ?? []));
    const id = addNeighbor({ name: `Nachbar ${project.wifiNeighbors.length + 1}`, x: b ? (b.minX + b.maxX) / 2 : 0, y: b ? b.minY - 0.6 : 0, band: '2.4', channel: 6, width: 20, floor: 'same', load: 'medium' });
    setPlacing(null);
    setWifiPlacing({ type: 'neighbor', id });
  };

  return (
    <Section title="WLAN-Abdeckung">
      <CheckField label="Abdeckung im Plan anzeigen" checked={wifiOn} onChange={setWifi} />
      <SelectField label="Ansicht" value={wifiMode} options={MODES} onChange={setWifiMode} />
      <SelectField label="Band" value={wifiBand} options={HEAT_BANDS} onChange={setWifiBand} />
      <CheckField label="Empfehlung 2,4 oder 5 GHz im Plan färben" checked={wifiRec} onChange={setWifiRec} />
      <div className="btn-row" data-testid="wifi-place-ap">
        {PLACE_ROLES.map((r) => (
          <button key={r.role} onClick={() => placeAp(r.role)} aria-pressed={placing?.kind === 'router' && (placing.wifi?.role ?? 'router') === r.role} data-testid="wifi-place" data-role={r.role}>
            {r.label} setzen
          </button>
        ))}
      </div>
      {placing?.kind === 'router' && <p className={`small ${css.hint}`}>Klicke im 2D-Plan, wo {PLACE_ROLES.find((r) => r.role === (placing.wifi?.role ?? 'router'))?.label} stehen soll. Esc bricht ab.</p>}
      {wifiOn && aps.length === 0 && <p className="warning small">Noch kein Router: oben „Router setzen“ und in den Plan klicken.</p>}
      {wifiOn && aps.length > 0 && net && (
        <>
          <Legend mode={wifiRec ? 'rec' : wifiMode} />
          <h4 className="small">Router und Zugangspunkte</h4>
          <ul className={css.list} data-testid="wifi-aps">
            {aps.map((d) => {
              const a = accessPoint(d);
              const link = links.find((l) => l.apId === d.id);
              const ch = channels.filter((c) => c.apId === d.id);
              return (
                <li key={d.id} className="small" data-testid="wifi-ap" data-name={d.name} data-role={a.role}>
                  <button className="link" onClick={() => useUiStore.getState().setSelection({ type: 'device', id: d.id })} title="Einstellungen unter „Eigenschaften“">
                    <strong>{d.name}</strong>
                  </button>{' '}
                  <span className="muted">
                    {ROLE_LABEL[a.role]} · {STANDARDS[a.standard].label.split(' (')[0]}
                    {a.model ? ` · ${a.model}` : ''}
                  </span>
                  {link && (
                    <div data-testid="wifi-link-text" data-quality={link.quality}>
                      {link.quality === 'good' ? '✓' : '⚠'} {link.text}
                    </div>
                  )}
                  {ch.map((c) => (
                    <div key={c.band} className={c.better ? 'warning' : 'muted'} data-testid="wifi-channel" data-band={c.band} data-better={c.better} data-best={c.best}>
                      {BAND_LABEL[c.band]}: {c.text}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          <NumberField label="Internet-Anschluss (Mbit/s, 0 = unbekannt)" value={project.wifiInternetMbps ?? 0} min={0} max={100000} digits={0} onChange={(v) => useProjectStore.getState().apply((d) => void (v > 0 ? (d.wifiInternetMbps = v) : delete d.wifiInternetMbps))} />

          <h4 className="small">Räume</h4>
          <ul className={css.list} data-testid="wifi-rooms">
            {signalRooms.map((r) => {
              const rate = rates.get(r.roomId);
              return (
                <li key={r.roomId} className={css.row} data-testid="wifi-room" data-room={roomName(project, r.roomId)} data-level={r.level} data-dbm={r.dbm.toFixed(1)} data-mbps={rate?.mbps.toFixed(1)}>
                  <span>{roomName(project, r.roomId)}</span>
                  <span title={`typisch ${Math.round(r.dbm)} dBm, schwächste Stellen ${Math.round(r.weakDbm)} dBm${rate ? `; ca. ${fmtMbps(rate.mbps)}, schwächste Stellen ${fmtMbps(rate.weakMbps)}` : ''}`}>
                    {rate && <span className="muted small">ca. {fmtMbps(rate.mbps)} </span>}
                    {wifiMode === 'rate' && rate ? (
                      <Badge kind={rate.level === 'fast' || rate.level === 'good' ? 'ok' : rate.level === 'ok' ? 'muted' : 'warn'}>{RATE_LABEL[rate.level]}</Badge>
                    ) : (
                      <Badge kind={r.level === 'good' ? 'ok' : r.level === 'medium' ? 'muted' : 'warn'}>{LEVEL_LABEL[r.level]}</Badge>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {hint && (
            <p className="small" data-testid="wifi-router-hint">
              💡 {hint.text}
            </p>
          )}

          <h4 className="small">Empfehlung: Repeater oder Mesh</h4>
          <div className={css.inline}>
            <SelectField
              label="Art"
              value={suggestRole}
              options={[
                { value: 'mesh', label: 'Mesh-Knoten' },
                { value: 'repeater', label: 'Repeater (Steckdose)' },
                { value: 'ap', label: 'Access Point mit LAN-Kabel' },
              ]}
              onChange={(v) => {
                setSuggestRole(v);
                setWifiSuggest(null);
                setSuggested(false);
              }}
            />
            <button className="primary" onClick={runSuggest} data-testid="wifi-suggest">
              Wo hinstellen?
            </button>
          </div>
          {suggested && wifiSuggest && wifiSuggest.length === 0 && <p className="small" data-testid="wifi-suggest-none">✓ Kein weiterer Knoten nötig: laut Schätzung reicht die Abdeckung{clients.length ? ' für alle Geräte' : ''}.</p>}
          {wifiSuggest && wifiSuggest.length > 0 && (
            <ol className="small" data-testid="wifi-suggest-list">
              {wifiSuggest.map((s, i) => (
                <li key={i} data-testid="wifi-suggest-item" data-room={roomName(project, s.roomId)} data-after={s.after.share.toFixed(3)} data-before={s.before.share.toFixed(3)}>
                  <strong>
                    {i === 0 ? '' : 'Falls das nicht reicht: '}in „{roomName(project, s.roomId)}“
                  </strong>{' '}
                  (im Plan markiert). {s.reason}
                  {i === 0 && (
                    <div className="btn-row">
                      <button
                        onClick={() => {
                          applySuggestion(s);
                          setWifiSuggest(null);
                          setSuggested(false);
                        }}
                        data-testid="wifi-suggest-apply"
                      >
                        Übernehmen
                      </button>
                      <button onClick={() => (setWifiSuggest(null), setSuggested(false))}>Verwerfen</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">Gesucht wird die Stelle mit der meisten Fläche ab {fmtMbps(TARGET_MBPS)} und den meisten versorgten Geräten. Die Verbindung zum Router zählt mit: Zu weit weg bringt ein Repeater nichts.</p>

          <h4 className="small">Eigene Geräte ({clients.length})</h4>
          <div className={css.inline}>
            <SelectField label="Gerät" value={clientType} options={(Object.keys(CLIENT_TYPES) as WifiClientType[]).map((t) => ({ value: t, label: CLIENT_TYPES[t].label }))} onChange={setClientType} />
            <button
              onClick={() => {
                setPlacing(null);
                setWifiPlacing(wifiPlacing?.type === 'client' ? null : { type: 'client', clientType });
              }}
              aria-pressed={wifiPlacing?.type === 'client'}
              data-testid="wifi-client-place"
            >
              {wifiPlacing?.type === 'client' ? 'Abbrechen' : 'Im Plan setzen'}
            </button>
          </div>
          {wifiPlacing?.type === 'client' && <p className={`small ${css.hint}`}>Klicke im 2D-Plan, wo {CLIENT_TYPES[wifiPlacing.clientType].label} meistens benutzt wird. Esc bricht ab.</p>}
          <ul className={css.list} data-testid="wifi-clients">
            {clients.map((c) => (
              <ClientRow key={c.id} project={project} check={c} />
            ))}
          </ul>
          {!clients.length && <p className="muted small">Laptop, Fernseher, PC, Konsole … dort setzen, wo sie benutzt werden. Dann siehst du je Gerät, ob das WLAN reicht. Smart-Home-Geräte mit WLAN zählen automatisch mit.</p>}

          <h4 className="small">Nachbar-WLANs ({project.wifiNeighbors.length})</h4>
          <p className="muted small">Name, Band und Kanal zeigt eine WLAN-Analyse-App am Handy oder die Liste der Nachbarnetze im Menü deines Routers. Setze das Netz dorthin, wo der Nachbar-Router ungefähr steht (z. B. hinter der Wand zur Nachbarwohnung). Mit einem gemessenen Wert wird die Schätzung genauer.</p>
          <button onClick={newNeighbor} data-testid="wifi-neighbor-add">
            Nachbar-WLAN hinzufügen
          </button>
          {wifiPlacing?.type === 'neighbor' && <p className={`small ${css.hint}`} data-testid="wifi-neighbor-placing">Klicke im 2D-Plan, wo der Router des Nachbarn ungefähr steht. Esc lässt es an der vorläufigen Stelle.</p>}
          {wifiPlacing?.type === 'measure' && <p className={`small ${css.hint}`}>Klicke im 2D-Plan, wo du gemessen hast. Esc bricht ab.</p>}
          <ul className={css.list} data-testid="wifi-neighbors">
            {project.wifiNeighbors.map((n) => (
              <NeighborRow key={n.id} n={n} reach={reach.find((r) => r.id === n.id)?.maxDbm} />
            ))}
          </ul>

          <h4 className="small">Welches Band je Raum?</h4>
          <ul className={css.list} data-testid="wifi-recs">
            {recs.map((r) => (
              <li key={r.roomId} data-testid="wifi-rec" data-room={roomName(project, r.roomId)} data-band={r.band} data-dbm24={r.dbm24.toFixed(1)} data-dbm5={r.dbm5.toFixed(1)}>
                <strong>{roomName(project, r.roomId)}</strong>: hier besser {BAND_LABEL[r.band]}
                <br />
                <span className="muted small">
                  2,4 GHz {Math.round(r.dbm24)} dBm, 5 GHz {Math.round(r.dbm5)} dBm. {r.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">5 GHz wird empfohlen, wenn dort mindestens {BAND5_MIN_DBM} dBm ankommen (mehr Tempo), sonst 2,4 GHz (mehr Reichweite).</p>
        </>
      )}
      <p className="small warning" data-testid="wifi-hint">
        Schätzung, keine Messung. Messen mit dem Handy ersetzt das nicht.
      </p>
      <HowItWorks />
    </Section>
  );
}

function Legend({ mode }: { mode: HeatMode | 'rec' }) {
  if (mode === 'rec')
    return (
      <ul className={css.legend} data-testid="wifi-rec-legend">
        {(['2.4', '5'] as WifiBand[]).map((b) => (
          <li key={b}>
            <span className={css.swatch} style={{ background: BAND_COLOR[b] }} /> besser {BAND_LABEL[b]}
          </li>
        ))}
      </ul>
    );
  if (mode === 'signal')
    return (
      <ul className={css.legend} data-testid="wifi-legend">
        {LEVEL_ORDER.map((l) => (
          <li key={l}>
            <span className={css.swatch} style={{ background: LEVEL_COLOR[l] }} /> {LEVEL_LABEL[l]}
            <span className="muted"> {l === 'none' ? `unter ${LEVEL_MIN_DBM.weak} dBm` : `ab ${LEVEL_MIN_DBM[l]} dBm`}</span>
          </li>
        ))}
      </ul>
    );
  if (mode === 'rate')
    return (
      <ul className={css.legend} data-testid="wifi-legend">
        {RATE_ORDER.map((l) => (
          <li key={l}>
            <span className={css.swatch} style={{ background: RATE_COLOR[l] }} /> {RATE_LABEL[l]}
            <span className="muted"> {l === 'none' ? `unter ${RATE_MIN.slow} Mbit/s` : `ab ${RATE_MIN[l]} Mbit/s`}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <ul className={css.legend} data-testid="wifi-legend">
      {LOSS_ORDER.map((l) => (
        <li key={l}>
          <span className={css.swatch} style={{ background: LOSS_COLOR[l] }} /> {LOSS_LABEL[l]}
        </li>
      ))}
    </ul>
  );
}

function ClientRow({ project, check: c }: { project: Project; check: ClientCheck }) {
  const own = project.wifiClients.find((x) => x.id === c.id);
  const [open, setOpen] = useState(false);
  return (
    <li className="small" data-testid="wifi-client" data-name={c.name} data-ok={c.ok} data-mbps={c.mbps.toFixed(1)}>
      <div className={css.row}>
        <span>
          <strong>{c.name}</strong> <span className="muted">{CLIENT_TYPES[c.type].label}{!c.own ? ' (aus Smart Home)' : ''}</span>
        </span>
        <Badge kind={c.ok ? 'ok' : 'warn'}>{c.ok ? 'reicht' : 'reicht nicht'}</Badge>
      </div>
      <div className={c.ok ? 'muted' : 'warning'} data-testid="wifi-client-advice">
        {c.advice}
      </div>
      {own && (
        <div className="btn-row">
          <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Fertig' : 'Bearbeiten'}
          </button>
          <button className="link" onClick={() => removeClient(own.id)} data-testid="wifi-client-remove">
            Entfernen
          </button>
        </div>
      )}
      {own && open && <ClientFields c={own} />}
    </li>
  );
}

function ClientFields({ c }: { c: WifiClient }) {
  const t = CLIENT_TYPES[c.type];
  return (
    <div className={css.details}>
      <TextField label="Name" value={c.name} onChange={(name) => updateClient(c.id, { name })} />
      <SelectField label="Art" value={c.type} options={(Object.keys(CLIENT_TYPES) as WifiClientType[]).map((v) => ({ value: v, label: CLIENT_TYPES[v].label }))} onChange={(type) => updateClient(c.id, { type })} />
      <NumberField label={`Braucht (Mbit/s, typisch ${t.needMbps})`} value={c.needMbps ?? t.needMbps} min={0.1} max={10000} digits={1} onChange={(needMbps) => updateClient(c.id, { needMbps })} />
      <SelectField
        label="Kann"
        value={c.bands ?? t.bands}
        options={[
          { value: '2.4', label: 'nur 2,4 GHz' },
          { value: '2.4+5', label: '2,4 + 5 GHz' },
          { value: '2.4+5+6', label: '2,4 + 5 + 6 GHz (WLAN 6E/7)' },
        ]}
        onChange={(bands) => updateClient(c.id, { bands })}
      />
    </div>
  );
}

function NeighborRow({ n, reach }: { n: WifiNeighbor; reach?: number }) {
  const [open, setOpen] = useState(false);
  const { setWifiPlacing } = useSimStore();
  const chOptions = n.band === '2.4' ? Array.from({ length: 13 }, (_, i) => i + 1) : channelChoices(n.band, 20);
  return (
    <li className="small" data-testid="wifi-neighbor" data-name={n.name} data-reach={reach?.toFixed(1)}>
      <div className={css.row}>
        <span>
          <strong>{n.name}</strong>{' '}
          <span className="muted">
            {BAND_LABEL[n.band]}, Kanal {n.channel}
            {n.band !== '2.4' ? ` (${n.width} MHz)` : ''} · {FLOOR_LABEL[n.floor]}
          </span>
        </span>
        {reach !== undefined && Number.isFinite(reach) && (
          <Badge kind={reach >= CCA_PREAMBLE_DBM ? 'warn' : 'muted'} title="stärkste Stelle in der Wohnung">
            bis {Math.round(reach)} dBm
          </Badge>
        )}
      </div>
      <div className="btn-row">
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="wifi-neighbor-edit">
          {open ? 'Fertig' : 'Bearbeiten'}
        </button>
        <button className="link" onClick={() => setWifiPlacing({ type: 'neighbor', id: n.id })}>
          Im Plan setzen
        </button>
        <button className="link" onClick={() => removeNeighbor(n.id)} data-testid="wifi-neighbor-remove">
          Entfernen
        </button>
      </div>
      {open && (
        <div className={css.details}>
          <TextField label="Name (SSID)" value={n.name} onChange={(name) => updateNeighbor(n.id, { name })} />
          <SelectField
            label="Band"
            value={n.band}
            options={BANDS.map((b) => ({ value: b, label: BAND_LABEL[b] }))}
            onChange={(band) => updateNeighbor(n.id, { band, channel: band === '2.4' ? 6 : band === '5' ? 36 : 1, width: band === '2.4' ? 20 : 80 })}
          />
          <SelectField label="Kanal" value={String(n.channel)} options={chOptions.map((c) => ({ value: String(c), label: String(c) }))} onChange={(v) => updateNeighbor(n.id, { channel: Number(v) })} />
          {n.band !== '2.4' && (
            <SelectField label="Kanalbreite" value={String(n.width)} options={['20', '40', '80', '160'].map((w) => ({ value: w, label: `${w} MHz` }))} onChange={(v) => updateNeighbor(n.id, { width: Number(v) as WifiNeighbor['width'] })} />
          )}
          <SelectField label="Wo" value={n.floor} options={(Object.keys(FLOOR_LABEL) as WifiNeighbor['floor'][]).map((f) => ({ value: f, label: FLOOR_LABEL[f] }))} onChange={(floor) => updateNeighbor(n.id, { floor })} />
          <SelectField label="Nutzung" value={n.load} options={(Object.keys(LOAD_LABEL) as WifiNeighbor['load'][]).map((l) => ({ value: l, label: LOAD_LABEL[l] }))} onChange={(load) => updateNeighbor(n.id, { load })} />
          <NumberField label="Gemessen (dBm, 0 = keine Messung)" value={n.measuredDbm ?? 0} min={-100} max={0} digits={0} onChange={(v) => updateNeighbor(n.id, { measuredDbm: v < -10 ? Math.round(v) : undefined })} />
          {n.measuredDbm !== undefined && (
            <button className="link" onClick={() => setWifiPlacing({ type: 'measure', id: n.id })} data-testid="wifi-measure-place">
              {n.measuredAt ? 'Messpunkt neu setzen' : 'Messpunkt im Plan setzen (sonst: nächste Stelle in der Wohnung)'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

const STD_OPTIONS = (Object.keys(STANDARDS) as WifiStandard[]).map((s) => ({ value: s, label: STANDARDS[s].label }));

/** WLAN settings of a router / access point in its device info (#492). */
export function WifiApFields({ project, device: d }: { project: Project; device: SmartDevice }) {
  const a = accessPoint(d);
  const set = (patch: Partial<WifiAp>) => {
    const next: WifiAp = { ...(d.wifi ?? {}), ...patch };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete (next as Record<string, unknown>)[k];
    updateDevice(d.id, { wifi: next });
  };
  const others = project.devices.filter((x) => x.kind === 'router' && x.id !== d.id);
  const chField = (band: WifiBand, key: 'ch24' | 'ch5' | 'ch6') => {
    if (!a.bands.includes(band)) return null;
    const list = band === '2.4' ? Array.from({ length: 13 }, (_, i) => i + 1) : channelChoices(band, band === '5' ? 20 : 20);
    return (
      <SelectField
        key={band}
        label={`Kanal ${BAND_LABEL[band]}`}
        value={a.channel[band] === undefined ? 'auto' : String(a.channel[band])}
        options={[{ value: 'auto', label: 'automatisch' }, ...list.map((c) => ({ value: String(c), label: String(c) }))]}
        onChange={(v) => set({ [key]: v === 'auto' ? undefined : Number(v) })}
      />
    );
  };
  return (
    <div className={css.details} data-testid="wifi-ap-fields">
      <SelectField label="Rolle" value={a.role} options={(Object.keys(ROLE_LABEL) as ApRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} onChange={(role) => set({ role, backhaul: undefined, uplinkId: role === 'router' ? undefined : d.wifi?.uplinkId })} />
      <TextField label="Modell (eigene Angabe)" value={a.model ?? ''} placeholder="z. B. Name vom Typenschild" onChange={(model) => set({ model: model.trim() || undefined })} />
      <SelectField label="WLAN-Standard" value={a.standard} options={STD_OPTIONS} onChange={(standard) => set({ standard })} />
      <SelectField label="Antennen (Datenströme)" value={String(a.streams)} options={['1', '2', '3', '4'].map((s) => ({ value: s, label: `${s}×${s}` }))} onChange={(v) => set({ streams: Number(v) })} />
      {a.role !== 'router' && (
        <>
          <SelectField label="Verbindung" value={a.backhaul} options={(Object.keys(BACKHAUL_LABEL) as Backhaul[]).map((b) => ({ value: b, label: BACKHAUL_LABEL[b] }))} onChange={(backhaul) => set({ backhaul })} />
          {a.backhaul !== 'wired' && (
            <SelectField label="Hängt an" value={a.uplinkId ?? 'auto'} options={[{ value: 'auto', label: 'automatisch (stärkster)' }, ...others.map((o) => ({ value: o.id, label: o.name }))]} onChange={(v) => set({ uplinkId: v === 'auto' ? undefined : v })} />
          )}
        </>
      )}
      {chField('2.4', 'ch24')}
      {chField('5', 'ch5')}
      {a.bands.includes('5') && (
        <SelectField label="Kanalbreite 5 GHz" value={String(a.width['5'])} options={['20', '40', '80', '160'].filter((w) => Number(w) <= STANDARDS[a.standard].maxWidth['5']).map((w) => ({ value: w, label: `${w} MHz` }))} onChange={(v) => set({ width5: Number(v) as WifiAp['width5'] })} />
      )}
      {chField('6', 'ch6')}
      <NumberField
        label={`Sendeleistung (dBm, Datenblatt; 0 = EU-Grenze ${EU_EIRP_DBM['2.4']}/${EU_EIRP_DBM['5']} dBm)`}
        value={d.wifi?.txDbm ?? 0}
        min={0}
        max={36}
        digits={0}
        onChange={(v) => set({ txDbm: v > 0 ? v : undefined })}
      />
      <p className="muted small">Typen sind Geräteklassen nach WLAN-Standard, keine Produktdaten. Den Kanal zeigt das Router-Menü; „automatisch“ nimmt den freiesten an.</p>
    </div>
  );
}

function HowItWorks() {
  return (
    <details className="small">
      <summary>Wie wird gerechnet?</summary>
      <p className="muted">
        Pfadverlust nach ITU-R P.1238 (Wohngebäude, N = {ITU_N}) plus ein fester Abzug je Wand, geschlossener Tür oder Fenster auf der Geraden zum Router; schräg getroffene Wände zählen bis doppelt. Wandart aus der eingetragenen Bauart, sonst aus der Dicke
        geschätzt. Sendeleistung ohne Datenblatt: EU-Grenze ({ASSUMED_TX_DBM} dBm bei 2,4 GHz, {EU_EIRP_DBM['5']} dBm bei 5 und 6 GHz). Keine Reflexionen.
      </p>
      <p className="muted">
        Datenrate: aus dem Signal-Rausch-Abstand die Modulationsstufe nach IEEE 802.11ax (WLAN 5 und 4 weniger, WLAN 7 mehr), mal Kanalbreite und Antennen, davon ca. {Math.round(MAC_EFFICIENCY * 100)} % nutzbar. Ein Repeater sendet alles zweimal auf demselben
        Funk (halbe Rate), ein Tri-Band-Mesh nutzt ein eigenes Band, ein Access Point das Kabel. Der Internet-Anschluss begrenzt alles.
      </p>
      <p className="muted">
        Nachbar-WLANs: Auf demselben Kanal teilen sich die Netze die Sendezeit (ab {CCA_PREAMBLE_DBM} dBm), teils überlappende 2,4-GHz-Kanäle stören als Rauschen. Ohne Messung wird hinter der Nachbarwand {NEIGHBOR_EXTRA_DB} dB zusätzlich angenommen, durch eine Decke{' '}
        {WALL_LOSS.ceiling['2.4']} dB. Eigene Geräte: typische Bedarfe als Annahme, je Gerät änderbar.
      </p>
      <ul className="muted">
        {(['light', 'aerated', 'masonry', 'masonryThick', 'concrete', 'door', 'window', 'ceiling'] as const).map((k) => (
          <li key={k}>
            {WALL_LOSS[k].label}: {WALL_LOSS[k]['2.4']} / {WALL_LOSS[k]['5']} / {WALL_LOSS[k]['6']} dB (2,4 / 5 / 6 GHz)
          </li>
        ))}
      </ul>
      <p className="muted">Richtwerte, abgeleitet aus:</p>
      <ul>
        {WALL_SOURCES.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
