/**
 * Access to Claude from inside the Claude artifact (#151): the artifact runtime offers
 * `window.claude.use('sample')`, which asks Claude on the viewer's own account – no API key
 * anywhere. The normal web app has no `window.claude`, so the feature stays hidden there.
 */

export type SampleErrorCode =
  | 'cancelled'
  | 'not_granted'
  | 'sampling_disabled'
  | 'not_declared'
  | 'capability_disabled'
  | 'capability_removed'
  | 'rate_limited'
  | 'session_expired'
  | 'refused'
  | 'empty_completion'
  | 'invalid_json'
  | 'prompt_too_large'
  | 'upstream_error'
  | string;

export interface SampleError {
  code: SampleErrorCode;
  message?: string;
  text?: string;
}

export interface SampleOptions {
  signal?: AbortSignal;
  modelTier?: 'quick' | 'default' | 'complex';
  cache?: boolean;
}

/** The part of the runtime's `sample` function this app uses. */
export interface Sample {
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

function runtime(): ClaudeRuntime | null {
  const c = (globalThis as { claude?: Partial<ClaudeRuntime> }).claude;
  return c && typeof c.use === 'function' ? (c as ClaudeRuntime) : null;
}

let pending: Promise<Sample | null> | null = null;

/** Resolves the `sample` capability, or null where Claude cannot be asked (web app, declined …). */
export function loadSample(): Promise<Sample | null> {
  if (!pending) {
    const rt = runtime();
    pending = rt
      ? rt.use('sample').then(
          (s) => (s && typeof (s as Partial<Sample>).json === 'function' ? (s as Sample) : null),
          () => null,
        )
      : Promise.resolve(null);
  }
  return pending;
}

/** Codes after which the feature is hidden for this view (permanent, never re-asked). */
export const HIDE_CODES: SampleErrorCode[] = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

export function errorText(e: unknown): string {
  const code = (e as SampleError | undefined)?.code ?? 'upstream_error';
  switch (code) {
    case 'not_granted':
      return 'Claude wurde für diese Seite nicht erlaubt.';
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'Claude ist hier nicht verfügbar.';
    case 'rate_limited':
      return 'Gerade zu viele Anfragen oder Nutzungsgrenze erreicht – bitte später erneut fragen.';
    case 'session_expired':
      return 'Bitte bei Claude neu anmelden und erneut fragen.';
    case 'refused':
      return 'Claude hat diese Frage abgelehnt – bitte anders formulieren.';
    case 'invalid_json':
    case 'empty_completion':
      return 'Die Antwort war nicht lesbar – bitte erneut fragen oder kürzer formulieren.';
    case 'prompt_too_large':
      return 'Der Plan ist für eine Anfrage zu groß – bitte einen einzelnen Raum wählen.';
    default:
      return 'Claude ist gerade nicht erreichbar – bitte erneut versuchen.';
  }
}
