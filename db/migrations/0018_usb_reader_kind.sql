-- 0018 · Tipo de lector (HUE-20): además del Hikvision en red, un lector USB DigitalPersona U.are.U 4500
-- conectado a la PC de recepción. El agente puente escoge el chofer según este tipo.
-- Los lectores existentes siguen siendo Hikvision: nada cambia para ellos.
--   hikvision          · lector en red con IP, usuario y contraseña (guarda y compara las huellas él mismo)
--   usb_digitalpersona · sensor USB sin memoria: las huellas viven cifradas en la PC de recepción; sin rostro
alter table devices
  add column if not exists kind text not null default 'hikvision'
    check (kind in ('hikvision', 'usb_digitalpersona'));
