/**
 * Bookmarklet „An Planer senden“ (#221). Runs on the product page the user has opened on
 * ikea.com or moebelix.at and sends THIS page's structured data (meta tags, JSON-LD) plus its
 * visible text to the local helper – one page per click, nothing else is fetched.
 * The token is the helper's secret; it is embedded only in the user's own bookmark.
 */
import { IKEA_HELPER_URL } from './ikeaHelper';

/**
 * Page script (readable form); `__TOKEN__`/`__HELPER__` are filled in by buildBookmarklet.
 * The shops' Content-Security-Policy forbids requests to other hosts but allows frames, so the
 * script embeds the helper's small receiving page and hands it the data via postMessage
 * (addressed to the helper's origin only); that page posts it to the helper.
 */
function pageScript() {
  const helper = '__HELPER__';
  const say = (t: string) => window.alert(`An Planer senden: ${t}`);
  // only on the shops' own pages; elsewhere just a message
  if (!['www.ikea.com', 'www.moebelix.at'].includes(location.hostname)) {
    say('Das geht nur auf Produktseiten von ikea.com oder moebelix.at.');
    return;
  }
  const pick = (sel: string) => Array.from(document.querySelectorAll(sel), (e) => e.outerHTML).join('');
  const text = (document.body?.innerText ?? '').slice(0, 200000).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  const html = `<html><head>${pick('meta,link[rel=canonical],script[type="application/ld+json"]')}</head><body><pre>${text}</pre></body></html>`;
  const frame = document.createElement('iframe');
  frame.src = `${helper}/empfang`;
  frame.title = 'An Planer senden';
  frame.setAttribute('style', 'position:fixed;top:16px;right:16px;width:360px;height:120px;z-index:2147483647;border:2px solid #0058a3;border-radius:8px;background:#fff');
  let ready = false;
  const done = (ms: number) =>
    window.setTimeout(() => {
      frame.remove();
      window.removeEventListener('message', onMessage);
    }, ms);
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== helper || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'wp-ready' && !ready) {
      ready = true;
      frame.contentWindow?.postMessage({ type: 'wp-send', payload: { token: '__TOKEN__', url: location.href, html } }, helper);
    } else if (e.data?.type === 'wp-result') done(e.data.ok ? 4000 : 9000);
  };
  window.addEventListener('message', onMessage);
  document.body.appendChild(frame);
  window.setTimeout(() => {
    if (ready) return;
    done(0);
    say('Der IKEA-Helfer läuft nicht. Bitte im Projektordner „npm run ikea-helper“ starten.');
  }, 5000);
}

export function buildBookmarklet(token: string, helper = IKEA_HELPER_URL): string {
  if (!/^[0-9a-f]+$/.test(token)) throw new Error('ungültiges Token');
  const body = pageScript
    .toString()
    .replace(/__TOKEN__/g, token)
    .replace(/__HELPER__/g, helper);
  return `javascript:(${encodeURIComponent(body)})();void 0`;
}
