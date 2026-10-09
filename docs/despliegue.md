# Despliegue a producción

Todo el código está listo. Lo único manual es crear las cuentas de los servicios, pegar las variables y
configurar el lector. Esta guía es la base del prompt para Claude in Chrome (DEP-05).

Arquitectura: **Vercel** (app y API) + **Supabase** (Postgres y almacenamiento privado de archivos) +
**Resend** (correo) + **Stripe** (cobro en línea con tarjeta y OXXO) + **Facturapi** (timbrado de facturas CFDI 4.0) +
el **agente puente** en la PC de recepción (lector Hikvision).

## Orden de los pasos

| # | Paso | Dónde | Resultado |
| --- | --- | --- | --- |
| 1 | Subir el repositorio a GitHub (privado) | github.com | Repositorio `nicolas-center-elite` |
| 2 | Crear el proyecto de Supabase | supabase.com | Base de datos y almacenamiento |
| 3 | Crear la cuenta de Resend y verificar el dominio | resend.com | Llave de correo |
| 4 | Crear el proyecto de Vercel, conectar el repositorio, pegar variables y desplegar | vercel.com | App en línea; migraciones y bucket se crean solos |
| 5 | Apuntar el dominio a Vercel | proveedor del dominio + Vercel | App en el dominio de la clínica |
| 6 | Crear la cuenta del dueño en `/setup` | la app | Acceso del dueño |
| 7 | Configurar clínica, sedes, planes e invitar al equipo | la app | Sistema en operación |
| 8 | Dar de alta el lector e instalar el agente puente | la app + PC de recepción | Asistencia por huella |
| 9 | Configurar el webhook en el lector | página web del lector | Asistencias al instante |
| 10 | Crear la cuenta de Stripe, activar OXXO y registrar el webhook | dashboard.stripe.com | Cobro en línea |
| 11 | Crear la organización en Facturapi y subir el CSD de la clínica | dashboard.facturapi.io | Facturas CFDI |

Los pasos 8 y 9 se hacen desde una computadora **dentro de la red de la clínica**. Los pasos 10 y 11 se pueden
hacer en cualquier momento después del 4; mientras no se hagan, la app funciona igual y los botones "Cobrar en
línea" y "Facturar" avisan que falta conectar el servicio.

## 1. GitHub

Crear un repositorio **privado** y subir esta carpeta (`git push`). El pipeline de `.github/workflows/ci.yml`
corre solo en cada push: lint, tipos, pruebas unitarias, de base de datos y de API, pruebas del agente y build.

## 2. Supabase

1. supabase.com → **New project**. Región: la más cercana a México disponible (por ejemplo `us-east-1`).
   Guardar la contraseña de la base que se define aquí.
2. **Project Settings → Database → Connection string**:
   - "Transaction pooler" (puerto **6543**) → `DATABASE_URL`
   - "Session pooler" (host `…pooler.supabase.com`, puerto **5432**) → `DIRECT_DATABASE_URL`. No usar la
     "Direct connection" (`db.xxxx.supabase.co`): en los proyectos nuevos solo funciona por IPv6 y el build de
     Vercel no la alcanza.
   Sustituir `[YOUR-PASSWORD]` por la contraseña del paso 1.
