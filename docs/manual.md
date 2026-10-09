<!-- DEP-04 · Manual de operación. -->
# Manual de uso

Para el dueño y los fisioterapeutas de Nicolas Center Elite. La app funciona igual en celular y computadora;
en el celular se puede instalar como app desde el navegador ("Agregar a pantalla de inicio").

## Entrar

- Usuario (o correo) y contraseña. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.
- **Acceder con huella**: usa la huella o el rostro de tu propio celular o computadora. Se activa una vez en
  **Mi perfil → Acceso con huella de este dispositivo**. (El lector de recepción no sirve para entrar a la app:
  es solo para asistencia.)
- ¿Olvidaste la contraseña? "¿Olvidaste tu contraseña?" en la pantalla de entrada envía un enlace por correo.
- La sesión se cierra sola tras 30 minutos sin uso (el dueño lo cambia en Configuración → Parámetros).

## Fisioterapeuta

**Inicio** muestra tus pacientes activos, tus citas de hoy, las mensualidades por vencer de tus pacientes y
las asistencias de tu sede.

**Dar de alta un paciente** (Pacientes → + Nuevo paciente): nombre, fecha de nacimiento (la edad se calcula
sola), sexo, teléfono, contacto de emergencia, sede, plan y motivo. Si es menor de edad, pide los datos del
tutor. Al guardar se abre su expediente con la tarjeta **Completa el alta**:

1. Aviso de privacidad: el paciente (o su tutor) lo lee y firma con el dedo en la pantalla.
2. Consentimiento informado: igual.
3. Consentimiento de huella: igual. Sin este no se puede registrar la huella.
4. Registrar huella: pulsa el botón y pide al paciente poner el dedo en el lector de recepción.

**Expediente**: pestañas Perfil clínico, Sesiones, Estudios, Recetas y Membresía.
- *Perfil clínico*: valoración, diagnóstico y plan. Cada edición guarda una versión; "Historial de versiones"
  muestra las anteriores.
- *Ejercicios*: "Editar ejercicios" para agregar, cambiar, ordenar o quitar.
- *Agregar nota*: escribe la evolución, el dolor (0 a 10) y el rango de movimiento si aplica. Al guardar la nota
  queda **firmada y ya no se puede editar**. Para corregir, usa "Agregar adenda" sobre la nota.
- *Subir estudio*: radiografía, resonancia (.dcm), PDF o foto con la cámara. Se abre dentro de la app.
- *Resumen PDF* (botón Más): resumen clínico completo para entregar al paciente.

**Indicaciones** (Nueva receta): los fisioterapeutas emiten **Indicaciones fisioterapéuticas**: ejercicios
(se pueden tomar del plan del paciente), agentes físicos y cuidados en casa. "Receta médica" solo aparece
habilitada para quien el dueño haya marcado como médico con cédula: la ley no permite a un fisioterapeuta
recetar medicamentos. Un documento emitido no se modifica: se cancela con motivo y se emite otro
("Duplicar" ayuda). Antes de emitir, registra tu cédula en **Mi perfil**.

**Agenda**: tira de días, vista semanal y selector de fecha. "+ Nueva cita" valida que no se empalme con otra
tuya o del paciente y que esté dentro de tu horario. Al tocar una cita: reprogramar, cancelar con motivo, marcar
asistió / no asistió, abrir el expediente o escribir la nota de esa sesión. Si el paciente pone el dedo en el
lector cerca de su hora, la cita se marca sola como "Asistió". **Mi horario** define tus horas y bloqueos.

**Control de huella**: asistencias de hoy de tu sede, en vivo. "Registro manual" (con motivo) cuando el lector
falle. Una fila roja "MEMBRESÍA VENCIDA" es un aviso para recepción; no bloquea la entrada.

## Dueño

Todo lo anterior, para todos los pacientes y ambas sedes, más:

- **Pacientes**: filtro por fisioterapeuta, reasignar, dar de baja (con motivo; el expediente se conserva y la
  huella se elimina del lector) y reactivar. **Importar CSV** para cargar pacientes existentes (descarga la
  plantilla, revisa la vista previa y confirma).
