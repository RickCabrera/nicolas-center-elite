# Cumplimiento normativo

Cómo el sistema atiende la NOM-004-SSA3-2012 (expediente clínico), la NOM-024-SSA3-2012 (sistemas de
registro electrónico para la salud), el artículo 28 Bis de la Ley General de Salud y la LFPDPPP.
Cada punto apunta a dónde está implementado y a la prueba automática que lo demuestra.

Esto es una matriz técnica, no una opinión legal. La validación final corresponde al abogado o al
responsable sanitario de la clínica: `docs/revision-legal.pdf` (generado con `pnpm legal:packet`) reúne
los textos y formatos que deben revisar. La certificación formal ante la autoridad (NOM-024) queda fuera de
esta versión.

## LEG-01 · NOM-004-SSA3-2012, del expediente clínico

| Requisito | Cómo se cumple | Dónde | Prueba |
| --- | --- | --- | --- |
| Todo establecimiento integra un expediente por paciente desde el primer contacto | Cada paciente nace con número de expediente único `NCE-000123` | `db/migrations/0002_clinical.sql` (`patients.record_number`) | `tests/db/model.test.ts` · DB-03 |
| Datos generales: nombre, sexo, edad, domicilio, tipo y nombre del establecimiento | Alta con nombre, sexo, fecha de nacimiento (edad calculada), domicilio, teléfono, sede | `src/modules/patients/patient-form.tsx`, `0002_clinical.sql` | `tests/api/patients.test.ts` · PAC-03 |
| Menores: datos del padre, madre o tutor | Tutor obligatorio si es menor de 18 (la base lo rechaza) | trigger `patients_guardian_check` | `tests/db/model.test.ts` · DB-03; `tests/api/patients.test.ts` |
| Historia clínica: antecedentes, padecimiento actual, exploración, diagnóstico, plan | Perfil clínico con esos cinco campos, versionado | `clinical_profiles`, `src/modules/record/profile-tab.tsx` | `tests/api/record.test.ts` · EXP-02 |
| Notas de evolución con fecha, hora, nombre completo y firma de quien la elabora | La base fija autor, nombre con título, cédula, fecha y hora, y calcula la firma (SHA-256) | trigger `evolution_notes_sign` | `tests/api/record.test.ts` · "se firma con el usuario de la sesión aunque el cliente mande otro autor" |
| Las notas no se alteran; las correcciones quedan registradas | Nota inmutable (sin UPDATE ni DELETE a nivel base); corrección por adenda ligada | trigger `evolution_notes_immutable`; rutas sin PATCH/DELETE | `tests/db/model.test.ts` · DB-04; `tests/api/record.test.ts` · "no existe PATCH ni DELETE" |
| Carta de consentimiento informado | Plantilla editable, firma en pantalla, copia exacta del texto firmado, PDF | `consents`, `src/modules/record/consent-sheet.tsx` | `tests/api/record.test.ts` · EXP-10 |
| Resultados de estudios integrados al expediente | Estudios (imagen, PDF, DICOM) ligados al paciente con fecha, tipo y quién los subió | `studies`, `src/modules/studies` | `tests/api/studies.test.ts` · EST-02 |
| Conservación mínima de 5 años desde el último acto | La base rechaza borrar cualquier dato clínico antes de 5 años, aunque lo intente el dueño | trigger `enforce_retention` | `tests/db/model.test.ts` · DB-04 |
| Confidencialidad; acceso solo de personal autorizado | Seguridad por fila: el fisioterapeuta solo ve a sus pacientes. El personal administrativo (recepción, AUTH-10) no accede al expediente clínico: ni perfil clínico, notas, estudios, recetas, ejercicios, resumen o exportación; tampoco al motivo de consulta ni a las etiquetas | `db/migrations/0005_audit_rls.sql`, `db/migrations/0013_reception_role.sql`, `src/lib/api.ts` (`auth: 'clinical'`) | `tests/db/schema.test.ts` · AUTH-05; pruebas de aislamiento en cada `tests/api/*`; `tests/db/reception.test.ts` y `tests/api/reception.test.ts` · "nada clínico, ni por API (403) ni por RLS (sin filas)" |
| Resumen clínico a solicitud del paciente | PDF con datos generales, diagnóstico, plan, evolución, estudios y documentos | `src/app/api/patients/[id]/summary` | `tests/api/record.test.ts` · EXP-07 |
| Expediente en medios electrónicos | Permitido por la norma si el sistema cumple NOM-024 (ver abajo) | — | — |

