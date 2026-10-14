# Despliegue en Railway (opción recomendada para una sola clínica)

Todo en un proyecto de Railway: la app, Postgres y un volumen (disco) para los estudios. Sin Vercel ni Supabase.
Costo esperado: el plan Hobby (5 USD al mes, que ya incluye 5 USD de consumo). Una clínica consume de 3 a 5 USD
al mes. Pon un límite de gasto en **Workspace → Usage → Usage limits** (por ejemplo 8 USD).

## Qué hace el repositorio por ti

- `railway.json`: compila con `pnpm build` y arranca con `pnpm start:railway`, que aplica las migraciones,
  prepara el almacenamiento y levanta la app en el puerto que asigna Railway (`PORT`).
- **Tarea diaria** sin Vercel Cron: con `INTERNAL_CRON=true` la app corre su propio reloj (01:30, hora de la
  Ciudad de México) y la tabla `job_runs` garantiza una sola ejecución por día.
- **Estudios en disco**: `STORAGE_DRIVER=local` con `LOCAL_STORAGE_DIR=/data/storage` sobre el volumen.
  Los archivos siguen sin ser públicos: se sirven con URLs firmadas de 5 minutos.

## Pasos

1. railway.com → **New Project → Deploy from GitHub repo** → `nicolas-center-elite`.
2. En el proyecto: **+ Create → Database → PostgreSQL**. Queda un servicio "Postgres".
3. Servicio de la app → **Settings → Networking → Generate Domain**. Railway da `algo.up.railway.app`.
4. Servicio de la app → clic derecho o **+ → Volume**, montado en **`/data`**.
5. Servicio de la app → **Variables** (en **Raw Editor** se pueden pegar todas):

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia; Railway la llena sola) |
| `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (o `https://tudominio.com` cuando tengas dominio) |
| `APP_ENV` | `production` |
| `STORAGE_DRIVER` | `local` |
| `LOCAL_STORAGE_DIR` | `/data/storage` |
| `INTERNAL_CRON` | `true` |
| `EMAIL_FROM` | `Nicolas Center Elite <onboarding@resend.dev>` (o el de tu dominio con Resend) |
| `SESSION_SECRET` | 48+ caracteres aleatorios (`openssl rand -base64 48`) |
| `ENCRYPTION_KEY` | 32+ caracteres aleatorios, distinto |
| `SETUP_TOKEN` | 24+ caracteres aleatorios |

   Opcionales, igual que en `docs/despliegue.md`: `RESEND_API_KEY`, `STRIPE_*`, `FACTURAPI_KEY`.
   `CRON_SECRET` no hace falta con `INTERNAL_CRON=true`.
6. **Deploy**. En los logs debe verse `Aplicando 0001_base.sql … ok`, `Ready` y
   `[tarea diaria] reloj interno activo`.
7. Abrir `APP_URL/setup` y crear la cuenta del dueño.

## Respaldos

- **Volúmenes** (estudios y la base, porque Postgres en Railway también vive en un volumen): en cada servicio
  → **Backups** → programar diario. Se cobran por el espacio que ocupan.
- **Respaldo propio de la base** desde cualquier PC: `DIRECT_DATABASE_URL=<DATABASE_PUBLIC_URL del servicio
  Postgres> pnpm backup`. Los archivos del volumen se respaldan con los Backups de Railway.

## Dominio propio

Servicio de la app → **Settings → Networking → Custom Domain**: agrega `app.tudominio.com` y crea en tu DNS el
registro CNAME que indica Railway. Después cambia `APP_URL` a ese dominio. El acceso con huella del celular
(passkeys) queda ligado al dominio: si cambia, cada usuario vuelve a registrar su dispositivo.

## Límites del plan Hobby

Volumen de hasta 5 GB (cientos de radiografías y PDF). Si se llena, Railway Pro permite crecerlo, o se puede
volver a Supabase Storage (`STORAGE_DRIVER=supabase`) sin cambiar código.
