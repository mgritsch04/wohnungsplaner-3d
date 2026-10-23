/**
 * Wohnungs-Check (#357)
 * ---------------------
 * Runs all existing plan checks in one go and returns one sorted list plus a traffic light:
 * collisions and door swing (#4, #267), narrow passages (#68), walk routes between rooms (#67),
 * kitchen work triangle (#82), daylight (#69), Wi-Fi coverage (#253), circuit load (#135) and
 * sensor coverage (#236). Nothing is re-implemented here – every finding comes from the
 * module that owns the rule. Each finding carries the place in the plan to jump to.
 *
 * Severity: `error` (red) must be fixed, `warn` (yellow) is worth a look, `info` is a hint that
 * does not change the traffic light.
 */
import { kitchenWorkTriangles } from '../kitchen/workTriangle';
import { roomCoverage, occludersOf } from '../smarthome/simulation';
import { levelOf, LEVEL_LABEL, roomWifi, wifiGrid } from '../smarthome/wifi';
import { checkCircuits, formatWatts } from './circuits';
import { computeDaylight, DAYLIGHT_LABEL, isOutdoorRoom } from './daylight';
import type { DerivedPlan } from './derived';
import { buildPlacementObstacles, furnitureConflicts, issueLevel, type PlacementIssue } from './placement';
import { findNarrowPassages, passageLabel } from './passages';
import type { Project } from './schema';
import { shortestWalkPath } from './walkPath';
import { dist, type Vec2 } from './vec';

export type CheckSeverity = 'error' | 'warn' | 'info';
export type CheckCategory = 'collision' | 'doorSwing' | 'passage' | 'walk' | 'kitchen' | 'daylight' | 'wifi' | 'circuit' | 'sensor';

export const CHECK_CATEGORY_LABEL: Record<CheckCategory, string> = {
  collision: 'Kollisionen',
  doorSwing: 'Türaufschlag',
  passage: 'Engstellen',
  walk: 'Laufwege',
  kitchen: 'Küchendreieck',
  daylight: 'Tageslicht',
  wifi: 'WLAN',
  circuit: 'Stromkreise',
  sensor: 'Melder-Abdeckung',
};

const CATEGORY_ORDER = Object.keys(CHECK_CATEGORY_LABEL) as CheckCategory[];
const SEVERITY_ORDER: Record<CheckSeverity, number> = { error: 0, warn: 1, info: 2 };

export interface CheckItem {
  id: string;
  category: CheckCategory;
  severity: CheckSeverity;
  title: string;
  detail?: string;
  /** Where to jump in the plan (plan metres); absent when the finding has no place. */
  at?: Vec2;
  /** Select this object on arrival. */
  select?: { type: 'furniture' | 'room' | 'device' | 'fixture'; id: string };
}

export type Traffic = 'green' | 'yellow' | 'red';

export interface PlanCheckResult {
  /** The project object the check ran on – lets the UI tell when the plan changed afterwards. */
  planRef: Project;
  items: CheckItem[];
  traffic: Traffic;
  counts: Record<CheckSeverity, number>;
  /** Findings per category, including 0 – so the list shows what was checked and found fine. */
  perCategory: { category: CheckCategory; label: string; count: number; checked: boolean }[];
}

export const TRAFFIC_LABEL: Record<Traffic, string> = {
  green: 'Alles in Ordnung',
  yellow: 'Einiges prüfen',
  red: 'Es gibt Probleme',
};

/** Rooms where daylight matters (living, sleeping, working, kitchen) – a bathroom or hallway without a window is no problem. */
const DAYLIGHT_ROOM = /(wohn|schlaf|kinder|arbeit|büro|buero|küche|kueche|zimmer|essen|gäste|gaeste)/i;

const roomName = (p: Project, id: string) => p.rooms.find((r) => r.id === id)?.name ?? 'Raum';
const furnitureName = (p: Project, id: string) => p.furniture.find((f) => f.id === id)?.name ?? 'Möbel';

