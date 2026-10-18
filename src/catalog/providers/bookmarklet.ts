/**
 * Bookmarklet „An Planer senden“ (#221). Runs on the product page the user has opened on
 * ikea.com or moebelix.at and sends THIS page's structured data (meta tags, JSON-LD) plus its
 * visible text to the local helper – one page per click, nothing else is fetched.
 * The token is the helper's secret; it is embedded only in the user's own bookmark.
 */
import { IKEA_HELPER_URL } from './ikeaHelper';

/**
 * Page script (readable form); `__TOKEN__`/`__HELPER__` are filled in by buildBookmarklet.
 * The shops' Content-Security-Policy forbids requests to other hosts, so the script embeds the
 * helper's small receiving page and hands it the data via postMessage (addressed to the helper's
 * origin only); that page posts it to the helper. Möbelix also forbids frames from other hosts
 * (#273): when the frame is blocked or does not answer, the receiving page opens as a small
 * window instead (a CSP does not restrict opening windows). If that fails too, a panel explains
 * how to start the helper and offers to copy the page for Katalog › Produkt importieren.
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
  const payload = { token: '__TOKEN__', url: location.href, html };
  const frame = document.createElement('iframe');
  frame.src = `${helper}/empfang`;
  frame.title = 'An Planer senden';
  // CSSOM instead of a style attribute: a strict style-src would drop the attribute
  const box = (el: HTMLElement, w: string, h: string) =>
    Object.assign(el.style, { position: 'fixed', top: '16px', right: '16px', width: w, height: h, zIndex: '2147483647', border: '2px solid #0058a3', borderRadius: '8px', background: '#fff', color: '#111', font: '14px system-ui,sans-serif', boxSizing: 'border-box' });
  box(frame, '360px', '120px');
  let popup: Window | null = null;
  let target: MessageEventSource | null = null;
  let stage = 'frame';
  const stop = () => {
    frame.remove();
    window.removeEventListener('message', onMessage);
    document.removeEventListener('securitypolicyviolation', onCsp);
  };
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== helper || !e.source || (e.source !== frame.contentWindow && e.source !== popup)) return;
    if (e.data?.type === 'wp-ready' && !target) {
      target = e.source;
      (e.source as Window).postMessage({ type: 'wp-send', payload }, helper);
    } else if (e.data?.type === 'wp-result' && e.source === target) window.setTimeout(stop, e.data.ok ? 4000 : 9000);
  };
  // last resort: say what the helper is for, and offer the page for pasting into the planner
  const offerCopy = () => {
    if (target || stage === 'copy') return;
    stage = 'copy';
    stop();
    popup?.close();
    const panel = document.createElement('div');
    box(panel, '380px', 'auto');
    panel.style.padding = '12px 14px';
    const line = (t: string) => panel.appendChild(Object.assign(document.createElement('p'), { textContent: t }));
    line('Wohnungsplaner: Der Planer-Helfer antwortet nicht.');
    line('Er übernimmt diese Seite in den Planer (Katalog › IKEA) und lädt Foto bzw. 3D-Modell. Starten: im Projektordner „npm run ikea-helper“, dann das Lesezeichen noch einmal klicken.');
    line('Ohne Helfer: „Seite kopieren“ und im Planer unter Katalog › Produkt importieren einfügen.');
    const button = (label: string, act: () => void) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
      b.style.marginRight = '8px';
      b.addEventListener('click', act);
      panel.appendChild(b);
      return b;
    };
    const copy = button('Seite kopieren', () => {
      const fallback = () => {
        const area = document.createElement('textarea');
        area.value = html;
        panel.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        copy.textContent = ok ? 'Kopiert ✓' : 'Kopieren nicht erlaubt';
      };
      if (navigator.clipboard) navigator.clipboard.writeText(html).then(() => (copy.textContent = 'Kopiert ✓'), fallback);
      else fallback();
    });
    button('Schließen', () => panel.remove());
    document.body.appendChild(panel);
  };
  const openWindow = () => {
    if (target || stage !== 'frame') return;
    stage = 'window';
    frame.remove();
    popup = window.open(`${helper}/empfang`, 'wohnungsplaner-empfang', 'popup,width=420,height=200');
    if (!popup) offerCopy();
    else window.setTimeout(offerCopy, 6000);
  };
  const onCsp = (e: SecurityPolicyViolationEvent) => {
    if (e.blockedURI.startsWith(helper)) openWindow();
  };
  window.addEventListener('message', onMessage);
  document.addEventListener('securitypolicyviolation', onCsp);
  document.body.appendChild(frame);
  window.setTimeout(openWindow, 2500);
}

export function buildBookmarklet(token: string, helper = IKEA_HELPER_URL): string {
  if (!/^[0-9a-f]+$/.test(token)) throw new Error('ungültiges Token');
  const body = pageScript
    .toString()
    .replace(/__TOKEN__/g, token)
    .replace(/__HELPER__/g, helper);
  return `javascript:(${encodeURIComponent(body)})();void 0`;
}
