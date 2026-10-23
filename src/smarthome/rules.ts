import type { Automation, Project } from '../model/schema';
import { formatSimHour } from './simulation';

/** A rule as one readable sentence (#233): „Wenn …, dann …“. */
export function ruleSentence(project: Pick<Project, 'devices'>, a: Automation): { when: string; then: string } {
  const name = (id: string) => project.devices.find((d) => d.id === id)?.name ?? 'unbekanntes Gerät';
  const tr = a.trigger;
  const cond = a.onlyWhenDark ? ' und es dunkel ist' : '';
  const when =
    tr.type === 'time'
      ? `Wenn es ${formatSimHour(tr.hour)} Uhr ist${cond}`
      : tr.type === 'contact'
        ? `Wenn ${name(tr.deviceId)} ${tr.to === 'open' ? 'geöffnet' : 'geschlossen'} wird${cond}`
        : `Wenn ${name(tr.deviceId)} Bewegung meldet${cond}`;
  const targets = a.action.deviceIds.map(name);
  const what = targets.length ? targets.join(', ') : '(noch kein Gerät gewählt)';
  const allBlinds = a.action.deviceIds.length > 0 && a.action.deviceIds.every((id) => project.devices.find((d) => d.id === id)?.kind === 'blind');
  if (allBlinds) {
    const pct = a.action.brightness ?? 100;
    return { when, then: `dann ${what} ${!a.action.on ? 'auf' : pct >= 100 ? 'zu' : `${Math.round(pct)} % zu`}` };
  }
  const level = a.action.on && a.action.brightness !== undefined && a.action.brightness < 100 ? ` (${Math.round(a.action.brightness)} %)` : '';
  const off = tr.type === 'motion' && a.action.on && a.offAfterS ? `, aus nach ${formatDuration(a.offAfterS)} ohne Bewegung` : '';
  return { when, then: `dann ${what} ${a.action.on ? 'an' : 'aus'}${level}${off}` };
}

export function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = s / 60;
  return Number.isInteger(m) ? `${m} min` : `${m.toFixed(1).replace('.', ',')} min`;
}

/** Rules in which a device triggers or is switched. */
export const rulesOf = (project: Pick<Project, 'automations'>, deviceId: string) =>
  project.automations.filter((a) => ('deviceId' in a.trigger && a.trigger.deviceId === deviceId) || a.action.deviceIds.includes(deviceId));
