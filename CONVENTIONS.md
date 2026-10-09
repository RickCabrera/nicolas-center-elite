# Convenciones de construcción · Nicolas Center Elite

Guía obligatoria para quien escriba código en este repositorio. Las tareas de tu módulo vienen en tu encargo; el backlog completo está enlazado en `docs/backlog.md`.
Cada tarea tiene un ID (PAC-03, HUE-07…): cítalo en un comentario donde la implementes.

## 1. Qué es esto

Sistema clínico de un centro de fisioterapia con dos sedes (Córdoba y Orizaba, Ver.). Dos roles:
**dueño** (`owner`, ve todo) y **fisioterapeuta** (`therapist`, solo sus pacientes y lo derivado).
Toda la interfaz está en **español de México**. La referencia visual es el mockup aprobado:
`/mnt/user-data/uploads/Nicolas_Center_Elite_dc.html` (plantilla en las líneas 31-889, lógica en 890-1299).
La pantalla real debe verse como el mockup; lo que cambia de fondo está en la sección "Mockup vs sistema real" del backlog.

## 2. Stack

Next.js 15 (App Router) + React 19 + TypeScript estricto · Postgres (driver `postgres`) · zod 4 · SWR · pdf-lib.
Sin Tailwind: estilos en `src/app/globals.css` (clases) + estilos en línea para ajustes puntuales.
**No agregues dependencias.** Ya están instaladas: `fflate` (zip), `dicom-parser`, `sharp` (solo scripts/pruebas), `@simplewebauthn/*`.

## 3. Estructura y propiedad de archivos

```
db/migrations/           SQL versionado (0001-0006 son la base: NO se editan)
src/lib/                 núcleo compartido (NO se edita desde un módulo)
src/components/          ui.tsx, shell.tsx, meta.tsx, icons.tsx (NO se editan desde un módulo)
src/modules/<módulo>/    componentes y lógica de cada módulo
src/app/api/...          rutas de la API
src/app/(app)/...        pantallas (las de (owner)/ son solo del dueño)
tests/api, tests/db, tests/unit
bridge/                  agente puente del lector Hikvision (Node puro, sin dependencias)
```

Cada módulo es dueño de sus carpetas. **No edites archivos de otro módulo ni del núcleo.** Si el núcleo
tiene un error o le falta algo, no lo parches: resuélvelo dentro de tu módulo y repórtalo al terminar.
Si necesitas un cambio de esquema, agrega una migración NUEVA con el prefijo numérico que se te asignó.

## 4. Base de datos

El esquema completo ya existe. **Léelo antes de escribir**: `db/migrations/0001..0006`.
Reglas que ya viven en la base (no las dupliques, apóyate en ellas y muestra su mensaje):

- RLS en todas las tablas; `can_access_patient(id)`, `is_owner()`, `app_uid()`.
- `patient_billing` (vista): plan vigente y estado calculado `pagado | por_vencer | vencido | pausado | sin_plan`.
- Notas de evolución, consentimientos, renglones de documento y bitácora: inmutables.
- Documentos: el trigger fija emisor, datos legales y folio; receta médica solo para `is_physician` con cédula.
- Citas: restricciones de exclusión contra empalmes (error 23P01 → 409 `overlap`).
- `register_attendance(...)`: asistencia idempotente; marca la cita y descuenta sesión de paquete.
- Conservación 5 años: no se puede borrar nada clínico. **Nunca hagas DELETE de datos clínicos**: se desactiva o archiva.
- Auditoría por trigger en todas las tablas clínicas, de pagos y de configuración.

### Acceso a datos (`src/lib/db.ts`)

Dentro de una ruta usa `db` del contexto (transacción bajo RLS a nombre del usuario).
`system(fn)` abre OTRA transacción sin RLS: solo para lo que el rol de aplicación no puede tocar
(tabla `users`, `device_commands`, `sessions`…), y siempre después de validar el permiso en código.