export function runPlanCheck(project: Project, derived: DerivedPlan): PlanCheckResult {
  const items: CheckItem[] = [];
  const checked = new Set<CheckCategory>(['collision', 'doorSwing', 'passage']);
  const centre = (roomId: string): Vec2 | undefined => derived.rooms.get(roomId)?.centroid;

  // collisions and door swing (one finding per item and category)
  const conflicts = furnitureConflicts(project, derived, buildPlacementObstacles(derived));
  for (const [id, c] of conflicts) {
    const f = project.furniture.find((x) => x.id === id);
    if (!f) continue;
    const groups: [CheckCategory, PlacementIssue[]][] = [
      ['doorSwing', c.issues.filter((i) => i.kind === 'door-swing')],
      ['collision', c.issues.filter((i) => i.kind !== 'door-swing')],
    ];
    for (const [category, issues] of groups) {
      if (!issues.length) continue;
      const severity: CheckSeverity = issues.some((i) => issueLevel(i.kind) === 'error') ? 'error' : 'warn';
      items.push({
        id: `${category}:${id}`,
        category,
        severity,
        title: `„${f.name}“ ${[...new Set(issues.map((i) => i.short))].join(' · ')}`,
        at: { x: f.x, y: f.y },
        select: { type: 'furniture', id },
      });
    }
  }

  // narrow passages
  for (const [i, n] of findNarrowPassages(project, derived).entries()) {
    const furn = n.refs.filter((r) => r.type === 'furniture').map((r) => `„${furnitureName(project, r.id)}“`);
    const what = n.kind === 'opening' ? 'Tür/Durchgang' : furn.length > 1 ? `zwischen ${furn.join(' und ')}` : `${furn[0] ?? 'Möbel'} an der Wand`;
    const firstFurniture = n.refs.find((r) => r.type === 'furniture');
    items.push({
      id: `passage:${i}`,
      category: 'passage',
      severity: 'warn',
      title: `Engstelle ${passageLabel(n.width)} – ${what}`,
      detail: `Mindestbreite im Projekt: ${passageLabel(project.settings.minPassageWidth)}.`,
      at: { x: (n.a.x + n.b.x) / 2, y: (n.a.y + n.b.y) / 2 },
      select: firstFurniture ? { type: 'furniture', id: firstFurniture.id } : undefined,
    });
  }

  // walk routes: every room must be reachable from the first one (closed doors do not count – they can be opened)
  if (project.rooms.length > 1) {
    checked.add('walk');
    const start = project.rooms.find((r) => derived.rooms.has(r.id) && !isOutdoorRoom(r));
    const from = start && centre(start.id);
    if (start && from) {
      for (const r of project.rooms) {
        const to = centre(r.id);
        if (r.id === start.id || !to || isOutdoorRoom(r)) continue;
        const res = shortestWalkPath(project, derived, from, to, { cell: 0.1 });
        if (res.ok || !/Möbel|Wände oder zu schmale/.test(res.reason)) continue;
        items.push({
          id: `walk:${r.id}`,
          category: 'walk',
          severity: 'error',
          title: `„${r.name}“ ist von „${start.name}“ aus nicht erreichbar`,
          detail: res.reason.replace(/^Kein Weg gefunden \(|\)$/g, '').replace(/^./, (c) => c.toUpperCase()),
          at: to,
          select: { type: 'room', id: r.id },
        });
      }
    }
  }

  // kitchen work triangle
  checked.add('kitchen');
  for (const k of kitchenWorkTriangles(project, derived, project.settings.kitchenTriangle)) {
    if (k.ok) continue;
    const corner = k.corners?.sink.point ?? centre(k.roomId);
    for (const [i, m] of k.messages.entries()) {
      items.push({
        id: `kitchen:${k.roomId}:${i}`,
        category: 'kitchen',
        severity: k.corners ? 'warn' : 'info',
        title: m,
        at: corner,
        select: k.corners ? { type: 'furniture', id: k.corners.sink.id } : { type: 'room', id: k.roomId },
      });
    }
  }

  // daylight
  checked.add('daylight');
  for (const r of computeDaylight(project, derived).rooms) {
    if (r.level === 'high' || r.level === 'medium') continue;
    const room = project.rooms.find((x) => x.id === r.roomId);
    if (!room) continue;
    const habitable = DAYLIGHT_ROOM.test(room.name);
    items.push({
      id: `daylight:${r.roomId}`,
      category: 'daylight',
      severity: r.level === 'none' && habitable ? 'warn' : 'info',
      title: `„${r.name}“: ${DAYLIGHT_LABEL[r.level]}`,
      at: centre(r.roomId),
      select: { type: 'room', id: r.roomId },
    });
  }

  // Wi-Fi (only when a router is placed)
  if (project.devices.some((d) => d.kind === 'router')) {
    checked.add('wifi');
    for (const w of roomWifi(wifiGrid(project, derived, '2.4'), project)) {
      const level = levelOf(w.dbm);
      if (level === 'good' || level === 'medium') continue;
      items.push({
        id: `wifi:${w.roomId}`,
        category: 'wifi',
        severity: level === 'none' ? 'warn' : 'info',
        title: `„${roomName(project, w.roomId)}“: ${LEVEL_LABEL[level]} (${Math.round(w.dbm)} dBm)`,
        detail: 'Gilt für 2,4 GHz; 5 GHz reicht meist weniger weit.',
        at: centre(w.roomId),
        select: { type: 'room', id: w.roomId },
      });
    }
  }

  // circuits (only when circuits or consumers exist)
  if (project.circuits.length || project.loads.length) {
    checked.add('circuit');
    const check = checkCircuits(project);
    for (const c of check.circuits) {
      if (c.status === 'ok') continue;
      const socket = c.loads.map((l) => project.fixtures.find((f) => f.id === l.fixtureId)).find(Boolean);
      items.push({
        id: `circuit:${c.circuit.id}`,
        category: 'circuit',
        severity: c.status === 'over' ? 'error' : 'warn',
        title: `Stromkreis „${c.circuit.name}“: ${formatWatts(c.totalW)} von ${formatWatts(c.capacityW)} (${c.percent} %)`,
        detail: c.status === 'over' ? 'Die Sicherung würde auslösen.' : `Über der Dauerlast-Grenze von ${formatWatts(c.limitW)}.`,
        at: socket && { x: socket.x, y: socket.y },
        select: socket ? { type: 'fixture', id: socket.id } : undefined,
      });
    }
    if (check.unassigned.length) {
      items.push({
        id: 'circuit:unassigned',
        category: 'circuit',
        severity: 'info',
        title: `${check.unassigned.length} Verbraucher ohne Stromkreis (${check.unassigned.map((l) => l.name).slice(0, 3).join(', ')}${check.unassigned.length > 3 ? ' …' : ''})`,
      });
    }
  }

  // sensor coverage (only when motion/presence sensors exist)
  const sensors = project.devices.filter((d) => d.kind === 'motion' || d.kind === 'presence');
  if (sensors.length) {
    checked.add('sensor');
    const coverage = roomCoverage(project, derived, occludersOf(project, derived));
    for (const [roomId, share] of coverage) {
      const room = project.rooms.find((r) => r.id === roomId);
      if (!room || isOutdoorRoom(room) || share >= 0.6) continue;
      const nearest = sensors.length ? sensors.reduce((b, s) => (dist(s, centre(roomId) ?? s) < dist(b, centre(roomId) ?? b) ? s : b)) : null;
      items.push({
        id: `sensor:${roomId}`,
        category: 'sensor',
        severity: share === 0 ? 'info' : 'warn',
        title: share === 0 ? `„${room.name}“ hat keinen Bewegungs-/Präsenzmelder` : `„${room.name}“: Melder decken nur ${Math.round(share * 100)} % der Fläche ab`,
        at: centre(roomId),
        select: share > 0 && nearest ? { type: 'device', id: nearest.id } : { type: 'room', id: roomId },
      });
    }
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.title.localeCompare(b.title, 'de'));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of items) counts[i.severity]++;
  return {
    planRef: project,
    items,
    counts,
    traffic: counts.error ? 'red' : counts.warn ? 'yellow' : 'green',
    perCategory: CATEGORY_ORDER.map((category) => ({ category, label: CHECK_CATEGORY_LABEL[category], count: items.filter((i) => i.category === category).length, checked: checked.has(category) })),
  };
}
