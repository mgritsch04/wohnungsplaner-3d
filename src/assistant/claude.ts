/**
 * Access to Claude without an API key in the browser:
 * - in the Claude artifact (#151) the runtime offers `window.claude.use('sample')`, which asks
 *   Claude on the viewer's own account;
 * - in the locally opened planner (`npm run dev`, #350) the local helper (`npm run ikea-helper`)
 *   forwards the request to the Claude Code command line on the same computer, if installed.
 * Elsewhere there is no Claude and the features stay hidden.
 */
import { IKEA_HELPER_URL } from '../catalog/providers/ikeaHelper';

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

/** A page function Claude may call during one request (artifact runtime only). */
export interface SampleTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute(input: unknown, context?: { signal?: AbortSignal }): unknown;
}

export interface SampleOptions {
  signal?: AbortSignal;
  modelTier?: 'quick' | 'default' | 'complex';
  cache?: boolean;
  tools?: SampleTool[];
  /** Local Claude Code only: allow web search and reading pages of ikea.com / moebelix.at. */
  web?: boolean;
}

/** The part of the runtime's `sample` function this app uses. */
export interface Sample {
  /** 'artifact' = Claude artifact runtime, 'local' = Claude Code through the local helper. */
  kind: 'artifact' | 'local';
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
}

/** Answer text → JSON (the last {...} block; Claude Code may wrap it in prose or a code fence). */
export function jsonFromText(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [fenced, text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!candidate?.trim()) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // next candidate
    }
  }
  throw { code: 'invalid_json', message: 'Antwort ist kein JSON.' } satisfies SampleError;
}

type Fetch = typeof fetch;

/** Why Claude cannot be asked: no runtime and no helper ('helper'), or helper without the Claude Code CLI ('claude'). */
export async function missingClaude(base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<'helper' | 'claude'> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await f(`${base}/status`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    const body = (await res.json()) as { name?: unknown };
    return res.ok && body.name === 'wohnungsplaner-ikea-helper' ? 'claude' : 'helper';
  } catch {
    return 'helper';
  }
}

/** Claude through the local helper (`POST /claude`), when the helper reports Claude Code. */
export async function localSample(base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<Sample | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await f(`${base}/status`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    const body = (await res.json()) as { name?: unknown; claude?: unknown };
    if (!res.ok || body.name !== 'wohnungsplaner-ikea-helper' || body.claude !== true) return null;
  } catch {
    return null;
  }
  return {
    kind: 'local',
    async json<T>(input: string, options: SampleOptions = {}): Promise<T> {
      let res: Response;
      try {
        res = await f(`${base}/claude`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: input, web: options.web === true }), signal: options.signal });
      } catch (e) {
        if (options.signal?.aborted) throw { code: 'cancelled' } satisfies SampleError;
        throw { code: 'upstream_error', message: e instanceof Error ? e.message : String(e) } satisfies SampleError;
      }
      const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
      if (res.status === 429) throw { code: 'rate_limited', message: String(body.error ?? '') } satisfies SampleError;
      if (!res.ok || typeof body.text !== 'string') throw { code: 'upstream_error', message: String(body.error ?? `HTTP ${res.status}`) } satisfies SampleError;
      return jsonFromText(body.text) as T;
    },
  };
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

function runtime(): ClaudeRuntime | null {
  const c = (globalThis as { claude?: Partial<ClaudeRuntime> }).claude;
  return c && typeof c.use === 'function' ? (c as ClaudeRuntime) : null;
}

let pending: Promise<Sample | null> | null = null;

interface RuntimeSample {
  json(input: string, options?: Omit<SampleOptions, 'web'>): Promise<unknown>;
}

/** Resolves Claude: artifact runtime first, else Claude Code through the local helper; null where Claude cannot be asked. */
export function loadSample(): Promise<Sample | null> {
  if (!pending) {
    const rt = runtime();
    pending = rt
      ? rt.use('sample').then(
          (s) => {
            if (!s || typeof (s as Partial<RuntimeSample>).json !== 'function') return null;
            const run = s as RuntimeSample;
            return {
              kind: 'artifact',
              // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `web` is for the local helper only
              json: <T,>(input: string, { web, ...options }: SampleOptions = {}) => run.json(input, options) as Promise<T>,
            } satisfies Sample;
          },
          () => null,
        )
      : localSample();
  }
  return pending;
}

/** The `mcp` capability of the artifact runtime (null outside the artifact). */
export interface McpRuntime {
  callTool(server: string, tool: string, input?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ content?: { type: string; text?: string }[]; payload?: unknown }>;
  listTools(server?: string): Promise<{ servers?: { server: string }[] }>;
}

export function loadMcp(): Promise<McpRuntime | null> {
  const rt = runtime();
  return rt ? rt.use('mcp').then((m) => (m && typeof (m as Partial<McpRuntime>).callTool === 'function' ? (m as McpRuntime) : null), () => null) : Promise.resolve(null);
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