```ts
const rows = await db<{ id: string; full_name: string }[]>`select id, full_name from patients where status = 'active'`;
const [one] = await db`select ... where id = ${params.id}`;            // parámetros siempre con ${}
const frag = q ? db`and search like ${'%' + norm + '%'}` : db``;       // fragmento condicional
await db`insert into exercises ${db({ patient_id, name, dosage }, 'patient_id', 'name', 'dosage')}`;
where id = any(${ids}::uuid[])                                          // arreglos: castea el tipo
${db.json(obj)}                                                         // jsonb
```

- `date` llega como texto `'AAAA-MM-DD'`; `timestamptz` como `Date` (JSON ISO). `count(*)` → castea `::int`.
- **El JSON de la API usa los mismos nombres que las columnas (snake_case).** No conviertas a camelCase.
- Búsqueda sin acentos: `norm(col) like '%' || norm(${q}) || '%'` (o la columna `patients.search`, ya normalizada).
- "Hoy" de la clínica: `mx_today()`; día local de un instante: `mx_date(ts)`.

## 5. API

Toda ruta usa `route()` de `src/lib/api.ts` (léelo completo). Ejemplo:

```ts
import { z } from 'zod';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

const Body = z.object({ name: z.string().trim().min(1, 'Escribe el nombre.').max(120), dosage: z.string().trim().max(120).default('') });

// EXP-03 · Agrega un ejercicio al plan del paciente.
export const POST = route({ auth: 'user', body: Body }, async ({ db, user, params, body }) => {
  const [p] = await db`select id from patients where id = ${params.id}`;   // RLS: si no es suyo, no existe
  if (!p) throw notFound('Paciente no encontrado.');
  const [row] = await db`insert into exercises (patient_id, name, dosage, created_by)
                         values (${params.id}, ${body.name}, ${body.dosage}, ${user.id}) returning *`;
  return row;                                                              // → { ok: true, data: row }
});
```

- `auth: 'owner'` para lo exclusivo del dueño (responde 403 a un fisioterapeuta). `auth: 'public'` solo para webhooks/tokens.
- Errores: `throw badRequest('mensaje', { campo: 'mensaje' })`, `notFound()`, `forbidden()`, `conflict()`. Mensajes en español, listos para mostrarse.
- Devuelve un `Response` para PDF/descargas (`pdfResponse` de `src/lib/pdf.ts`).
- Validación con zod 4: `z.uuid()`, `z.string().trim().min(1, 'msg')`, `z.enum([...])`, `z.coerce.number()`. Fechas: `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`.
- Accesos sensibles (abrir expediente, exportar, imprimir, descargar estudio): `logEvent(db, 'view', '…', { patientId })` de `src/lib/audit.ts`.
- Nunca confíes en el rol que mande el cliente: el permiso sale de `user` (sesión) y de RLS.

## 6. Pantallas

- Páginas cliente (`'use client'`) que leen con `useApi` y escriben con `api.post/patch/del` (`src/lib/client.ts`). Tras escribir: `refresh('/api/prefijo')`.
- Estructura: `<div className="page"><PageHeader title="…" sub="…" /> … </div>`. `PageHeader` y `useUser()` vienen de `@/components/shell` y `@/components/user-context`.
- Usa SIEMPRE los componentes de `@/components/ui` (`Button, Field, Input, Select, Textarea, Checkbox, Card, StatCard, KV, Avatar, Badge, BillingBadge, Chip, Tabs, Sheet, Confirm, Empty, Skeleton, ErrorNote, Notice, ScanOverlay, useToast, useForm`) y las clases de `globals.css`
  (`card, row, grid-stats, grid-2, grid-cards, grid-tiles, grid-form, grid-kv, stack, hstack, scroll-x, t-*, badge, pill, chip, tab, daybtn, table, notice, paper …`). Lee ambos archivos antes de escribir una pantalla.
- Formularios en hojas (`<Sheet>`), como el mockup. Errores por campo desde `ApiError.fields`. Botón principal con `loading`.
- Tres estados siempre: cargando (`Skeleton`), vacío (`Empty` con texto útil) y error (`ErrorNote` con reintento).
- Catálogos para selectores: `useMeta()` y `PatientPicker` de `@/components/meta`.
- Fechas y dinero: `src/lib/dates.ts` (`fmtDate, fmtTime, dayLabel, todayIso, ageFrom, localToInstant…`) y `src/lib/format.ts` (`money, initials, shortName…`). Nunca `new Date().toLocaleDateString()` suelto. Formato visible: DD/MM/AAAA, 24 h, MXN.
- Debe funcionar igual a 390 px y a 1440 px, completarse con teclado y no desbordar texto (`ellipsis`, `flex-wrap`).
- Sin emojis. Sin textos de relleno. Sin "demo".

