import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * E2E suite for the GitHub Pages build as installable web app (#179): `npm run test:pages`.
 * Builds dist-pages/ and serves it under /wohnungsplaner-3d/ like GitHub Pages.
 */
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const port = Number(process.env.PW_PAGES_PORT ?? 4191);

export default defineConfig({
  testDir: 'e2e-pages',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: existsSync(localChromium) ? localChromium : undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npm run build:pages && node scripts/serve-pages.mjs --port ${port}`,
    url: `http://localhost:${port}/wohnungsplaner-3d/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
