import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const localChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    launchOptions: existsSync(localChromium)
      ? {
          executablePath: localChromium,
          args: [
            '--no-sandbox',
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        }
      : {},
  },
  webServer: [
    {
      command: 'DEV_FIXED_DECK=1 pnpm --filter @buraco/server dev:node',
      port: 8787,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
