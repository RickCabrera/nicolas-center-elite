-- 0006 · Datos base de la clínica (idempotente). No incluye pacientes ni usuarios.
insert into clinic (id, name, legal_name, tagline, phone, settings, privacy_notice, privacy_notice_short,
                    consent_template, biometric_consent, rx_footer)
values (true, 'Nicolas Center Elite', 'Nicolas Center Elite', 'Fisioterapia y readaptación deportiva', '',
  jsonb_build_object(
    'due_soon_days', 7,
    'attendance_tolerance_min', 90,
    'idle_minutes', 30,
    'staff_alternate_in_out', true,
    'patient_alternate_in_out', false,
    'package_consume_on_attendance', true),
$t$AVISO DE PRIVACIDAD INTEGRAL

{{clinica}}, con domicilio en {{domicilio}}, es responsable del tratamiento de sus datos personales.

Datos que recabamos: datos de identificación y contacto (nombre, fecha de nacimiento, sexo, CURP, domicilio, teléfono, correo, contacto de emergencia y, en menores de edad, datos del padre, madre o tutor); datos personales sensibles de salud (motivo de consulta, antecedentes, diagnóstico, plan de tratamiento, notas de evolución, estudios de imagen y laboratorio); y, si usted lo autoriza por separado, un identificador asociado a su huella dactilar para registrar su asistencia.

Finalidades primarias: integrar y conservar su expediente clínico conforme a la NOM-004-SSA3-2012; prestarle servicios de fisioterapia y readaptación; agendar y dar seguimiento a sus citas; administrar su membresía y pagos; y registrar su asistencia.

No usamos sus datos para finalidades secundarias de mercadotecnia ni los transferimos a terceros, salvo las excepciones previstas en la ley o por requerimiento de autoridad competente.

Su expediente se conserva por un mínimo de 5 años contados a partir del último acto, como lo exige la norma.

Usted puede ejercer sus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO), así como revocar su consentimiento, presentando una solicitud en recepción o en la sección "Privacidad" de este sistema. Responderemos en un plazo máximo de 20 días hábiles.

Cualquier cambio a este aviso se publicará en recepción y en este sistema.$t$,
$t${{clinica}} es responsable de sus datos personales, incluidos datos de salud, que usamos para integrar su expediente clínico, atenderle, agendar sus citas y administrar su membresía. Puede consultar el aviso integral y ejercer sus derechos ARCO en recepción.$t$,
$t$CARTA DE CONSENTIMIENTO INFORMADO PARA TRATAMIENTO DE FISIOTERAPIA

Yo, {{firmante}}, en mi carácter de {{parentesco}} de {{paciente}}, declaro que se me explicó en lenguaje claro el diagnóstico fisioterapéutico, el plan de tratamiento propuesto, sus objetivos, beneficios esperados y riesgos posibles (dolor muscular posterior al ejercicio, fatiga, irritación de la piel por agentes físicos o, de forma poco frecuente, agravamiento temporal de los síntomas), así como las alternativas existentes.

Entiendo que puedo hacer preguntas en cualquier momento, que mi participación es voluntaria y que puedo suspender el tratamiento cuando lo decida, informando a mi fisioterapeuta.

Me comprometo a informar cualquier cambio en mi estado de salud, medicamentos o molestias durante el tratamiento.

Autorizo al personal de {{clinica}} a realizar las valoraciones y procedimientos de fisioterapia indicados.$t$,
$t$CONSENTIMIENTO PARA EL USO DE HUELLA DACTILAR

Yo, {{firmante}}, en mi carácter de {{parentesco}} de {{paciente}}, autorizo de forma expresa a {{clinica}} a registrar mi huella dactilar en el lector biométrico de recepción con la única finalidad de registrar mi asistencia.

Se me informó que la huella se almacena únicamente dentro del lector como una plantilla matemática, que el sistema de la clínica no guarda ni puede reconstruir la imagen de mi huella, y que puedo solicitar su eliminación en cualquier momento, en cuyo caso mi asistencia se registrará de forma manual.$t$,
'Este documento no sustituye la valoración médica. Ante cualquier reacción adversa suspenda el tratamiento y comuníquese con la clínica.')
on conflict (id) do nothing;

insert into locations (code, name, city, state) values
  ('COR', 'Córdoba', 'Córdoba', 'Veracruz'),
  ('ORI', 'Orizaba', 'Orizaba', 'Veracruz')
on conflict (code) do nothing;

insert into membership_plans (name, kind, price_cents, period_days, sessions_count, position) values
  ('Mensual Elite',       'monthly', 240000, 30, null, 1),
  ('Mensual Básica',      'monthly', 150000, 30, null, 2),
  ('Paquete 10 sesiones', 'package', 320000, 60, 10,   3),
  ('Sesión individual',   'single',   45000,  1, 1,    4),
  ('Plan Senior',         'monthly', 120000, 30, null, 5)
on conflict (name) do nothing;

insert into session_types (name, default_duration_min, position) values
  ('Fisioterapia', 50, 1),
  ('Readaptación deportiva', 50, 2),
  ('Ejercicio personalizado', 50, 3),
  ('Valoración inicial', 60, 4)
on conflict (name) do nothing;

insert into study_types (name, position) values
  ('Radiografía', 1), ('Resonancia', 2), ('Ultrasonido', 3), ('Tomografía', 4),
  ('Laboratorio', 5), ('Documento', 6), ('Otro', 7)
on conflict (name) do nothing;

insert into patient_tags (name, position) values
  ('Deportista', 1), ('Post-quirúrgico', 2), ('Neurológico', 3), ('Dolor crónico', 4)
on conflict (name) do nothing;

-- Sustancias de las fracciones I a III del art. 226 LGS más comunes en consulta. La lista es una
-- ayuda, no es exhaustiva: la responsabilidad de la prescripción es del médico.
insert into controlled_substances (name) values
  ('morfina'), ('oxicodona'), ('fentanilo'), ('hidromorfona'), ('metadona'), ('buprenorfina'), ('tapentadol'),
  ('tramadol'), ('codeina'), ('dextropropoxifeno'), ('nalbufina'), ('ketamina'), ('metilfenidato'),
  ('diazepam'), ('clonazepam'), ('alprazolam'), ('lorazepam'), ('bromazepam'), ('midazolam'), ('triazolam'),
  ('zolpidem'), ('fenobarbital'), ('pentobarbital'), ('clobenzorex'), ('fentermina'), ('anfepramona'),
  ('mazindol'), ('lisdexanfetamina'), ('pregabalina')
on conflict (name) do nothing;
