import type { Project } from '../model/schema';

/**
 * "Problem melden" (#62): a plain-text report for a GitHub issue with browser, screen,
 * app version and the state of the app – without personal data. Names, addresses, product
 * names/links and the plan itself are only included when the user explicitly asks for it.
 */

const MAX_ERRORS = 5;
const recentErrors: string[] = [];

/** Keep the last few uncaught errors (message only, shortened) for the report. */
export function recordError(message: string) {
  const m = message.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!m) return;
  recentErrors.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
}

export function recentErrorMessages(): string[] {
  return [...recentErrors];
}

let installed = false;
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => recordError(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason instanceof Error ? e.reason.message : String(e.reason)));
}

export interface ReportEnv {
  userAgent: string;
  language: string;
  screen: string;
  viewport: string;
  pixelRatio: number;
  webgl: boolean;
  online: boolean;
}

export function currentEnv(): ReportEnv {
  const webgl = (() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  })();
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${screen.width} × ${screen.height}`,
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    webgl,
    online: navigator.onLine,
  };
}

export interface ReportState {
  viewMode: string;
  cameraMode: string;
  tool: string;
  selection: string;
  saveState: string;
}

export interface ReportInput {
  version: string;
  env: ReportEnv;
  project: Project;
  state: ReportState;
  errors: string[];
  description?: string;
  /** Explicit opt-in: append the plan (rooms, walls, furniture …) as JSON. */
  includeProject?: boolean;
}

/** Plan data for the opt-in attachment: no embedded files (images/models), only references. */
function projectForReport(p: Project): unknown {
  return JSON.parse(JSON.stringify(p, (_k, v: unknown) => (typeof v === 'string' && v.startsWith('data:') ? `[data-URL, ${v.length} Zeichen]` : v)));
}

export function buildBugReport(r: ReportInput): string {
  const p = r.project;
  const counts = [
    `${p.rooms.length} Räume`,
    `${p.walls.length} Wände`,
    `${p.openings.length} Öffnungen`,
    `${p.furniture.length} Möbel/Geräte`,
    `${p.lights.length} Leuchten`,
  ].join(', ');
  const lines = [
    '## Beschreibung',
    r.description?.trim() || '_Was hast du gemacht, was ist passiert, was hast du erwartet?_',
    '',
    '## Umgebung',
    `- App-Version: ${r.version}`,
    `- Browser: ${r.env.userAgent}`,
    `- Sprache: ${r.env.language}`,
    `- Bildschirm: ${r.env.screen}, Fenster: ${r.env.viewport}, Pixelverhältnis: ${r.env.pixelRatio}`,
    `- WebGL: ${r.env.webgl ? 'verfügbar' : 'nicht verfügbar'} · online: ${r.env.online ? 'ja' : 'nein'}`,
    '',
    '## Zustand der App',
    `- Ansicht: ${r.state.viewMode}, Kamera: ${r.state.cameraMode}, Werkzeug: ${r.state.tool}`,
    `- Auswahl: ${r.state.selection}`,
    `- Speichern: ${r.state.saveState}`,
    `- Projekt: ${counts}; Schema-Version ${p.schemaVersion}`,
    '',
    '## Letzte Fehlermeldungen',
    ...(r.errors.length ? r.errors.map((e) => `- ${e}`) : ['- keine']),
  ];
  if (r.includeProject) {
    lines.push('', '<details><summary>Projektdaten (auf Wunsch angefügt)</summary>', '', '```json', JSON.stringify(projectForReport(p)), '```', '', '</details>');
  }
  return lines.join('\n');
}

const REPO_NEW_ISSUE = 'https://github.com/mgritsch04/wohnungsplaner-3d/issues/new';

/** Link to a new GitHub issue; the body is only prefilled while the URL stays short. */
export function newIssueUrl(title: string, body: string): { url: string; bodyIncluded: boolean } {
  const withBody = `${REPO_NEW_ISSUE}?${new URLSearchParams({ title, body }).toString()}`;
  if (withBody.length <= 7000) return { url: withBody, bodyIncluded: true };
  return { url: `${REPO_NEW_ISSUE}?${new URLSearchParams({ title }).toString()}`, bodyIncluded: false };
}

let lastSaveState = 'unbekannt';
/** App reports its autosave state here so the report can include it. */
export function noteSaveState(s: string) {
  lastSaveState = s;
}
export function currentSaveState(): string {
  return lastSaveState;
}
