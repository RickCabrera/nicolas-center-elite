// Captura una pantalla con una hoja abierta. Uso: node scripts/dev/sheet-shot.mjs <usuario> <ruta> "<texto del botón>" <ancho>x<alto> <salida.png>
import { chromium } from '@playwright/test';
const [user, path, button, size, out] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(base + '/login');
await page.fill('#u', user); await page.fill('#p', 'Elite2026demo');
await page.click('button[type=submit]'); await page.waitForURL(/inicio/);
await page.goto(base + path); await page.waitForLoadState('networkidle');
if (button) await page.getByRole('button', { name: new RegExp(button, 'i') }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: out });
await browser.close();