### Contratos entre módulos (marcadores ya creados: conserva nombre de archivo, export y props)

| Componente | Archivo | Dueño |
| --- | --- | --- |
| `NewPatientSheet({ open, onClose })` | `src/modules/patients/new-patient-sheet.tsx` | Pacientes |
| `NoteSheet({ open, onClose, patientId, appointmentId?, onSaved? })` | `src/modules/record/note-sheet.tsx` | Expediente |
| `ConsentSheet({ open, onClose, patientId, kind, onSigned? })` | `src/modules/record/consent-sheet.tsx` | Expediente |
| `PatientStudies({ patientId })` · `UploadStudySheet({ open, onClose, patientId?, onDone? })` | `src/modules/studies/…` | Estudios |
| `PatientDocuments({ patientId })` · `NewDocumentSheet({ open, onClose, patientId? })` | `src/modules/documents/…` | Recetas |
| `NewAppointmentSheet({ open, onClose, patientId?, date?, onSaved? })` · `HoursEditor({ userId })` | `src/modules/agenda/…` | Agenda |
| `MembershipPanel({ patientId })` · `PlansSettings()` | `src/modules/billing/…` | Mensualidades |
| `EnrollFingerprint({ personType, personId, enrolledAt?, onDone? })` · `DevicesSettings()` | `src/modules/attendance/…` | Huella |
| `ReassignSheet({ open, onClose, fromTherapistId?, onDone? })` | `src/modules/team/reassign-sheet.tsx` | Equipo |

En el servidor los módulos NO se llaman entre sí por HTTP: cada ruta consulta la base directamente.
Único helper compartido de servidor: `createInitialMembership` en `src/modules/billing/membership.ts`.

Archivos de estudios en el almacenamiento: `patients/<patient_id>/<study_id>/<nombre_seguro>` y miniatura `…/thumb.jpg`.

## 7. Pruebas y verificación (obligatorio antes de reportar terminado)

```bash
export TEST_DATABASE_URL=postgres://nce_admin:dev@127.0.0.1:54329/nce_test_<tu_modulo>   # tu base propia
npx vitest run tests/api/<tu_modulo>            # pruebas de API de tu módulo (escríbelas con tests/helpers.ts)
pnpm -s typecheck                               # debe quedar sin errores en TUS archivos
```

- Escribe pruebas de API en `tests/api/<módulo>.test.ts` usando `fixtures()` y `call()` de `tests/helpers.ts`:
  camino feliz, validación, y **permisos por rol** (el fisioterapeuta A no ve ni toca lo del paciente de B; lo de dueño devuelve 403).
- Hay un servidor de desarrollo corriendo en `http://localhost:3000` con la base de demostración
  (dueño `nicolas.h`, fisioterapeutas `k.ocampo`, `m.reyes` (médico), `d.salinas`, `a.pineda`; contraseña `Elite2026demo`).
  **No lo reinicies, no corras `next build` ni `next dev`.** Recarga solo.
- Revisa tus pantallas con capturas y **míralas** (herramienta Read) en escritorio y móvil, como dueño y como fisioterapeuta:
  `node scripts/dev/shot.mjs nicolas.h Elite2026demo <carpeta_en_tu_scratch> /ruta@1440 /ruta@390`
  Corrige lo que se vea roto o distinto al mockup antes de terminar.
- No reinicies ni resiembres la base `nce_dev` (la comparten todos). Puedes crear datos desde la interfaz.

## 8. Al terminar, reporta

1. Tareas del backlog cubiertas (por ID) y cualquier tarea NO cubierta o cubierta a medias, con el motivo.
2. Rutas de API creadas (método + ruta) y archivos principales.
3. Resultado real de `vitest` y `typecheck` (pega el resumen). No digas que pasa algo que no corriste.
4. Problemas encontrados en el núcleo o en contratos de otros módulos.