3. **Project Settings → API**: Project URL → `SUPABASE_URL`; `anon public` → `SUPABASE_ANON_KEY`;
   `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (secreta).
4. No hace falta crear tablas ni el bucket: el build los crea (`scripts/migrate.mjs`, `scripts/setup-storage.mjs`).
5. **Database → Backups**: confirmar que los respaldos automáticos están activos en el plan contratado
   (ver `docs/respaldos.md`).

## 3. Resend (correo)

1. resend.com → crear cuenta → **Domains → Add domain** con el dominio de la clínica; agregar en el DNS los
   registros que indica y esperar "Verified".
2. **API Keys → Create** (permiso de envío) → `RESEND_API_KEY`.
3. `EMAIL_FROM`, por ejemplo `Nicolas Center Elite <no-reply@nicolascenterelite.mx>` (mismo dominio verificado).

Sin Resend la app funciona: las invitaciones muestran un enlace para copiar y enviarlo por WhatsApp.

## 4. Vercel

1. vercel.com → **Add New → Project** → importar el repositorio. Framework: Next.js (lo detecta `vercel.json`).
2. **Environment Variables** (entorno Production) — todas:

| Variable | Valor | De dónde sale |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres.xxxx:CONTRASEÑA@aws-0-….pooler.supabase.com:6543/postgres` | Supabase, paso 2.2 (pooler) |
| `DIRECT_DATABASE_URL` | `postgresql://postgres.xxxx:CONTRASEÑA@aws-0-….pooler.supabase.com:5432/postgres` | Supabase, paso 2.2 (session pooler) |
| `SESSION_SECRET` | 48+ caracteres aleatorios | Generar: `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | 32+ caracteres aleatorios, distinto del anterior | Generar: `openssl rand -base64 32` |
| `APP_URL` | `https://app.nicolascenterelite.mx` (sin `/` final) | El dominio final. Mientras no exista, la URL `*.vercel.app` del proyecto |
| `APP_ENV` | `production` | Fijo |
| `SETUP_TOKEN` | 24+ caracteres aleatorios | Generar; solo sirve para crear la cuenta del dueño una vez |
| `CRON_SECRET` | 32+ caracteres aleatorios | Generar; Vercel lo envía a la tarea diaria |
| `STORAGE_DRIVER` | `supabase` | Fijo |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase, paso 2.3 |
| `SUPABASE_ANON_KEY` | `eyJ…` | Supabase, paso 2.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ…` (secreta) | Supabase, paso 2.3 |
| `SUPABASE_BUCKET` | `estudios` | Fijo |
| `RESEND_API_KEY` | `re_…` | Resend, paso 3.2 |
| `EMAIL_FROM` | `Nicolas Center Elite <no-reply@dominio>` | Resend, paso 3.3 |
| `STRIPE_SECRET_KEY` | `sk_test_…` al probar, `sk_live_…` en operación (secreta) | Stripe, paso 10.4 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (secreta) | Stripe, paso 10.5 |
| `FACTURAPI_KEY` | `sk_test_…` al probar, `sk_live_…` en operación (secreta) | Facturapi, paso 11.5 |

   Las tres últimas se pueden agregar después (pasos 10 y 11); al cambiarlas hay que volver a desplegar.

   `ENABLE_SIMULATOR` **no** se define en producción (el simulador de huella nunca existe con `APP_ENV=production`).
3. **Deploy**. El build corre `pnpm vercel-build`: aplica las migraciones, crea el bucket privado y compila.
   La tarea diaria (`/api/cron/daily`, 01:30 hora de México) queda programada por `vercel.json`.
4. Abrir la URL: si falta o está mal una variable, la app lo dice por nombre.

> Importante: `APP_URL` debe ser exactamente el dominio con el que se usa la app. El acceso con huella del
> celular (passkeys) queda ligado a ese dominio; si después se cambia el dominio, cada usuario debe volver a
> registrar su dispositivo en "Mi perfil".

## 5. Dominio

Vercel → proyecto → **Settings → Domains → Add** `app.nicolascenterelite.mx` → crear en el DNS el registro
`CNAME app → cname.vercel-dns.com` (Vercel muestra el valor exacto). Luego cambiar `APP_URL` a ese dominio y
volver a desplegar (**Deployments → Redeploy**).

## 6. Cuenta del dueño

Abrir `https://<dominio>/setup`, capturar el `SETUP_TOKEN`, nombre, usuario, correo y contraseña (10+ caracteres
con letras y números). La página deja de existir en cuanto hay un usuario.

## 7. Configuración inicial (en la app, como dueño)

1. **Configuración → Clínica**: razón social, teléfono, correo, logo.
2. **Configuración → Sedes**: domicilio completo, teléfono y horario de Córdoba y Orizaba (salen impresos en
   recetas e indicaciones).
3. **Configuración → Membresías**: revisar precios de los 5 planes precargados.
4. **Configuración → Plantillas**: pegar los textos que valide el abogado (`docs/revision-legal.pdf`).
5. **Equipo → Agregar fisioterapeuta**: uno por persona, con cédula. Marcar "Es médico con cédula" solo a quien
   pueda recetar medicamentos. Cada uno recibe su invitación.

## 8. Lector y agente puente

**Configuración → Lectores → Agregar lector** (modelo DS-K1T321EFWX-B, IP del lector, usuario y contraseña del
lector) → **Datos de conexión** → descargar `config.json`. En la PC de recepción seguir `bridge/README.md`
(instalar Node LTS, copiar la carpeta `bridge`, `node bridge.mjs --check`, `install-windows.ps1`).

## 9. Webhook en el lector

Página web del lector (`https://<IP del lector>`) → **Configuration → Network → Advanced → HTTP Listening**:
protocolo HTTPS, puerto 443, host = dominio de la app, URL = la ruta `/api/hik/events/<token>` que muestra
**Datos de conexión**. Detalle y solución de problemas en `bridge/README.md`.

## 10. Stripe (cobro en línea con tarjeta y OXXO)

