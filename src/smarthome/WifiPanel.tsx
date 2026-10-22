import { useMemo } from 'react';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { Badge, CheckField, SelectField, Section } from '../ui/fields';
import { useSimStore } from './simStore';
import { ASSUMED_TX_DBM, BAND_LABEL, ITU_N, LEVEL_COLOR, LEVEL_LABEL, LEVEL_MIN_DBM, LEVEL_ORDER, roomWifi, WALL_LOSS, WALL_SOURCES, wifiGrid, type WifiBand } from './wifi';
import css from './SmartHomePanel.module.css';

/** WLAN coverage (#253): switch the colour layer on, pick the band, value per room. */
export function WifiSection({ project }: { project: Project }) {
  const { wifiOn, wifiBand, setWifi, setWifiBand } = useSimStore();
  const routers = project.devices.filter((d) => d.kind === 'router').length;
  const rooms = useMemo(() => (wifiOn ? roomWifi(wifiGrid(project, derivePlan(project), wifiBand), project) : []), [wifiOn, wifiBand, project]);
  return (
    <Section title="WLAN-Abdeckung">
      <CheckField label="Abdeckung im Plan anzeigen" checked={wifiOn} onChange={setWifi} />
      <SelectField label="Band" value={wifiBand} options={(Object.keys(BAND_LABEL) as WifiBand[]).map((b) => ({ value: b, label: BAND_LABEL[b] }))} onChange={(v) => setWifiBand(v as WifiBand)} />
      {wifiOn && routers === 0 && <p className="warning small">Noch kein Router: oben „Router / Access Point“ wählen und platzieren.</p>}
      {wifiOn && routers > 0 && (
        <>
          <ul className={css.legend} data-testid="wifi-legend">
            {LEVEL_ORDER.map((l) => (
              <li key={l}>
                <span className={css.swatch} style={{ background: LEVEL_COLOR[l] }} /> {LEVEL_LABEL[l]}
                <span className="muted"> {l === 'none' ? `unter ${LEVEL_MIN_DBM.weak} dBm` : `ab ${LEVEL_MIN_DBM[l]} dBm`}</span>
              </li>
            ))}
          </ul>
          <ul className={css.list} data-testid="wifi-rooms">
            {rooms.map((r) => (
              <li key={r.roomId} className={css.row} data-testid="wifi-room" data-room={project.rooms.find((x) => x.id === r.roomId)?.name} data-level={r.level} data-dbm={r.dbm.toFixed(1)}>
                <span>{project.rooms.find((x) => x.id === r.roomId)?.name}</span>
                <span title={`typisch ${Math.round(r.dbm)} dBm, schwächste Stellen ${Math.round(r.weakDbm)} dBm`}>
                  <Badge kind={r.level === 'good' ? 'ok' : r.level === 'medium' ? 'muted' : 'warn'}>{LEVEL_LABEL[r.level]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small warning" data-testid="wifi-hint">
        Schätzung, keine Messung. Messen mit dem Handy ersetzt das nicht.
      </p>
      <details className="small">
        <summary>Wie wird gerechnet?</summary>
        <p className="muted">
          Pfadverlust nach ITU-R P.1238 (Wohngebäude, N = {ITU_N}) plus ein fester Abzug je Wand, geschlossener Tür oder Fenster auf der Geraden zum Router. Sendeleistung ohne Datenblatt: Annahme {ASSUMED_TX_DBM} dBm (EU-Grenze 100 mW). Keine Reflexionen, keine
          Geschosse. Wandart wird aus der Dicke geschätzt.
        </p>
        <ul className="muted">
          {(['light', 'masonry', 'concrete', 'door', 'window'] as const).map((k) => (
            <li key={k}>
              {WALL_LOSS[k].label}: {WALL_LOSS[k]['2.4']} dB (2,4 GHz), {WALL_LOSS[k]['5']} dB (5 GHz)
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
    </Section>
  );
}
