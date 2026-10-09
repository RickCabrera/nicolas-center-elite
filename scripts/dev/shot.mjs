// Utilidad de desarrollo: captura pantallas con sesión iniciada.
// Uso: node scripts/dev/shot.mjs <usuario> <contraseña> <salida-dir> <ruta[@ancho]>...
import { chromium } from '@playwright/test';
const [user, pass, out, ...routes] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
for (const r of routes) {
  const [path, w] = r.split('@');
  const width = Number(w ?? 1440);
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', path, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', path, m.text().slice(0, 300)));
  if (user !== '-') {
    await page.goto(base + '/login');
    await page.fill('#u', user);
    await page.fill('#p', pass);
    await page.click('button[type=submit]');
    await page.waitForURL(/inicio|cambiar/);
  }
  await page.goto(base + path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const name = (path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root') + '_' + width + '.png';
  await page.screenshot({ path: `${out}/${name}`, fullPage: true });
  console.log('ok', name);
  await ctx.close();
}
await browser.close();
