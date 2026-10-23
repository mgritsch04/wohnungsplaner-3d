/**
 * Read/switch client for a Home Assistant instance (#229, stage 2a). Only used by Node scripts
 * (CI against a throw-away HA with `demo:`) and tests; it is not imported by the app, so no
 * token ever reaches the browser bundle (D8). The token is passed in by the caller at runtime.
 * Plain type-only imports and no enums, so Node can run it directly (--experimental-strip-types).
 */

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HaBridge {
  getStates(): Promise<HaState[]>;
  getState(entityId: string): Promise<HaState>;
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<HaState[]>;
}

export function createHaBridge(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): HaBridge {
  const base = baseUrl.replace(/\/+$/, '');
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Home Assistant ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  return {
    getStates: () => request<HaState[]>('/api/states'),
    getState: (entityId) => request<HaState>(`/api/states/${encodeURIComponent(entityId)}`),
    callService: (domain, service, data) =>
      request<HaState[]>(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, { method: 'POST', body: JSON.stringify(data) }),
  };
}

/**
 * Onboards a fresh test instance (no users yet) and returns a short-lived access token.
 * Never use this against a real installation: it only works while onboarding is still open.
 */
export async function onboardTestInstance(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const base = baseUrl.replace(/\/+$/, '');
  const clientId = `${base}/`;
  const password = `t-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const user = await fetchImpl(`${base}/api/onboarding/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name: 'CI', username: 'ci', password, language: 'en' }),
  });
  if (!user.ok) throw new Error(`Onboarding: HTTP ${user.status}`);
  const { auth_code } = (await user.json()) as { auth_code: string };
  const tok = await fetchImpl(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: auth_code, client_id: clientId }),
  });
  if (!tok.ok) throw new Error(`Token: HTTP ${tok.status}`);
  return ((await tok.json()) as { access_token: string }).access_token;
}
