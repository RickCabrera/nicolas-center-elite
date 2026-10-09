/**
 * DB-12 · Base de demostración: los 11 pacientes, 4 fisioterapeutas, citas y asistencias del mockup,
 * con fechas relativas a hoy. Solo para desarrollo y staging: se niega a correr en producción.
 *
 *   pnpm db:reset && pnpm db:seed        Usuarios: nicolas.h, m.reyes, d.salinas, k.ocampo, a.pineda
 *                                         Contraseña de todos: Elite2026demo
 */
import { readFileSync, existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { asSystem, closeDb } = await import('../src/lib/db');
const { env } = await import('../src/lib/env');
const { hashPassword } = await import('../src/lib/auth/password');
const { storage } = await import('../src/lib/storage');
const { addDays, localToInstant, todayIso } = await import('../src/lib/dates');
const { sampleDicom, sampleJpeg, samplePdf } = await import('./lib/sample-files');

if (env().APP_ENV === 'production') {
  console.error('La base de demostración no se carga en producción.');
  process.exit(1);
}

const PASSWORD = 'Elite2026demo';
const today = todayIso();
const dmy = (s: string) => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; };
// El mockup está fechado al 18/08/2026: las fechas históricas se recorren para conservar la misma distancia a hoy.
const MOCK_TODAY = '2026-08-18';
const shift = (iso: string) => {
  const diff = Math.round((Date.parse(iso) - Date.parse(MOCK_TODAY)) / 86400000);
  return addDays(today, diff);
};

const THER = [
  { key: 't1', username: 'm.reyes', title: 'Dra.', name: 'Mariana Reyes', esp: 'Readaptación deportiva', sede: 'COR', license: '8765432', physician: true },
  { key: 't2', username: 'd.salinas', title: 'L.F.T.', name: 'Diego Salinas', esp: 'Columna y dolor crónico', sede: 'ORI', license: '10293847', physician: false },
  { key: 't3', username: 'k.ocampo', title: 'L.F.T.', name: 'Karla Ocampo', esp: 'Pediatría y neurodesarrollo', sede: 'COR', license: '11384756', physician: false },
  { key: 't4', username: 'a.pineda', title: 'L.F.T.', name: 'Aarón Pineda', esp: 'Post-quirúrgico', sede: 'ORI', license: '12475665', physician: false },
];

type P = { key: string; nombre: string; sex: 'F' | 'M'; nac: string; tel: string; emer: string; sede: 'Córdoba' | 'Orizaba'; ter: string; memb: string;
  estado: 'pagado' | 'porvencer' | 'vencido'; motivo: string; dx: string; plan: string; ej: [string, string][]; ses: [string, string][]; arch: [string, string, string][]; tags?: string[] };
