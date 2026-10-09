# Nicolas Center Elite

Sistema clínico del centro de fisioterapia y readaptación deportiva Nicolas Center Elite (Córdoba y Orizaba, Ver.):
pacientes y expediente clínico, agenda, indicaciones y recetas, estudios, mensualidades con cobro en línea (tarjeta
y OXXO) y facturación CFDI 4.0, asistencia con el lector de huella Hikvision, equipo y configuración. Dos roles: dueño y fisioterapeuta.

| Documento | Para qué |
| --- | --- |
| [docs/despliegue.md](docs/despliegue.md) | Poner la app en línea: cada servicio y cada variable, paso a paso |
| [docs/manual.md](docs/manual.md) | Manual de uso para dueño y fisioterapeutas |
| [bridge/README.md](bridge/README.md) | Instalar el agente del lector en la PC de recepción |
| [docs/cumplimiento.md](docs/cumplimiento.md) | NOM-004, NOM-024, art. 28 Bis LGS y LFPDPPP, con la prueba de cada control |
| [docs/revision-legal.pdf](docs/revision-legal.pdf) | Paquete para el abogado o responsable sanitario |
| [docs/respaldos.md](docs/respaldos.md) | Respaldos y restauración |
| [docs/calidad.md](docs/calidad.md) | Pruebas, revisión visual y rendimiento |
| [docs/trazabilidad.md](docs/trazabilidad.md) | Cada tarea del backlog: código y prueba que la cubren |
| [CONVENTIONS.md](CONVENTIONS.md) | Reglas para escribir código en este repositorio |

## Stack

Next.js 15 + React 19 + TypeScript · Postgres con seguridad por fila (Supabase en producción) · almacenamiento
privado con URLs firmadas · pdf-lib · passkeys (WebAuthn) · Resend · Stripe Checkout · Facturapi (CFDI 4.0) · Vercel. El agente puente del lector es
Node puro, sin dependencias.

## Desarrollo local

Requisitos: Node 20+, pnpm 10, PostgreSQL 16.

```
pnpm install
cp .env.example .env.local          # ajusta DATABASE_URL a tu Postgres
pnpm db:reset && pnpm db:seed       # base de demostración (11 pacientes, 4 fisioterapeutas)
pnpm dev                            # http://localhost:3000
```

Usuarios de demostración (contraseña `Elite2026demo`): `nicolas.h` (dueño), `m.reyes` (médico, puede recetar),
`k.ocampo`, `d.salinas`, `a.pineda`. Con una base vacía, `/setup` crea la cuenta del dueño.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Desarrollo, build y servidor de producción |
| `pnpm lint` / `pnpm typecheck` | ESLint y TypeScript |
| `pnpm test` | Pruebas unitarias, de base de datos (RLS) y de API |
| `npx vitest run -c vitest.bridge.config.ts` | Pruebas del agente puente contra el lector simulado |
| `pnpm test:e2e` | Punta a punta en navegador (requiere la app corriendo con la base de demostración) |
| `pnpm db:migrate` / `pnpm db:reset` / `pnpm db:seed` | Migraciones, reinicio (no en producción), demostración |
| `pnpm backup` / `pnpm backup:check <carpeta>` | Respaldo de base y archivos; prueba de restauración |
| `pnpm legal:packet` | Regenera `docs/revision-legal.pdf` |
| `pnpm trace` | Regenera `docs/trazabilidad.md` |

## Estructura

```
db/migrations/        esquema SQL versionado: tablas, reglas, RLS, auditoría, datos base
src/lib/              núcleo: acceso a datos, API, sesión, cifrado, fechas, PDF, almacenamiento
src/components/       sistema de diseño y armazón de navegación
src/modules/<módulo>/ pacientes, expediente, estudios, documentos, agenda, mensualidades, huella, equipo, ...
src/app/              pantallas y rutas de la API
bridge/               agente puente del lector Hikvision (+ simulador del lector)
tests/                unitarias, base de datos, API, agente, punta a punta
scripts/              migraciones, demostración, respaldo, paquete legal, trazabilidad
```

## Pendiente fuera del código

Solo los pasos manuales de `docs/despliegue.md` (cuentas de Supabase, Resend, Vercel, Stripe y Facturapi,
variables, dominio, lector) y la prueba con el lector físico (`node bridge.mjs --probe` y `--probe-enroll`, ver
`bridge/README.md`). Las integraciones con Stripe y Facturapi están probadas contra servidores falsos que imitan
sus APIs (`tests/fakes/providers.ts`); la primera prueba con las llaves de prueba reales está en el paso 10 y 11.
