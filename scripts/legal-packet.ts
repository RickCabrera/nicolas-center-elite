/**
 * LEG-05 · Paquete para revisión del abogado o del responsable sanitario.
 *
 *   pnpm legal:packet            → docs/revision-legal.pdf
 *
 * Incluye: los puntos a validar, los textos legales vigentes en la base (aviso de privacidad integral y
 * simplificado, consentimiento informado, consentimiento de huella, pie de receta) y una receta médica y
 * unas indicaciones fisioterapéuticas de ejemplo generadas por el mismo código que usa la app.
 * Los ejemplos se emiten dentro de una transacción que se revierte: no quedan en la base.
 * Usa la base de DATABASE_URL con la carga de demostración (pnpm db:seed).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { asSystem, asUser, closeDb } = await import('../src/lib/db');
const { PdfBuilder } = await import('../src/lib/pdf');
const { buildDocumentPdf, contentHash, loadDocument } = await import('../src/modules/documents/server');

class Rollback extends Error { constructor(public bytes: Uint8Array) { super('rollback'); } }

type Item = { kind: string; name: string; presentation?: string; dose?: string; route?: string; frequency?: string; duration?: string; instructions?: string };
async function sample(username: string, kind: 'prescription' | 'indications', items: Item[], diagnosis: string, general: string) {
  const [u] = await asSystem((tx) => tx<{ id: string; role: 'owner' | 'therapist' }[]>`select id, role from users where username = ${username}`);
  if (!u) throw new Error(`No existe el usuario ${username}. Carga la base de demostración: pnpm db:seed`);
  try {
    await asUser(u, async (db) => {
      const [p] = await db<{ id: string }[]>`select id from patients where status = 'active' order by full_name limit 1`;
      const [doc] = await db`
        insert into documents (kind, patient_id, diagnosis, general_indications, folio_number, folio, issuer_id, issuer_name,
                               clinic_name, location_name, location_address, patient_name, patient_age)
        values (${kind}, ${p.id}, ${diagnosis}, ${general}, 0, '', ${u.id}, '', '', '', '', '', 0) returning *`;
      const rows = items.map((it, position) => ({ document_id: doc.id as string, position, presentation: '', dose: '', route: '', frequency: '', duration: '', instructions: '', ...it }));
      await db`insert into document_items ${db(rows, 'document_id', 'position', 'kind', 'name', 'presentation', 'dose', 'route', 'frequency', 'duration', 'instructions')}`;
      await db`update documents set content_hash = ${contentHash(doc as never, rows as never)} where id = ${doc.id}`;
      const loaded = await loadDocument(db, doc.id, u);
      throw new Rollback(await buildDocumentPdf(loaded!));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.bytes;
    throw e;
  }
  throw new Error('inalcanzable');
}

const [clinic] = await asSystem((tx) => tx<Record<string, string>[]>`
  select name, privacy_notice, privacy_notice_short, consent_template, biometric_consent, rx_footer from clinic`);
const today = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long' }).format(new Date());

const cover = await PdfBuilder.create({ clinicName: clinic.name, subtitle: `Paquete para revisión legal · ${today}` });
cover.title('Paquete para revisión legal y sanitaria');
cover.paragraph('Este paquete reúne los textos legales y los formatos que emite el sistema clínico de la clínica. Se preparó como punto de partida técnico: no es asesoría legal. Pedimos al abogado o al responsable sanitario que valide cada punto y nos indique los cambios; los textos se editan en Configuración → Plantillas sin desplegar código.');
cover.space(6).heading('Puntos a validar');
[
  '1. Facultad de prescribir (art. 28 Bis de la Ley General de Salud). El sistema solo permite emitir "Receta médica" a usuarios que el dueño marca como médicos y que tienen cédula registrada. Los fisioterapeutas emiten "Indicaciones fisioterapéuticas", sin medicamentos. ¿Es correcta esta separación para la plantilla de la clínica?',
  '2. Datos de la receta (Reglamento de Insumos para la Salud, arts. 28 a 31). Ver el ejemplo: nombre, cédula, institución que expidió el título, especialidad y su cédula, domicilio y teléfono del establecimiento, fecha, folio, datos del paciente, denominación genérica, presentación, dosis, vía, frecuencia y duración. ¿Falta algún dato?',
  '3. Medicamentos controlados. El sistema bloquea una lista de sustancias controladas comunes porque requieren recetario especial. La lista es una ayuda y no es exhaustiva. ¿Debe ampliarse?',
  '4. Firma. Las recetas y notas se firman con la identidad del usuario autenticado y una huella de contenido (SHA-256); la receta impresa lleva la línea de firma autógrafa. ¿Es suficiente o se requiere firma electrónica avanzada (e.firma)?',
  '5. Expediente clínico (NOM-004-SSA3-2012). Notas inmutables con fecha, hora, nombre y firma; correcciones por adenda; conservación mínima de 5 años desde el último acto. Ver docs/cumplimiento.md.',
  '6. Aviso de privacidad (LFPDPPP). Datos de salud y huella son datos sensibles: el sistema pide consentimiento firmado del aviso y, por separado, del uso de huella antes de registrarla. Revisar redacción, responsable, domicilio y medios para derechos ARCO.',
  '7. Menores de edad. El alta exige padre, madre o tutor y los consentimientos los firma esa persona.',
  '8. Huella dactilar. La huella se guarda solo dentro del lector Hikvision; el sistema guarda un número de persona. ¿Requiere algún aviso adicional en recepción?',
].forEach((t) => cover.paragraph(t).space(3));
const coverBytes = await cover.finish('Documento de trabajo para revisión. No es asesoría legal.');

const texts = await PdfBuilder.create({ clinicName: clinic.name, subtitle: 'Textos legales vigentes en el sistema' });
const blocks: [string, string][] = [
  ['Aviso de privacidad integral', clinic.privacy_notice],
  ['Aviso de privacidad simplificado', clinic.privacy_notice_short],
  ['Carta de consentimiento informado', clinic.consent_template],
  ['Consentimiento para el uso de huella dactilar', clinic.biometric_consent],
  ['Pie de receta e indicaciones', clinic.rx_footer],
];
for (const [t, body] of blocks) texts.title(t).paragraph(body || '(vacío)').space(12);
texts.paragraph('Los marcadores {{clinica}}, {{domicilio}}, {{paciente}}, {{firmante}} y {{parentesco}} se sustituyen automáticamente al firmar o imprimir.', { size: 9, color: 'grey' });
const textBytes = await texts.finish('Documento de trabajo para revisión. No es asesoría legal.');

const rx = await sample('m.reyes', 'prescription', [
  { kind: 'medication', name: 'Naproxeno', presentation: 'Tabletas 500 mg, caja con 20', dose: '500 mg', route: 'Oral', frequency: 'Cada 12 horas', duration: '7 días', instructions: 'Tomar con alimentos.' },
  { kind: 'medication', name: 'Diclofenaco', presentation: 'Gel 1%, tubo de 60 g', dose: 'Aplicación delgada', route: 'Tópica', frequency: 'Cada 8 horas', duration: '10 días', instructions: 'Sobre la zona dolorosa, sin vendar.' },
], 'Síndrome de dolor patelofemoral derecho.', 'Reposo relativo de actividad de impacto por 7 días.');
const ind = await sample('k.ocampo', 'indications', [
  { kind: 'exercise', name: 'Puente de glúteo', dose: '3 series de 12 repeticiones', frequency: '1 vez al día', duration: '4 semanas' },
  { kind: 'physical_agent', name: 'Crioterapia local', dose: '15 minutos', frequency: 'Después del ejercicio', duration: '2 semanas' },
  { kind: 'home_care', name: 'Pausas activas cada hora en jornada sentado', duration: 'Permanente' },
], 'Lumbalgia mecánica sin radiculopatía.', 'Suspender el ejercicio si el dolor aumenta y avisar a su fisioterapeuta.');

const packet = await PDFDocument.create();
for (const bytes of [coverBytes, textBytes, rx, ind]) {
  const src = await PDFDocument.load(bytes);
  (await packet.copyPages(src, src.getPageIndices())).forEach((p) => packet.addPage(p));
}
packet.setTitle('Paquete para revisión legal · Nicolas Center Elite');
writeFileSync('docs/revision-legal.pdf', await packet.save());
console.log(`docs/revision-legal.pdf generado (${packet.getPageCount()} páginas).`);
await closeDb();
