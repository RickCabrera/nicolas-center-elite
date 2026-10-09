// QA-06 · Mide la carga en un celular de gama media simulado: CPU 4x más lenta y red 4G.
import { chromium, devices } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 70, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 });
const rows = [];
async function measure(path) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  const m = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const bytes = performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) + (n.transferSize || 0);
    return { fcp: Math.round(fcp?.startTime ?? 0), load: Math.round(n.loadEventEnd), kb: Math.round(bytes / 1024) };
  });
  rows.push({ ruta: path, ...m });
}
await measure('/login');
await page.fill('#u', 'k.ocampo'); await page.fill('#p', 'Elite2026demo'); await page.click('button[type=submit]'); await page.waitForURL(/inicio/);
for (const p of ['/inicio', '/pacientes', '/agenda', '/huella']) await measure(p);
console.table(rows);
await browser.close();