## LEG-02 · NOM-024-SSA3-2012, controles del sistema

| Control | Implementación | Prueba |
| --- | --- | --- |
| Identificación y autenticación de usuarios | Usuario y contraseña (scrypt), política de contraseña, bloqueo tras 5 intentos, cierre por inactividad, passkeys | `tests/api/settings.test.ts` · "idle_minutes decide cuándo readSession cierra una sesión inactiva"; `src/lib/auth/*` |
| Control de acceso por rol | Tres roles (ver "Control de acceso por rol" abajo); rutas exclusivas del dueño responden 403; las rutas clínicas responden 403 a recepción; RLS en todas las tablas | `tests/e2e/flujos.spec.ts` · "un fisioterapeuta no entra a las secciones del dueño" y "recepción no ve el menú clínico…"; `tests/api/reception.test.ts`; `tests/db/reception.test.ts`; `tests/db/schema.test.ts` |
| Bitácora de auditoría | Trigger en todas las tablas clínicas, de pagos y de configuración (quién, qué, cuándo, antes y después); accesos al expediente; la bitácora es inmutable | `tests/api/record.test.ts` · EXP-08; `tests/api/settings.test.ts` · CFG-09 |
| Integridad de la información | Notas, consentimientos, documentos y pagos inmutables; documentos sellados con huella de contenido; folios consecutivos sin huecos | `tests/db/model.test.ts` · DB-04, DB-06, DB-08; `tests/api/documents.test.ts` |
| Confidencialidad de archivos | Bucket privado; URLs firmadas de 5 minutos, solo tras verificar acceso; cada apertura se registra | `tests/api/studies.test.ts` · EST-01 |
| Cifrado | HTTPS en tránsito (Vercel); cifrado en reposo del proveedor (Supabase); credenciales del lector cifradas con AES-256-GCM | `src/lib/crypto.ts` |
| Datos biométricos | La huella vive solo en el lector; el sistema guarda un número de persona; el agente rechaza y nunca envía la plantilla | `tests/db/schema.test.ts` · HUE-16; `tests/bridge/bridge.test.ts`; `tests/api/attendance.test.ts` |
| Disponibilidad y respaldo | Respaldos del proveedor + respaldo propio con prueba de restauración | `docs/respaldos.md`; `pnpm backup:check` |
| Exportación e intercambio | Expediente completo en ZIP (JSON + archivos); respaldo general en CSV | `tests/api/settings.test.ts` · CFG-10 |
| Secretos fuera del código | Variables de entorno validadas; escaneo de secretos en CI (gitleaks) | `.github/workflows/ci.yml` |

## Control de acceso por rol (AUTH-07, AUTH-10)

El permiso se aplica en tres capas independientes: la pantalla no se dibuja, la API responde 403 y la base no
entrega filas (RLS). Cualquiera de las tres basta para negar el acceso; las tres juntas evitan que un descuido en
una capa exponga datos.

| Área | Dueño | Fisioterapeuta | Recepción |
| --- | --- | --- | --- |
| Datos generales y de contacto del paciente | Todos | Sus pacientes | Todos (alta y edición; sin baja, reactivación ni reasignación) |
| Motivo de consulta y etiquetas | Todos | Sus pacientes | Sin acceso |
| Perfil clínico, notas de evolución, ejercicios, estudios, recetas e indicaciones, resumen clínico, exportar expediente | Todos | Sus pacientes | Sin acceso (403 y sin filas) |
| Aviso de privacidad y consentimientos firmados | Todos | Sus pacientes | Todos (firma y PDF) |
| Agenda | Todas las citas | Sus citas | Todas las citas; horarios y bloqueos solo lectura; sin nota de sesión |
| Mensualidades: estado, pagos, recibos, links de cobro, plan, pausa | Sí | Solo plan y estado de sus pacientes | Sí |
| Anular pagos, reembolsos, ingresos, facturación y datos fiscales | Sí | No | No |
| Asistencia y huella de pacientes | Todas las sedes | Su sede y sus pacientes | Todas las sedes |
| Reportes de horas del personal, lectores | Sí | No | No |
| Equipo, Configuración, auditoría, ARCO, respaldos | Sí | No | No |

Cómo se sostiene para recepción:

