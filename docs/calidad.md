# Calidad y pruebas

## Cómo correr todo

```
pnpm lint && pnpm typecheck
pnpm test                                    # unitarias, base de datos/RLS y API (Postgres local o TEST_DATABASE_URL)
npx vitest run -c vitest.bridge.config.ts    # agente puente contra el lector simulado
pnpm db:reset && pnpm db:seed && pnpm build && pnpm start   # en otra terminal
pnpm test:e2e                                # punta a punta en navegador, escritorio y celular
```

## Resultado de la última corrida

| Suite | Resultado |
| --- | --- |
| Unitarias + base de datos/RLS + API (17 archivos) | 381 de 381 |
| Agente puente (incluye firmware sin captura a distancia) | 30 de 30 |
| Punta a punta (escritorio 1440 px y celular Pixel 7) | 6 de 6 |
| ESLint y TypeScript | sin errores ni avisos |
| Build de producción | correcto |

## QA-01 a QA-04

- **QA-01** Reglas: estado de membresía, empalmes, deduplicación de asistencias, folios (`tests/unit`, `tests/db`).
- **QA-02** Cada ruta de la API se prueba como dueño y como fisioterapeuta, incluido el aislamiento entre
  fisioterapeutas (`tests/api`).
- **QA-03** Flujos del mockup en navegador real (`tests/e2e/flujos.spec.ts`): alta de paciente, nota firmada,
  indicaciones (con la receta médica bloqueada para un no médico), cita, asistencia manual, pago y bloqueo de
  secciones del dueño. Se pueden repetir sin reiniciar la base.
- **QA-04** Cargas del lector: multipart, JSON, XML, latido, evento de puerta, huella no reconocida, duplicado
  y mal formado (`tests/fixtures/hik`, `tests/unit/hik-parser.test.ts`, `tests/api/attendance.test.ts`).

## Cobro en línea y facturación contra proveedores falsos

`tests/fakes/providers.ts` levanta un servidor que imita Stripe (Checkout, expirar, reembolsos) y Facturapi
(timbrar, consultar, cancelar con aceptación pendiente, descargas y correo). Las pruebas apuntan
`STRIPE_API_BASE` y `FACTURAPI_API_BASE` a ese servidor, así que el código real de los clientes, la firma del
webhook, la idempotencia y los errores se ejercitan completos (`tests/api/online-billing.test.ts`, 24 pruebas).
El mismo servidor se usó para recorrer el flujo en el navegador: cobrar en línea → pago confirmado por webhook →
facturar → descargar, a 390 px y 1440 px.

## QA-05 · Revisión visual

Se revisaron capturas de todas las pantallas como dueño y como fisioterapeuta, a 390 px y 1440 px, contra el
mockup (`node scripts/dev/shot.mjs`). Correcciones hechas en la revisión: recorte de acentos en los subtítulos
del encabezado y capas de desenfoque anidadas que rompían el render en las capturas del mockup (las tarjetas
ya no usan `backdrop-filter`; queda solo en barra lateral, barra inferior y hojas).

## QA-06 · Rendimiento

`node scripts/dev/perf.mjs` simula un celular de gama media (CPU 4 veces más lenta, red 4G de 9 Mbps):

| Pantalla | Primera pintura | Carga completa | Transferido |
| --- | --- | --- | --- |
| Login (primera visita) | 356 ms | 675 ms | 358 KB |
| Inicio | 252 ms | 275 ms | 36 KB |
| Pacientes | 180 ms | 267 ms | 28 KB |
| Agenda | 248 ms | 239 ms | 30 KB |
| Control de huella | 212 ms | 244 ms | 32 KB |

Medido contra el servidor local; en producción se suma la latencia real de red hasta Vercel y Supabase.
Accesibilidad: foco visible, etiquetas en todos los campos, hojas con trampa de foco y cierre con Escape,
`prefers-reduced-motion` y `prefers-reduced-transparency` respetados.
