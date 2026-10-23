import { describe, expect, it, vi } from 'vitest';
import { createHaBridge, onboardTestInstance } from './haBridge';

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('haBridge (#229)', () => {
  it('reads states and switches a light with the bearer token', async () => {
    const f = vi.fn((_url: string | URL | Request, _init?: RequestInit) => reply([{ entity_id: 'light.bed_light', state: 'off', attributes: {} }]));
    const bridge = createHaBridge('http://ha:8123/', 'tok', f as unknown as typeof fetch);
    expect((await bridge.getStates())[0].entity_id).toBe('light.bed_light');
    await bridge.callService('light', 'turn_on', { entity_id: 'light.bed_light', brightness_pct: 40 });
    expect(f.mock.calls[0][0]).toBe('http://ha:8123/api/states');
    expect(f.mock.calls[1][0]).toBe('http://ha:8123/api/services/light/turn_on');
    const init = f.mock.calls[1][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ entity_id: 'light.bed_light', brightness_pct: 40 });
  });

  it('fails visibly on HTTP errors', async () => {
    const bridge = createHaBridge('http://ha', 'bad', (() => reply({}, 401)) as unknown as typeof fetch);
    await expect(bridge.getState('light.x')).rejects.toThrow('HTTP 401');
  });

  it('onboards a test instance in two steps and returns the access token', async () => {
    const f = vi.fn((url: string | URL | Request) =>
      String(url).endsWith('/api/onboarding/users') ? reply({ auth_code: 'code' }) : reply({ access_token: 'access' }),
    );
    expect(await onboardTestInstance('http://ha:8123', f as unknown as typeof fetch)).toBe('access');
    expect(f).toHaveBeenCalledTimes(2);
  });
});
