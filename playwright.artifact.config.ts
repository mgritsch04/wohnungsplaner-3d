import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Separate E2E suite for the Claude artifact build (#129): `npm run test:artifact`.
 * Builds dist-artifact/ and serves it under a sub-path, so relative paths are really tested.
 * Not part of the normal suite (playwright.config.ts, testDir e2e) – CI stays unchanged.
 */
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const port = Number(process.env.PW_ARTIFACT_PORT ?? 4190);
export const ARTIFACT_PREFIX = '/foo/bar/';

export default defineConfig({
  testDir: 'e2e-artifact',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: existsSync(localChromium) ? localChromium : undefined,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        // no DNS for foreign hosts: everything except the local test server fails hard
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      ],
    },
  },
  webServer: {
    command: `npm run build:artifact && node scripts/serve-artifact.mjs --port ${port} --prefix ${ARTIFACT_PREFIX}`,
    url: `http://localhost:${port}${ARTIFACT_PREFIX}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