const PATIENTS: P[] = [
  { key: 'p1', nombre: 'Emiliano Cárdenas', sex: 'M', nac: '14/03/2017', tel: '271 118 4420', emer: 'Lucía Cárdenas · 271 118 4421', sede: 'Córdoba', ter: 't3', memb: 'Mensual Básica', estado: 'pagado', motivo: 'Marcha en punta de pie y torpeza motriz', dx: 'Retraso leve de coordinación motora gruesa; acortamiento de tríceps sural bilateral.', plan: 'Sesiones bisemanales de terapia de juego con circuito propioceptivo y estiramiento guiado de gemelos.', ej: [['Circuito de equilibrio', '2 series · 8 min'], ['Estiramiento gemelos', '3 x 30 seg'], ['Saltos en colchoneta', '3 series · 10 rep']], ses: [['05/08/2026', 'Mejor apoyo del talón durante la marcha en 12 de 20 pasos. Buena tolerancia al circuito.'], ['29/07/2026', 'Primera valoración funcional. Se explica plan a la mamá y ejercicios en casa.']], arch: [['Radiografía', 'Rx pie derecho.jpg', '29/07/2026'], ['Documento', 'Valoración inicial.pdf', '29/07/2026']] },
  { key: 'p2', nombre: 'Regina Solís', sex: 'F', nac: '02/06/2010', tel: '271 204 7781', emer: 'Marcos Solís · 271 204 7782', sede: 'Córdoba', ter: 't1', memb: 'Mensual Elite', estado: 'pagado', motivo: 'Dolor anterior de rodilla en entrenamiento de voleibol', dx: 'Síndrome de dolor patelofemoral derecho, debilidad de glúteo medio.', plan: 'Fase 2 de fortalecimiento excéntrico + control de aterrizaje pliométrico, 3 sesiones por semana.', ej: [['Sentadilla búlgara', '4 x 8 c/pierna'], ['Puente de glúteo unipodal', '3 x 12'], ['Aterrizaje controlado', '4 x 6 saltos']], ses: [['12/08/2026', 'Dolor bajó de 6/10 a 2/10 en escalón. Se progresa a pliometría baja.'], ['05/08/2026', 'Se ajusta carga por molestia post-entrenamiento del club.'], ['22/07/2026', 'Ingreso. Test de sentadilla unipodal positivo a valgo dinámico.']], arch: [['Resonancia', 'RM rodilla der.dcm', '20/07/2026'], ['Radiografía', 'Rx rodilla AP.jpg', '20/07/2026']], tags: ['Deportista'] },
  { key: 'p3', nombre: 'Javier Montes', sex: 'M', nac: '21/11/1991', tel: '272 330 1195', emer: 'Ana Montes · 272 330 1196', sede: 'Orizaba', ter: 't2', memb: 'Mensual Elite', estado: 'porvencer', motivo: 'Lumbalgia por trabajo de oficina y levantamiento de pesas', dx: 'Lumbalgia mecánica sin radiculopatía; control motor lumbopélvico deficiente.', plan: 'Reeducación de patrón de bisagra de cadera, core anti-extensión y educación postural laboral.', ej: [['Bird dog', '3 x 10 c/lado'], ['Peso muerto rumano', '4 x 8'], ['Plancha lateral', '3 x 30 seg']], ses: [['14/08/2026', 'Sin dolor matutino esta semana. Se agrega carga al peso muerto.'], ['07/08/2026', 'Se corrige técnica de sentadilla; dolor 3/10 al final del día.']], arch: [['Resonancia', 'RM lumbar.dcm', '01/08/2026'], ['Documento', 'Reporte radiólogo.pdf', '02/08/2026']], tags: ['Dolor crónico'] },
  { key: 'p4', nombre: 'Sofía Delgado', sex: 'F', nac: '09/04/1999', tel: '271 556 0043', emer: 'Pedro Delgado · 271 556 0044', sede: 'Córdoba', ter: 't1', memb: 'Paquete 10 sesiones', estado: 'vencido', motivo: 'Esguince de tobillo grado II jugando fútbol', dx: 'Esguince lateral grado II tobillo izquierdo, 4 semanas de evolución.', plan: 'Progresión propioceptiva y retorno gradual a carrera; vendaje funcional en entrenamientos.', ej: [['Propiocepción en bosu', '3 x 45 seg'], ['Elevación de talones', '4 x 15'], ['Carrera progresiva', '15 min al 60%']], ses: [['11/08/2026', 'Camina sin dolor. Se inicia trote en línea recta.'], ['04/08/2026', 'Edema residual mínimo. Rango completo de dorsiflexión.']], arch: [['Radiografía', 'Rx tobillo izq.jpg', '16/07/2026']], tags: ['Deportista'] },
  { key: 'p5', nombre: 'Don Ernesto Vidal', sex: 'M', nac: '30/01/1954', tel: '272 441 8890', emer: 'Teresa Vidal · 272 441 8891', sede: 'Orizaba', ter: 't4', memb: 'Plan Senior', estado: 'pagado', motivo: 'Rehabilitación posterior a prótesis de rodilla', dx: 'Post-operado de artroplastia total de rodilla derecha, 7 semanas.', plan: 'Ganancia de rango articular, fuerza de cuádriceps y marcha sin bastón en 6 semanas.', ej: [['Flexión asistida en camilla', '3 x 10'], ['Isométrico de cuádriceps', '4 x 20 seg'], ['Marcha con obstáculos bajos', '10 min']], ses: [['13/08/2026', 'Flexión activa 105°. Marcha con bastón en trayectos largos únicamente.'], ['06/08/2026', 'Flexión 95°, dolor 2/10. Buena adherencia al programa en casa.']], arch: [['Radiografía', 'Rx rodilla post-op.jpg', '25/06/2026'], ['Documento', 'Nota quirúrgica.pdf', '24/06/2026']], tags: ['Post-quirúrgico'] },
  { key: 'p6', nombre: 'Mariana Escobedo', sex: 'F', nac: '17/08/1985', tel: '271 900 2233', emer: 'Raúl Escobedo · 271 900 2234', sede: 'Córdoba', ter: 't2', memb: 'Mensual Básica', estado: 'porvencer', motivo: 'Dolor cervical y cefalea tensional', dx: 'Cervicalgia mecánica con puntos gatillo en trapecio superior.', plan: 'Terapia manual, fortalecimiento de flexores profundos de cuello y pausas activas laborales.', ej: [['Retracción cervical', '3 x 12'], ['Remo con banda', '3 x 15'], ['Movilidad torácica', '2 x 10']], ses: [['12/08/2026', 'Cefaleas bajaron a 1 por semana. Continúa plan.']], arch: [['Documento', 'Cuestionario de dolor.pdf', '29/07/2026']], tags: ['Dolor crónico'] },
  { key: 'p7', nombre: 'Iker Fuentes', sex: 'M', nac: '25/12/2012', tel: '272 118 5566', emer: 'Gabriela Fuentes · 272 118 5567', sede: 'Orizaba', ter: 't3', memb: 'Mensual Básica', estado: 'pagado', motivo: 'Dolor en talón al correr (natación y atletismo)', dx: 'Apofisitis calcánea (Sever) bilateral.', plan: 'Descarga de impacto por 3 semanas, estiramiento y fortalecimiento de pie; retorno progresivo a pista.', ej: [['Estiramiento sóleo', '3 x 30 seg'], ['Fortalecimiento de arco', '3 x 12'], ['Bicicleta estática', '12 min']], ses: [['10/08/2026', 'Dolor 1/10 tras entrenamiento suave. Se autoriza trote en pasto.']], arch: [['Radiografía', 'Rx calcáneo.jpg', '28/07/2026']], tags: ['Deportista'] },
  { key: 'p8', nombre: 'Luis Ángel Trejo', sex: 'M', nac: '03/02/2003', tel: '271 774 9012', emer: 'Nadia Trejo · 271 774 9013', sede: 'Córdoba', ter: 't1', memb: 'Mensual Elite', estado: 'pagado', motivo: 'Readaptación de isquiotibial tras lesión en partido', dx: 'Lesión grado I de bíceps femoral izquierdo, semana 3.', plan: 'Protocolo de carga excéntrica progresiva + sprints controlados al 80% para alta deportiva.', ej: [['Nórdico asistido', '4 x 6'], ['Curl deslizante', '3 x 10'], ['Sprint 40 m al 80%', '6 repeticiones']], ses: [['15/08/2026', 'Sin dolor a la palpación. Se autoriza sprint al 80%.'], ['08/08/2026', 'Fuerza excéntrica al 85% del lado sano.']], arch: [['Resonancia', 'RM muslo izq.dcm', '26/07/2026']], tags: ['Deportista'] },
  { key: 'p9', nombre: 'Carmen Ruvalcaba', sex: 'F', nac: '11/05/1960', tel: '272 665 3341', emer: 'Hugo Ruvalcaba · 272 665 3342', sede: 'Orizaba', ter: 't4', memb: 'Plan Senior', estado: 'porvencer', motivo: 'Dolor de hombro al levantar el brazo', dx: 'Tendinopatía del supraespinoso derecho con pinzamiento subacromial.', plan: 'Control de dolor, movilidad escapular y fortalecimiento progresivo del manguito rotador.', ej: [['Rotación externa con banda', '3 x 12'], ['Péndulo de Codman', '2 x 60 seg'], ['Elevación en plano escapular', '3 x 10']], ses: [['09/08/2026', 'Alcanza 140° de abducción sin dolor. Buen avance.']], arch: [['Resonancia', 'RM hombro der.dcm', '15/07/2026'], ['Documento', 'Interconsulta ortopedia.pdf', '16/07/2026']] },
  { key: 'p10', nombre: 'Bruno Alcalá', sex: 'M', nac: '28/09/1994', tel: '271 332 7788', emer: 'Paola Alcalá · 271 332 7789', sede: 'Córdoba', ter: 't2', memb: 'Paquete 10 sesiones', estado: 'vencido', motivo: 'Dolor de cadera en corredores de trail', dx: 'Síndrome de dolor glúteo profundo derecho.', plan: 'Liberación miofascial, fortalecimiento de abductores y ajuste de volumen de carrera.', ej: [['Abducción con banda', '4 x 15'], ['Sentadilla isométrica', '3 x 45 seg'], ['Movilidad de cadera', '2 x 8']], ses: [['07/08/2026', 'Tolera 8 km sin dolor. Se ajusta plan de carrera.']], arch: [['Documento', 'Análisis de marcha.pdf', '21/07/2026']], tags: ['Deportista'] },
  { key: 'p11', nombre: 'Andrea Lozano', sex: 'F', nac: '06/07/2007', tel: '272 220 4409', emer: 'Silvia Lozano · 272 220 4410', sede: 'Orizaba', ter: 't4', memb: 'Mensual Básica', estado: 'pagado', motivo: 'Inestabilidad de hombro tras luxación en basquetbol', dx: 'Inestabilidad anterior de hombro izquierdo post-luxación, tratamiento conservador.', plan: 'Estabilidad escapulohumeral, propiocepción en cadena cerrada y retorno a bote de balón.', ej: [['Plancha con desplazamiento', '3 x 8'], ['Rotación externa 90/90', '3 x 12'], ['Lanzamiento en pared', '3 x 15']], ses: [['13/08/2026', 'Sin sensación de inestabilidad en pruebas de aprensión.']], arch: [['Radiografía', 'Rx hombro izq.jpg', '30/07/2026']], tags: ['Deportista'] },
];