- **Base de datos** (`db/migrations/0013_reception_role.sql`): políticas propias solo en las tablas administrativas
  (`patients`, `consents`, `appointments`, `time_blocks` lectura, `memberships`, `payments` lectura e inserción,
  `payment_links`, `attendance_events` y `enrollments` de pacientes en lectura). `can_access_patient()` no incluye a
  recepción, así que las tablas clínicas quedan cerradas. El trigger `patients_reception_guard` impide que cambie
  fisioterapeuta, estado, motivo de consulta o etiquetas. Sin política de UPDATE en `payments`: no puede anular.
- **API** (`src/lib/api.ts`): `auth: 'clinical'` en toda ruta clínica (403 a recepción), `auth: 'front'` en cobranza
  (dueño o recepción) y `auth: 'owner'` en lo exclusivo del dueño. Las respuestas de pacientes para recepción omiten
  el motivo de consulta y las etiquetas, y su búsqueda no consulta el diagnóstico.
- **Pantallas**: menú propio; los grupos `(owner)`, `(front)` y `(clinical)` de `src/app/(app)` bloquean por rol
  aunque se escriba la dirección a mano; la ficha del paciente no monta ningún componente clínico.

Pruebas: `tests/db/reception.test.ts` (RLS y trigger, tabla por tabla), `tests/api/reception.test.ts` (lo permitido
y cada 403) y `tests/e2e/flujos.spec.ts` · "recepción no ve el menú clínico…".

## Art. 28 Bis de la Ley General de Salud · prescripción

| Regla | Implementación | Prueba |
| --- | --- | --- |
| Solo médicos (y otros listados) con cédula prescriben medicamentos | "Receta médica" solo para usuarios marcados como médicos con cédula; la base lo exige al emitir | `tests/api/documents.test.ts` |
| El fisioterapeuta indica tratamiento de su disciplina | "Indicaciones fisioterapéuticas" sin renglones de medicamento (la base los rechaza) | `tests/api/documents.test.ts` |
| Datos de la receta (Reglamento de Insumos, arts. 28-31) | Encabezado legal automático copiado al emitir; firma siempre quien emite | `tests/api/documents.test.ts`; `docs/revision-legal.pdf` |
| Controlados requieren recetario especial | Bloqueo de una lista de sustancias controladas comunes | `tests/api/documents.test.ts` |

## LFPDPPP · datos personales sensibles (LEG-03)

| Requisito | Implementación | Prueba |
| --- | --- | --- |
| Aviso de privacidad integral y simplificado | Editables; página pública `/privacidad` | `tests/api/settings.test.ts` · CFG-07 |
| Consentimiento expreso para datos sensibles | Firma del aviso y, por separado, del uso de huella; sin este último no se registra la huella | `tests/api/attendance.test.ts` (`consent_required`) |
| Derechos ARCO | Formulario público, bandeja del dueño con estado y resolución | `tests/api/settings.test.ts` · LEG-03 |

## Pagos y facturación

| Requisito | Implementación | Prueba |
| --- | --- | --- |
| Datos de tarjeta fuera del sistema (PCI DSS) | El paciente paga en la página de Stripe (Checkout); la app nunca recibe ni guarda números de tarjeta, solo el identificador del cobro | `tests/api/online-billing.test.ts` · PAG-12 |
| Autenticidad de los avisos de pago | Firma `Stripe-Signature` (HMAC-SHA256, 5 min de tolerancia) y cada evento se procesa una sola vez | `tests/api/online-billing.test.ts` · "rechaza firmas inválidas", idempotencia |
| CFDI 4.0 emitido por un PAC autorizado | Timbrado con Facturapi; receptor con RFC, nombre, régimen y CP; global a PÚBLICO EN GENERAL con periodicidad | `tests/api/online-billing.test.ts` · FAC-02, FAC-03 |
| Cancelación con motivo (Anexo 20, motivos 01-04) | Motivo obligatorio; 01 exige factura sustituta; el estado en proceso se revisa cada día | `tests/api/online-billing.test.ts` · FAC-04 |
| Integridad entre cobro y factura | Un pago solo en una factura vigente (índice único); un pago facturado no se anula | `tests/api/online-billing.test.ts` |
| Datos fiscales como datos personales | Solo el dueño los ve (RLS); cambios en bitácora | `db/migrations/0012_online_payments_cfdi.sql` |

El tratamiento del IVA (16 % o exento por el art. 15 fr. XIV LIVA) es configurable y debe confirmarlo el contador.
