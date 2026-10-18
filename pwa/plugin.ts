/**
 * Installierbare Web-App (PWA) für iPhone und Co. (#179): nur im GitHub-Pages-Build
 * (`vite build --mode pages`). Der normale Build (dist/, E2E) und das Claude-Artefakt
 * bleiben unverändert.
 *  - index.html: Manifest-Link, App-Symbol fürs iPhone, Vollbild-Tags, Registrierung des Service Workers
 *  - dist-pages/: manifest.webmanifest, icons/, sw.js (mit der Liste aller Build- und public/-Dateien)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const ICON_DIR = new URL('./icons/', import.meta.url);
const ICONS = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
const THEME = '#2563eb';

const manifest = {
  name: 'Wohnungsplaner 3D',
  short_name: 'Wohnungsplaner',
  description: 'Wohnung in 2D zeichnen, in 3D einrichten und begehen – alles bleibt auf dem Gerät.',
  lang: 'de',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: THEME,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : [full];
  });
}

export function pwaPlugin(): Plugin {
  let publicDir = '';
  let base = '/';
  return {
    name: 'wohnungsplaner-pwa',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
      base = config.base;
    },
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: THEME }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: manifest.short_name }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }, injectTo: 'head' },
        {
          tag: 'script',
          children: "if ('serviceWorker' in navigator) addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });",
          injectTo: 'body',
        },
      ];
    },
    generateBundle(_options, bundle) {
      for (const icon of ICONS) {
        this.emitFile({ type: 'asset', fileName: `icons/${icon}`, source: readFileSync(new URL(icon, ICON_DIR)) });
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });

      const built = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map'));
      const fromPublic = publicDir ? filesIn(publicDir).map((f) => relative(publicDir, f).split(sep).join('/')) : [];
      const precache = ['./', 'manifest.webmanifest', ...ICONS.map((i) => `icons/${i}`), ...built, ...fromPublic];
      const version = String(Date.now());
      const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('= __PRECACHE__;', `= ${JSON.stringify([...new Set(precache)])};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}
