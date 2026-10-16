import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a pre-installed Chromium when available (e.g. cloud containers), otherwise Playwright's own.
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
// Port of the preview server; set PW_PORT to run a second E2E suite in parallel (e.g. another worktree)
// without reusing – or killing – the other suite's server.
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: existsSync(localChromium) ? localChromium : undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