const APPTS: [number, string, number, string, string, string][] = [
  [0, '08:00', 50, 'p2', 't1', 'Fisioterapia'], [0, '09:00', 50, 'p8', 't1', 'Readaptación deportiva'], [0, '10:00', 40, 'p1', 't3', 'Fisioterapia'],
  [0, '11:00', 50, 'p3', 't2', 'Fisioterapia'], [0, '16:00', 50, 'p5', 't4', 'Fisioterapia'], [0, '17:00', 40, 'p9', 't4', 'Fisioterapia'],
  [1, '08:30', 50, 'p4', 't1', 'Readaptación deportiva'], [1, '10:00', 50, 'p6', 't2', 'Fisioterapia'], [1, '12:00', 40, 'p7', 't3', 'Ejercicio personalizado'], [1, '17:30', 50, 'p11', 't4', 'Fisioterapia'],
  [2, '09:00', 50, 'p2', 't1', 'Ejercicio personalizado'], [2, '11:00', 50, 'p10', 't2', 'Fisioterapia'], [2, '16:00', 50, 'p5', 't4', 'Fisioterapia'],
  [3, '08:00', 50, 'p8', 't1', 'Readaptación deportiva'], [3, '10:30', 40, 'p1', 't3', 'Fisioterapia'], [3, '18:00', 50, 'p3', 't2', 'Valoración inicial'],
  [4, '09:30', 50, 'p9', 't4', 'Fisioterapia'], [4, '11:00', 50, 'p4', 't1', 'Readaptación deportiva'], [5, '10:00', 40, 'p7', 't3', 'Readaptación deportiva'],
];
const ATTEND: [string, string][] = [['t1', '07:42'], ['p2', '07:56'], ['t3', '08:05'], ['p8', '08:58'], ['t2', '09:10'], ['p1', '09:52'], ['p3', '10:47']];
const DUE = { pagado: 21, porvencer: 4, vencido: -9 };