- **Mensualidades**: estado de pago calculado solo (pagado, por vencer, vencido). "Registrar pago" recorre la
  fecha o carga las sesiones del paquete y genera recibo PDF (no fiscal). En el expediente → Membresía: cambiar
  plan, pausar / reanudar y anular un pago (con motivo). Pestaña **Ingresos**: totales por mes, sede, plan y
  método; exportar CSV.
- **Cobrar en línea** (expediente → Membresía): genera un link de pago con tarjeta u OXXO por el precio del plan
  (se puede cambiar el monto). "Enviar por WhatsApp" arma el mensaje; también se puede copiar. Cuando el paciente
  paga, el pago se registra solo ("Registró: Pago en línea") y la mensualidad se actualiza. Con OXXO, el paciente
  recibe una ficha y el pago llega cuando OXXO lo confirma (normalmente al día siguiente).
  **Mensualidades → Cobros en línea** muestra los links pendientes, pagados y los que **requieren revisión**
  (el paciente pagó pero su plan cambió o se pausó antes): ahí se elige "Aplicar al plan vigente" o "Reembolsar".
  Al anular un pago cobrado en línea, la app ofrece devolver el dinero por Stripe.
- **Facturar** (expediente → Membresía → historial de pagos): captura una sola vez los datos fiscales del paciente
  tal como vienen en su Constancia de Situación Fiscal (RFC, nombre, régimen, código postal), elige los pagos y
  timbra. La factura llega al correo del paciente y se descarga en PDF y XML. Un pago facturado no se puede anular:
  primero se cancela la factura (**Mensualidades → Facturas → Cancelar**, con el motivo del SAT; las mayores a
  $1,000 pueden requerir que el receptor acepte, la app lo revisa sola cada día).
- **Factura global** (Mensualidades → Facturas): en los 3 días siguientes al cierre de cada mes, timbra los pagos
  que nadie pidió facturar, a PÚBLICO EN GENERAL, uno por forma de pago.
- Al registrar un pago con tarjeta en recepción, elige **Débito** o **Crédito**: es la forma de pago que sale en la factura.
- **Equipo**: carga de trabajo por fisioterapeuta. "Agregar fisioterapeuta" envía la invitación (y muestra el
  enlace para copiarlo si el correo no está configurado). "Editar": datos, cédula, si es médico, horario y
  huella. "Desactivar" pide a quién pasan sus pacientes y citas; sus notas y recetas se conservan con su firma.
- **Control de huella → Reportes**: horas trabajadas del personal por día y semana, y asistencias de pacientes.
- **Configuración**: datos de la clínica y logo; sedes (el domicilio sale en las recetas); membresías y precios;
  cobros y facturación (estado de Stripe y Facturapi, OXXO, vigencia de links, IVA, código postal de expedición);
  lectores (estado, probar conexión, sincronizar hora, recuperar eventos, datos de conexión del agente);
  catálogos (tipos de sesión, tipos de estudio, etiquetas); parámetros; plantillas legales con vista previa;
  auditoría (quién cambió qué y cuándo, con antes y después); datos (exportar el expediente de un paciente en
  ZIP, respaldo general en CSV) y solicitudes de privacidad (ARCO).

## Si algo falla

| Situación | Qué hacer |
| --- | --- |
| El lector aparece "Sin conexión" | Revisar que la PC de recepción esté encendida y con internet; mientras tanto usar Registro manual. Las lecturas hechas en el lector se recuperan solas al volver. |
| "Agente puente desconectado" | En la PC de recepción, reiniciar o ver `bridge\logs\agente.log` (ver `bridge/README.md`). |
| Un fisioterapeuta no recibió su invitación | Equipo → su tarjeta → Editar → reenviar invitación, y copiar el enlace. |
| No aparece "Receta médica" | Solo para médicos con cédula; el dueño lo activa en Equipo → Editar. |
| Se emitió un documento con un error | Cancelarlo con motivo y emitir uno nuevo (Duplicar). |
| El paciente pagó en línea y no aparece | Mensualidades → Cobros en línea → "Consultar a Stripe" en su link. |
| Facturapi rechaza la factura | El mensaje dice el motivo del SAT; casi siempre el nombre, régimen o CP no coinciden con la constancia del paciente. |
| "Cobrar en línea" o "Facturar" dicen que falta conectar | Falta el paso 10 u 11 de `docs/despliegue.md`. |
