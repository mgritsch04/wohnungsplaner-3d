/// <reference types="vitest/config" />
import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pwaPlugin } from './pwa/plugin';

// App version for the bug report (#62): package version + short commit, if git is available
const pkgVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();

/**
 * Claude-Artefakt-Build (#129): `vite build --mode artifact` → dist-artifact/.
 * Alles Artefakt-Spezifische ist hier gekapselt; der normale Build (dist/) bleibt unverändert.
 *  - base './': alle Pfade relativ (das Artefakt liegt unter einem unbekannten Unterpfad,
 *    veröffentlichte Dateien haben keinen führenden Schrägstrich).
 *  - .mjs-Assets (pdf.js-Worker) bekommen die Endung .js, damit nur gängige Web-Endungen
 *    entstehen (der Medientyp wird beim Veröffentlichen aus der Endung abgeleitet).
 */
function artifactOverrides(): UserConfig {
  return {
    base: './',
    build: {
      outDir: 'dist-artifact',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
      rolldownOptions: {
        output: {
          assetFileNames: (asset) => {
            const name = asset.names[0] ?? '';
            return name.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
  };
}

/**
 * GitHub-Pages-Build (#179): `vite build --mode pages` → dist-pages/, als installierbare Web-App
 * unter https://mgritsch04.github.io/wohnungsplaner-3d/ (Manifest, Symbole, Service Worker: pwa/plugin.ts).
 */
function pagesOverrides(): UserConfig {
  return {
    base: '/wohnungsplaner-3d/',
    plugins: [react(), pwaPlugin()],
    build: { outDir: 'dist-pages', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(commit ? `${pkgVersion} (${commit})` : pkgVersion),
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  ...(mode === 'artifact' ? artifactOverrides() : {}),
  ...(mode === 'pages' ? pagesOverrides() : {}),
}));
