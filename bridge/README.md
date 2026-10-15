# Agente puente del lector de huella

El lector Hikvision de recepción (**DS-K1T321EFWX-B**, firmware V3.9.50) solo acepta órdenes desde la red local
de la clínica. La app vive en internet, así que este pequeño programa corre en la PC de recepción y hace de puente:

- Pide a la app, cada 2 segundos, si hay órdenes: registrar una huella o un rostro, quitar a una persona, probar
  conexión, sincronizar la hora, recuperar eventos.
- Las ejecuta contra el lector (ISAPI con autenticación Digest) y devuelve el resultado.
- Cada 15 segundos lee el historial del lector y envía las asistencias nuevas. Si se va el internet, guarda en
  `state.json` hasta dónde envió y, al volver, manda todo lo pendiente.

Solo hace conexiones **de salida**: no hay que abrir puertos en el módem.

**Privacidad.** La plantilla de la huella y la foto del rostro existen solo en la memoria del agente entre "capturar"
y "guardar en el lector". Nunca se envían a la app, nunca se escriben en disco ni en el registro. La app guarda
únicamente el número de persona (por ejemplo `P1002`) y la fecha de registro.

## Requisitos

- PC con Windows 10/11 encendida en horario de la clínica, conectada a la misma red que el lector.
- Node.js 20 o superior (versión LTS de https://nodejs.org).
- Usuario y contraseña de administrador del lector.

## Antes de instalar: probar con el lector real (5 minutos)

Desde cualquier computadora conectada a la red del lector (la de recepción o una laptop), con Node instalado y esta
carpeta copiada. No necesita la app ni internet:

```
node bridge.mjs --probe --host 192.168.80.212 --user admin --pass <contraseña del lector>
```

Es de **solo lectura**: muestra modelo, firmware y hora del lector; qué funciones acepta este firmware (alta de
personas, captura de huella a distancia, historial, aviso por HTTP); las personas que ya tiene dadas de alta con su
número y cuántas huellas; y las últimas lecturas de 7 días. Guarda todo en `probe-report.json` (sin contraseñas ni
huellas). Si el lector usa HTTP en lugar de HTTPS, agrega `--http`.

Después, la prueba completa con una persona **temporal** (`NCEPRUEBA`), que se borra al final:

```
node bridge.mjs --probe-enroll --host 192.168.80.212 --user admin --pass <contraseña>
```

Da de alta a la persona, pide poner el dedo (si el firmware no permite captura a distancia, indica registrar la
huella en la pantalla del lector y lo detecta solo), pide un check-in con el mismo dedo, comprueba que la lectura
aparece en el historial y da de baja a la persona. Las personas reales del lector no se tocan.

## Personas que ya estaban en el lector

Si el lector ya tiene personas con huella (por ejemplo el perfil del dueño), no hace falta registrarlas de nuevo:
**Configuración → Lectores → Personas en el lector** lista lo que tiene el equipo y permite **ligar** cada número
con un paciente o con alguien del equipo. Sus lecturas sin dueño que ya hubieran llegado se le asignan al ligarlo.

## Registro de huella y de rostro según el firmware

- **Captura a distancia** (si el firmware la acepta): en la app se pulsa "Registrar huella" (o "Registrar rostro") y
  el paciente pone el dedo en el lector (o mira a la cámara); listo.
- **Registro en la pantalla del lector** (firmwares que no aceptan captura a distancia): la app da de alta a la
  persona y muestra su número; en el lector: *Gestión de usuarios → buscar el número → Huella (o Rostro)*.
  La app lo detecta sola en cuanto el lector tiene el dato (hasta 4 minutos de espera).

El agente decide automáticamente cuál usar; no hay nada que configurar. Cada firmware acepta la orden de captura
en un formato distinto (XML con encabezado, XML sin encabezado o JSON): el agente los prueba en orden, el lector
rechaza al instante los que no le gustan (`badXmlContent`) y el agente recuerda el que funcionó. Si cae al modo
"registrar en pantalla", en `logs\agente.log` queda el motivo exacto que dio el lector.

## Varios lectores en la misma PC

Lo normal es **un lector por PC de recepción** (cada sede con la suya): se instala el agente en cada PC con el
`config.json` de su lector. Si una misma PC debe atender **dos o más lectores** de la misma red, en la app,
**Datos de conexión** de cualquiera de ellos ofrece **"Descargar config.json con todos los lectores de la sede"**:

```json
{
  "cloud_url": "https://app.tuclinica.mx",
  "readers": [
    { "name": "Recepción", "bridge_token": "…" },
    { "name": "Consultorio 2", "bridge_token": "…" }
  ]
}
```

El agente corre un ciclo por lector (cada uno con su token, su `state-<nombre>.json` y sus mensajes con prefijo
`[nombre]`), `--check` revisa cada lector y `--probe` acepta `--reader "nombre"`. El `config.json` de un solo
lector sigue funcionando igual que siempre.

## Probar todo en la red local antes de tener dominio

La app puede correr en una PC de la clínica (`pnpm build && pnpm start`) y el agente apuntar a ella por HTTP:
en `config.json`, `cloud_url` puede ser `http://192.168.x.x:3000` (solo se permite HTTP para direcciones de red
local). Así se valida alta, huella, check-in y baja de punta a punta con el lector real antes de subir la app a
internet.

## Instalación (10 minutos)

1. En la app, entra como dueño a **Configuración → Lectores**. Si el lector no existe, pulsa **Agregar lector**
   (nombre, sede, dirección IP, usuario y contraseña del lector).
2. Pulsa **Datos de conexión** y descarga `config.json`.
3. Copia esta carpeta `bridge` a la PC de recepción (por ejemplo `C:\NicolasCenterElite\bridge`) y pon ahí el `config.json`.
4. Abre PowerShell en esa carpeta y corre el diagnóstico:
   ```
   node bridge.mjs --check
   ```
   Debe responder que la configuración es válida, que la app responde y que el lector responde con su modelo y serie.
5. Instala el servicio (PowerShell **como administrador**). Queda como tarea programada de Windows: arranca al
   encender la PC, corre en segundo plano sin ventana y se reinicia solo si se detiene.
   ```
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
   ```
6. En la app, **Configuración → Lectores** debe mostrar "Agente puente conectado". Pulsa **Probar conexión**.

Para desinstalar: `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Uninstall`.

## Webhook directo del lector (recomendado, además del agente)

El lector también puede enviar cada lectura directo a la app, sin pasar por el agente. Así la asistencia aparece
en pantalla al instante aunque la PC de recepción esté apagada. En la página web del lector
(`https://<IP del lector>`, usuario admin):

1. **Configuration → Network → Advanced → HTTP Listening** (en algunos firmwares: *Event Alarm Server* o *HTTP Host*).
2. Activa el envío y captura exactamente lo que muestra la app en **Datos de conexión**:
   - Protocolo: HTTPS · Puerto: 443
   - Dirección / host: el dominio de la app (por ejemplo `app.tuclinica.mx`)
   - URL / ruta: `/api/hik/events/<token>`
3. Guarda. En la app, la columna "Última lectura" del lector cambia al poner un dedo.

El botón **Configurar webhook en el lector** de la app intenta hacer este paso por ISAPI a través del agente; si el
firmware no lo acepta, se hace a mano como arriba.

Si un evento llega por las dos vías (webhook y agente), la app lo registra una sola vez.

## Solución de problemas

| Síntoma | Qué revisar |
| --- | --- |
| `--check` dice que la app no responde | Internet de la PC; que `cloud_url` sea la dirección de la app con `https://`; que el token no se haya regenerado. |
| `--check` dice 401 del lector | Usuario o contraseña del lector (se cambian en la app, Configuración → Lectores → Editar). |
| `--check` no alcanza al lector | IP del lector (pantalla del lector: *Comm. Settings*); que la PC y el lector estén en la misma red. |
| "Tiempo agotado" al registrar huella o rostro | El dedo (o la cara) debe ponerse en los 45 segundos siguientes a pulsar "Registrar"; si el lector pide registrar en su pantalla, hay 4 minutos. |
| La app pide registrar en la pantalla del lector aunque el lector sí capture a distancia | Revisar en `logs\agente.log` el motivo entre paréntesis ("El lector no permite captura a distancia (…)") y mandarlo a quien mantiene el sistema. |
| No sé si el firmware acepta algo | `node bridge.mjs --probe` y revisar `probe-report.json`. |
| Calidad baja | Limpiar el sensor y el dedo; volver a registrar. |
| Las asistencias no llegan | Ver `logs\agente.log`. Si el agente está bien pero no hay webhook, llegan cada 15 s por el historial. |

## Pruebas

`mock-device.mjs` simula el lector (Digest, alta de persona, captura de huella y de rostro, registro en pantalla,
búsqueda de personas, historial de eventos). Con `--no-remote-capture` simula un firmware sin captura a distancia. Las pruebas automáticas
del agente corren contra él:

```
npx vitest run -c vitest.bridge.config.ts
```

## Pendiente de validar en el equipo real

Todo se probó contra el simulador, construido con la documentación pública de ISAPI. `--probe` y `--probe-enroll`
confirman en 5 minutos estas piezas con el DS-K1T321EFWX-B de la clínica:

1. Si este firmware acepta la captura a distancia o pide registrar en pantalla (la app funciona con ambos).
   **Validado el 14/10/2026 con el DS-K1T321EFWX-B V3.9.50:** acepta la captura, pero rechaza con `badXmlContent`
   la orden sin encabezado `<?xml …?>`; el agente ahora prueba los formatos en orden. El guardado de la huella
   (`FingerPrint/SetUp`) responde "en proceso" y confirma en una consulta posterior; el agente espera la
   confirmación. Un `invalidOperation` inmediato es "lector ocupado" (reintento rápido tras una captura fallida).
   La misma huella no se puede registrar a dos personas: el lector la rechaza. **Rostro: validado el 15/10/2026**
   (captura a distancia y guardado correctos).
2. El formato exacto del envío por HTTP Listening (multipart con `event_log`, JSON directo o XML): el intérprete
   acepta los tres, pero conviene capturar una lectura real y guardarla en `tests/fixtures/hik/`.
3. Los subtipos de evento de verificación correcta (38 huella, 75 rostro, 1 tarjeta) y el campo `employeeNoString`.
4. `PUT /ISAPI/Event/notification/httpHosts/1` para configurar el webhook desde la app.
5. La zona horaria que reporta el lector en `AcsEvent` (la app asume hora de México cuando no trae zona).
6. Que el certificado HTTPS del lector sea autofirmado (el agente lo acepta solo para la IP del lector).
