# Backlog

El backlog aprobado (17 épicas, 145 tareas, con criterio de terminado por tarea) vive en este documento:

https://claude.ai/code/artifact/4ef710f8-9420-4c7a-9fb9-e616d0b93152

Los IDs de tarea (INF-01, PAC-03, HUE-07…) se citan en comentarios del código y en los nombres de las pruebas.
La matriz de qué archivo y qué prueba cubre cada tarea está en `docs/trazabilidad.md`.

## Ampliación aprobada después del backlog: perfil de Recepción

| ID | Tarea | Terminado cuando |
| --- | --- | --- |
| AUTH-10 | Rol "Recepción" (`reception`) | Quien atiende el mostrador opera lo administrativo de todos los pacientes de todas las sedes (alta y datos de contacto, firmas del alta, agenda de todos los fisioterapeutas, mensualidades y cobro en línea, asistencia y huella de pacientes) y nunca ve información clínica: las rutas clínicas le responden 403 y RLS no le entrega filas. Anular pagos, reembolsos, facturación, ingresos, Equipo, Configuración y auditoría siguen siendo del dueño. El dueño invita y desactiva cuentas de recepción desde Equipo |

## Ampliación aprobada después del backlog: lector USB DigitalPersona

| ID | Tarea | Terminado cuando |
| --- | --- | --- |
| HUE-20 | Lector USB DigitalPersona U.are.U 4500 como segundo tipo de lector | El dueño agrega un lector "USB DigitalPersona" (sin IP ni contraseña) junto al Hikvision, que no cambia. El agente puente detecta el tipo y usa su chofer USB: registra la huella con 4 toques (avance visible en la app, duplicados rechazados), guarda las plantillas cifradas solo en la PC, identifica en vivo y envía cada checada por el mismo camino que el Hikvision (cola local sin internet, recuperar eventos, `--check` y `--probe --usb`). Con lector USB la app no ofrece rostro. Pendiente: validar con el equipo real (`bridge/README.md`) |

## Ampliación aprobada después del backlog: cobro en línea y facturación

| ID | Tarea | Terminado cuando |
| --- | --- | --- |
| PAG-12 | Cobro en línea con Stripe (tarjeta y OXXO) | El dueño genera un link desde la membresía, lo manda por WhatsApp; al pagar, el webhook firmado registra el pago solo (idempotente), con revisión si la membresía cambió, reembolso opcional al anular y vencimiento diario de links |
| FAC-01 | Datos fiscales del paciente | RFC, nombre, régimen, CP, uso CFDI y correo validados y guardados por paciente |
| FAC-02 | Factura individual CFDI 4.0 | Uno o varios pagos de un paciente se timbran en Facturapi (clave 85122101, IVA configurable), se envían por correo y el pago queda marcado; un pago facturado no se anula |
| FAC-03 | Factura global mensual | Los pagos sin factura del mes se timbran a PÚBLICO EN GENERAL, una por forma de pago, con periodicidad mensual |
| FAC-04 | Cancelación con motivo SAT | Cancelar con motivos 01-04 (01 con sustituta); si queda en proceso, la tarea diaria la cierra; el pago se libera |
| FAC-05 | Configuración de cobros y facturación | Estado de las conexiones (prueba/producción), webhook, OXXO, vigencia, IVA, CP de expedición, claves y serie editables |
| FAC-06 | Consulta y descargas | Lista de facturas con filtros, PDF, XML, ZIP y reenvío por correo |