await asSystem(async (tx) => {
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from patients`;
  if (n > 0) throw new Error('La base ya tiene pacientes. Ejecuta primero: pnpm db:reset');

  const hash = await hashPassword(PASSWORD);
  const locs = Object.fromEntries((await tx<{ id: string; code: string; name: string }[]>`select id, code, name from locations`).flatMap((l) => [[l.code, l.id], [l.name, l.id]]));
  await tx`update locations set street = 'Av. 1 No. 1520', neighborhood = 'Centro', zip = '94500', phone = '271 118 4400', hours = 'Lun a Vie 7:00 a 20:00 · Sáb 8:00 a 14:00' where code = 'COR'`;
  await tx`update locations set street = 'Oriente 6 No. 245', neighborhood = 'Centro', zip = '94300', phone = '272 330 1100', hours = 'Lun a Vie 7:00 a 20:00 · Sáb 8:00 a 14:00' where code = 'ORI'`;
  await tx`update clinic set phone = '271 118 4400', email = 'contacto@nicolascenterelite.mx'`;
  const plans = Object.fromEntries((await tx<{ id: string; name: string; kind: string; sessions_count: number | null }[]>`select id, name, kind, sessions_count from membership_plans`).map((p) => [p.name, p]));

  let [owner] = await tx<{ id: string }[]>`select id from users where role = 'owner' limit 1`;
  if (!owner) {
    [owner] = await tx<{ id: string }[]>`
      insert into users (username, email, password_hash, role, full_name, specialty, location_id)
      values ('nicolas.h', 'nicolas@nicolascenterelite.mx', ${hash}, 'owner', 'Nicolas Herrera', 'Dueño / Director', ${locs.COR}) returning id`;
  }
  const ther: Record<string, string> = {};
  for (const t of THER) {
    const [u] = await tx<{ id: string }[]>`
      insert into users (username, email, password_hash, role, full_name, title, specialty, location_id, license_number, license_institution, is_physician, phone)
      values (${t.username}, ${t.username + '@nicolascenterelite.mx'}, ${hash}, 'therapist', ${t.name}, ${t.title}, ${t.esp}, ${locs[t.sede]},
              ${t.license}, 'Universidad Veracruzana', ${t.physician}, '271 000 0000') returning id`;
    ther[t.key] = u.id;
    for (const wd of [1, 2, 3, 4, 5]) await tx`insert into therapist_hours (user_id, weekday, start_time, end_time) values (${u.id}, ${wd}, '07:00', '20:00')`;
    await tx`insert into therapist_hours (user_id, weekday, start_time, end_time) values (${u.id}, 6, '08:00', '14:00')`;
  }

  const [device] = await tx<{ id: string }[]>`
    insert into devices (name, location_id, model, serial, firmware, host, webhook_token_hash, webhook_token_enc, bridge_token_hash, bridge_token_enc)
    values ('Recepción Córdoba', ${locs.COR}, 'DS-K1T321EFWX-B', 'DEMO-0001', 'V3.9.50', '192.168.80.212',
            'demo-webhook-hash', 'demo', 'demo-bridge-hash', 'demo') returning id`;

  const pat: Record<string, string> = {};
  let fileSeed = 1;
  for (const p of PATIENTS) {
    const birth = dmy(p.nac);
    const [emName, emPhone] = p.emer.split(' · ');
    const minor = Date.parse(today) - Date.parse(birth) < 18 * 365.25 * 86400000;
    await tx`select set_config('app.user_id', ${owner.id}, true), set_config('app.user_role', 'owner', true)`;
    const [row] = await tx<{ id: string }[]>`
      insert into patients (full_name, sex, birth_date, phone, emergency_name, emergency_phone, guardian_name, guardian_relationship, guardian_phone,
                            location_id, therapist_id, tags, reason, created_by, created_at)
      values (${p.nombre}, ${p.sex}, ${birth}, ${p.tel}, ${emName}, ${emPhone}, ${minor ? emName : ''}, ${minor ? 'Madre / Padre' : ''}, ${minor ? emPhone : ''},
              ${locs[p.sede]}, ${ther[p.ter]}, ${p.tags ?? []}, ${p.motivo}, ${owner.id}, ${localToInstant(shift(dmy(p.ses[p.ses.length - 1][0])), '09:00')})
      returning id`;
    pat[p.key] = row.id;
    const plan = plans[p.memb];
    await tx`insert into memberships (patient_id, plan_id, started_on, next_due_date, sessions_remaining, created_by)
             values (${row.id}, ${plan.id}, ${addDays(today, -25)}, ${addDays(today, DUE[p.estado])},
                     ${plan.kind === 'package' ? (p.estado === 'vencido' ? 0 : 6) : null}, ${owner.id})`;

    // Lo clínico lo firma su fisioterapeuta.
    await tx`select set_config('app.user_id', ${ther[p.ter]}, true), set_config('app.user_role', 'therapist', true)`;
    const tname = THER.find((t) => t.key === p.ter)!;
    await tx`insert into clinical_profiles (patient_id, background, condition, examination, diagnosis, treatment_plan, created_by, created_by_name)
             values (${row.id}, 'Sin antecedentes patológicos de importancia para el padecimiento actual.', ${p.motivo + '.'},
                     'Exploración funcional realizada en la valoración inicial.', ${p.dx}, ${p.plan}, ${ther[p.ter]}, ${`${tname.title} ${tname.name}`})`;
    for (const [i, e] of p.ej.entries()) await tx`insert into exercises (patient_id, name, dosage, position, created_by) values (${row.id}, ${e[0]}, ${e[1]}, ${i}, ${ther[p.ter]})`;
    for (const s of [...p.ses].reverse()) {
      const pain = s[1].match(/(\d+)\/10/g)?.pop()?.split('/')[0];
      await tx`insert into evolution_notes (patient_id, body, pain_level, noted_at, author_id, author_name, signature_hash)
               values (${row.id}, ${s[1]}, ${pain ? Number(pain) : null}, ${localToInstant(shift(dmy(s[0])), '10:30')}, ${ther[p.ter]}, '', '')`;
    }
    for (const a of p.arch) {
      const [st] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
      const ext = a[1].split('.').pop()!;
      const safe = a[1].normalize('NFD').replace(/[^\w.]+/g, '_').replace(/_+/g, '_');
      const path = `patients/${row.id}/${st.id}/${safe}`;
      let body: Buffer, mime: string, thumb: string | null = null;
      if (ext === 'jpg') {
        body = await sampleJpeg(fileSeed++);
        mime = 'image/jpeg';
        thumb = `patients/${row.id}/${st.id}/thumb.jpg`;
        const sharp = (await import('sharp')).default;
        await storage.write(thumb, await sharp(body).resize(400, 300, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer(), 'image/jpeg');
      } else if (ext === 'dcm') {
        body = sampleDicom(fileSeed++, 256, 256, p.nombre.toUpperCase().replace(' ', '^'));
        mime = 'application/dicom';
      } else {
        body = await samplePdf(a[1].replace('.pdf', ''), [`Paciente: ${p.nombre}`, `Motivo: ${p.motivo}`, `Diagnóstico: ${p.dx}`]);
        mime = 'application/pdf';
      }
      await storage.write(path, body, mime);
      await tx`insert into studies (id, patient_id, type_name, title, file_name, storage_path, thumb_path, mime, size_bytes, study_date, status, uploaded_by, uploaded_by_name)
               values (${st.id}, ${row.id}, ${a[0]}, ${a[1].replace(/\.\w+$/, '')}, ${a[1]}, ${path}, ${thumb}, ${mime}, ${body.length}, ${shift(dmy(a[2]))}, 'ready',
                       ${ther[p.ter]}, ${`${tname.title} ${tname.name}`})`;
    }
    await tx`insert into consents (patient_id, kind, body_snapshot, signer_name, signer_relationship, signature_png, recorded_by, recorded_by_name)
             values (${row.id}, 'privacy', 'Aviso de privacidad aceptado en la carga de demostración.', ${minor ? emName : p.nombre}, ${minor ? 'Madre / Padre' : 'Paciente'},
                     'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', ${ther[p.ter]}, ${`${tname.title} ${tname.name}`}),
                    (${row.id}, 'biometric', 'Consentimiento de huella aceptado en la carga de demostración.', ${minor ? emName : p.nombre}, ${minor ? 'Madre / Padre' : 'Paciente'},
                     'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', ${ther[p.ter]}, ${`${tname.title} ${tname.name}`})`;
    await tx`update patients set fingerprint_enrolled_at = now() where id = ${row.id}`;
    await tx`insert into enrollments (device_id, person_type, patient_id, employee_no, status, enrolled_at)
             select ${device.id}, 'patient', id, hik_employee_no, 'enrolled', now() from patients where id = ${row.id}`;
  }

  await tx`select set_config('app.user_id', ${owner.id}, true), set_config('app.user_role', 'owner', true)`;
  for (const [d, hora, dur, p, t, tipo] of APPTS) {
    const patient = PATIENTS.find((x) => x.key === p)!;
    await tx`insert into appointments (patient_id, therapist_id, location_id, starts_at, duration_min, ends_at, type_name, created_by)
             values (${pat[p]}, ${ther[t]}, ${locs[patient.sede]}, ${localToInstant(addDays(today, d), hora)}, ${dur}, now(), ${tipo}, ${owner.id})`;
  }
  for (const [who, hora] of ATTEND) {
    const at = localToInstant(today, hora);
    if (who.startsWith('t')) {
      await tx`update users set fingerprint_enrolled_at = now() where id = ${ther[who]}`;
      await tx`select register_attendance(${device.id}, null, ${at}, 'simulator', ${`demo-${who}-${hora}`}, 'fingerprint', null, ${ther[who]}, null, null, null)`;
    } else {
      await tx`select register_attendance(${device.id}, null, ${at}, 'simulator', ${`demo-${who}-${hora}`}, 'fingerprint', ${pat[who]}, null, null, null, null)`;
    }
  }
});

console.log(`Base de demostración lista.\n  Dueño:           nicolas.h\n  Fisioterapeutas: m.reyes (médico), d.salinas, k.ocampo, a.pineda\n  Contraseña:      ${PASSWORD}`);
await closeDb();
