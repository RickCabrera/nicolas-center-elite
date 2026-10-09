import { expect, test, type Page } from '@playwright/test';

/**
 * QA-03 · Los flujos del mockup de punta a punta: alta de paciente, nota, cita, indicaciones,
 * pago y asistencia. Requiere la base de demostración (pnpm db:seed). Cada corrida crea un
 * paciente con nombre único, así que puede repetirse sin reiniciar la base.
 */
const PASSWORD = 'Elite2026demo';

async function login(page: Page, user: string) {
  await page.goto('/login');
  await page.locator('#u').fill(user);
  await page.locator('#p').fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL(/\/inicio/);
}

const sheet = (page: Page) => page.getByRole('dialog');

/** Fecha 'AAAA-MM-DD' del n-ésimo día hábil (lunes a viernes) a partir de mañana, en hora de México. */
function nextWeekday(n: number): string {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()) + 'T12:00:00Z');
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n--;
  }
  return d.toISOString().slice(0, 10);
}

test('el fisioterapeuta da de alta a un paciente, escribe una nota, agenda, emite indicaciones y registra asistencia', async ({ page }, info) => {
  const name = `Paciente Prueba ${info.project.name} ${Date.now().toString().slice(-6)}`;
  await login(page, 'k.ocampo');
  await expect(page.getByRole('heading', { name: 'Mi panel' })).toBeVisible();

  // Alta (PAC-03)
  await page.goto('/pacientes');
  await page.getByRole('button', { name: /Nuevo paciente/i }).click();
  const s = sheet(page);
  await s.getByLabel('Nombre completo').fill(name);
  await s.getByLabel('Fecha de nacimiento').fill('10/05/1990');
  await s.getByLabel('Sexo').selectOption('F');
  await s.getByLabel('Teléfono', { exact: true }).fill('271 555 0101');
  await s.getByLabel('Contacto de emergencia').fill('Ana Prueba');
  await s.getByLabel('Teléfono de emergencia').fill('271 555 0102');
  await s.getByLabel('Motivo de consulta / lesión').fill('Dolor lumbar al estar sentado');
  await s.getByRole('button', { name: 'Guardar paciente' }).click();
  await page.waitForURL(/\/pacientes\/[0-9a-f-]{36}/);
  const patientUrl = page.url().split('?')[0];
  await expect(page.getByText(name).first()).toBeVisible();

  // Nota de evolución firmada (EXP-04)
  await page.getByRole('button', { name: 'Agregar nota' }).first().click();
  await sheet(page).getByRole('textbox').first().fill('Valoración inicial: dolor 6/10 en flexión lumbar.');
  await sheet(page).getByRole('button', { name: 'Firmar y guardar' }).click();
  await expect(sheet(page)).toBeHidden();
  await page.goto(`${patientUrl}?tab=sesiones`);
  await expect(page.getByText('Valoración inicial: dolor 6/10')).toBeVisible();
  await expect(page.getByText(/Firmada electrónicamente/).first()).toBeVisible();

  // Indicaciones fisioterapéuticas (REC-07); la receta médica está bloqueada para un no médico (REC-02)
  await page.goto(patientUrl);
  await page.getByRole('button', { name: 'Nueva receta' }).click();
  await expect(sheet(page).getByRole('tab', { name: 'Receta médica' })).toBeDisabled();
  await expect(sheet(page).getByText(/art\. 28 Bis/)).toBeVisible();
  await sheet(page).getByLabel('Ejercicio').first().fill('Puente de glúteo');
  await sheet(page).getByLabel('Dosificación').first().fill('3 x 12');
  await sheet(page).getByRole('button', { name: 'Emitir documento' }).click();
  const confirm = page.getByRole('button', { name: 'Confirmar y emitir' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForURL(/\/recetas\/[0-9a-f-]{36}/);
  await expect(page.getByText(/INDICACIONES FISIOTERAP/i).first()).toBeVisible();
  await expect(page.getByText(/COR-IND-\d{6}/).first()).toBeVisible();

  // Cita (AGE-03)
  await page.goto(patientUrl);
  await page.locator('main').getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Agendar cita' }).click();
  // Busca un hueco libre (la prueba se repite sin reiniciar la base): si la app avisa que se empalma, prueba otro día.
  const seed = Number(Date.now().toString().slice(-4));
  let date = '';
  let time = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    date = nextWeekday(1 + ((seed + attempt * 7) % 40));
    time = `${String(12 + ((seed + attempt) % 4)).padStart(2, '0')}:${(seed + attempt) % 2 ? '30' : '00'}`;
    await sheet(page).getByLabel('Fecha').fill(date);
    await sheet(page).getByLabel('Hora').fill(time);
    await sheet(page).getByRole('button', { name: /Agendar|Guardar/ }).last().click();
    const done = await sheet(page).waitFor({ state: 'hidden', timeout: 4000 }).then(() => true, () => false);
    if (done) break;
    await expect(sheet(page).getByText(/se empalma/)).toBeVisible();
  }
  await expect(sheet(page)).toBeHidden();
  await page.goto(`/agenda?fecha=${date}`);
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText(time).first()).toBeVisible();

  // Asistencia manual en recepción (HUE-11)
  await page.goto('/huella');
  await page.getByRole('button', { name: 'Registro manual' }).click();
  await sheet(page).getByRole('combobox').first().selectOption({ label: name }).catch(async () => {
    await sheet(page).locator('select').nth(1).selectOption({ label: name });
  });
  await sheet(page).getByRole('textbox').last().fill('Prueba de punta a punta');
  await sheet(page).getByRole('button', { name: 'Registrar asistencia' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
});

test('el dueño registra un pago y el estado cambia a pagado', async ({ page }) => {
  await login(page, 'nicolas.h');
  await page.goto('/mensualidades');
  // Cualquier paciente con la mensualidad vencida o por vencer (la prueba se puede repetir).
  const card = page.locator('.card').filter({ has: page.getByText(/^(VENCIDO|POR VENCER)$/) }).first();
  const patient = (await card.locator('.t-name').first().textContent())?.trim() ?? '';
  expect(patient).not.toBe('');
  await card.getByRole('button', { name: 'Registrar pago' }).click();
  await sheet(page).getByRole('button', { name: 'Registrar pago' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Pago registrado' })).toBeVisible();
  await expect(sheet(page).getByRole('link', { name: 'Descargar recibo' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Cerrar' }).last().click();
  await expect(page.locator('.card', { hasText: patient }).first().getByText('PAGADO')).toBeVisible();
});

test('un fisioterapeuta no entra a las secciones del dueño', async ({ page }) => {
  await login(page, 'k.ocampo');
  for (const path of ['/mensualidades', '/equipo', '/configuracion']) {
    await page.goto(path);
    await expect(page.getByText('Sin acceso')).toBeVisible();
  }
  const r = await page.request.get('/api/billing');
  expect(r.status()).toBe(403);
});
