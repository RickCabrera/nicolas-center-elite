import { defineConfig, devices } from '@playwright/test';

/**
 * QA-03 · Pruebas de punta a punta en navegador real, contra la app corriendo con la base de demostración:
 *   pnpm db:reset && pnpm db:seed && pnpm build && pnpm start      (en otra terminal)
 *   pnpm test:e2e
 * BASE_URL cambia el destino (por ejemplo un despliegue de staging con la base de demostración).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
});