1. dashboard.stripe.com → crear la cuenta con el correo de la clínica. País **México**, moneda **MXN**.
2. **Activar la cuenta** (Settings → Business): datos fiscales de la clínica o del dueño (RFC, domicilio,
   identificación) y la **cuenta bancaria CLABE** donde Stripe depositará. Mientras no se active, solo funciona el
   modo de prueba.
3. **Settings → Payment methods**: confirmar **Cards** activo y activar **OXXO** (en México lo aprueba Stripe en
   minutos u horas). Si OXXO no se activa, apagar "Aceptar pago en efectivo en OXXO" en la app.
4. **Developers → API keys** → *Secret key* → `STRIPE_SECRET_KEY`. Empezar con la de **prueba** (`sk_test_`); al
   terminar la verificación cambiarla por la de producción (`sk_live_`).
5. **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://<dominio>/api/webhooks/stripe` (la app la muestra en Configuración → Cobros y facturación)
   - Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Guardar y copiar el **Signing secret** → `STRIPE_WEBHOOK_SECRET`.
   El webhook de prueba y el de producción son distintos: al pasar a `sk_live_` se crea el endpoint también en modo
   *live* y se reemplaza `STRIPE_WEBHOOK_SECRET` por el nuevo.
6. **Settings → Emails**: activar "Successful payments" para que el paciente reciba su comprobante de Stripe.
7. Pegar las variables en Vercel y volver a desplegar. En la app: **Configuración → Cobros y facturación** debe
   decir "Stripe · Conectado · prueba".
8. Prueba: expediente de un paciente → Membresía → **Cobrar en línea** → abrir el link → pagar con la tarjeta
   `4242 4242 4242 4242` (cualquier fecha futura y CVC). En segundos el pago aparece en su historial con
   "Registró: Pago en línea (Stripe)". Para OXXO de prueba usar el correo `succeed_immediately@test.com`.

Comisiones aproximadas (consultar stripe.com/mx/pricing): tarjeta 3.6 % + $3 MXN + IVA; OXXO 3.6 % + $3 MXN + IVA.

## 11. Facturapi (facturación CFDI 4.0)

Requisitos de la clínica (los tiene el contador): **RFC**, **régimen fiscal**, **código postal del domicilio
fiscal** y el **Certificado de Sello Digital (CSD)**: archivos `.cer` y `.key` y su contraseña. El CSD **no** es la
e.firma: se tramita en el portal del SAT con la e.firma (programa Certifica).

1. dashboard.facturapi.io → crear la cuenta.
2. **Organizaciones → Nueva organización** con la razón social de la clínica.
3. En la organización: **Datos fiscales** (razón social exacta como en la constancia, RFC, régimen, CP) y
   **Certificados (CSD)**: subir `.cer`, `.key` y contraseña.
4. **Personalización**: logo y, si se quiere, el texto del correo con el que se envían las facturas.
5. **Llaves de API** de la organización → *Live secret key* → `FACTURAPI_KEY` (la *Test key* timbra sin validez,
   útil para probar). Facturapi cobra por folio timbrado según su plan.
6. En la app, **Configuración → Cobros y facturación**: capturar el **código postal del lugar de expedición**
   (el mismo de Facturapi), confirmar con el contador si los servicios llevan **IVA 16 %** o son **exentos**, y
   revisar clave de producto (85122101), unidad (E48) y serie.
7. Prueba: Membresía de un paciente → historial de pagos → **Facturar** → capturar sus datos fiscales → Timbrar →
   descargar PDF y XML. Con la llave de prueba la factura sale marcada "Prueba".

Cada mes, en los 3 días siguientes al cierre: **Mensualidades → Facturas → Factura global** para los pagos que
nadie pidió facturar (una por forma de pago).

## Verificación final

- [ ] `/login` entra con la cuenta del dueño; `/setup` ya no está disponible.
- [ ] Un fisioterapeuta invitado recibe el correo, define su contraseña y solo ve a sus pacientes.
- [ ] Alta de un paciente de prueba → firma de aviso y consentimientos → registro de huella en el lector.
- [ ] Al poner el dedo, la asistencia aparece en **Control de huella** sin recargar.
- [ ] Subir un estudio y abrirlo; el enlace copiado deja de funcionar a los 5 minutos.
- [ ] Emitir unas indicaciones e imprimirlas.
- [ ] Registrar un pago y descargar el recibo.
- [ ] Cobrar en línea con la tarjeta de prueba y ver el pago registrado solo.
- [ ] Facturar ese pago, descargar PDF y XML, y cancelarlo con motivo 02.
- [ ] Cambiar a llaves `sk_live_` de Stripe y Facturapi y volver a desplegar.
- [ ] Dar de baja al paciente de prueba (la huella se elimina del lector).
