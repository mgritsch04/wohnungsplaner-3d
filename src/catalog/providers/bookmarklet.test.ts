import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBookmarklet } from './bookmarklet';

const TOKEN = 'ab12cd34ef56ab12cd34ef56';

/** Run the bookmarklet as the browser would (javascript: URL, decoded). */
function run(code: string) {
  const src = decodeURIComponent(code.replace(/^javascript:/, ''));
  new Function(src)();
}

afterEach(() => vi.unstubAllGlobals());

describe('Lesezeichen „An Planer senden“ (#221)', () => {
  it('enthält Token und Helfer-Adresse, sonst nur Code', () => {
    const code = buildBookmarklet(TOKEN, 'http://127.0.0.1:4791');
    expect(code.startsWith('javascript:(')).toBe(true);
    const src = decodeURIComponent(code.slice('javascript:'.length));
    expect(src).toContain(TOKEN);
    expect(src).toContain('http://127.0.0.1:4791');
    expect(src).toContain('/empfang');
    expect(src).not.toContain('__TOKEN__');
    expect(() => buildBookmarklet('x"); alert(1); ("')).toThrow();
  });

  it('schickt auf fremden Seiten nichts, sondern zeigt nur eine Meldung', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    run(buildBookmarklet(TOKEN)); // jsdom runs on localhost
    expect(document.querySelector('iframe')).toBeNull();
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/nur auf Produktseiten von ikea\.com oder moebelix\.at/));
  });
});
