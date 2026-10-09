/**
 * CFG-07 · Textos originales de las plantillas legales, idénticos a los de `db/migrations/0006_base_data.sql`.
 * Sirven para "Restaurar texto original" en Configuración → Plantillas.
 * (Una prueba compara este módulo contra la base recién migrada para que no se desfasen.)
 */
export type TemplateKey = 'privacy_notice' | 'privacy_notice_short' | 'consent_template' | 'biometric_consent' | 'rx_footer';

export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  privacy_notice: `AVISO DE PRIVACIDAD INTEGRAL

{{clinica}}, con domicilio en {{domicilio}}, es responsable del tratamiento de sus datos personales.

Datos que recabamos: datos de identificación y contacto (nombre, fecha de nacimiento, sexo, CURP, domicilio, teléfono, correo, contacto de emergencia y, en menores de edad, datos del padre, madre o tutor); datos personales sensibles de salud (motivo de consulta, antecedentes, diagnóstico, plan de tratamiento, notas de evolución, estudios de imagen y laboratorio); y, si usted lo autoriza por separado, un identificador asociado a su huella dactilar para registrar su asistencia.

Finalidades primarias: integrar y conservar su expediente clínico conforme a la NOM-004-SSA3-2012; prestarle servicios de fisioterapia y readaptación; agendar y dar seguimiento a sus citas; administrar su membresía y pagos; y registrar su asistencia.

No usamos sus datos para finalidades secundarias de mercadotecnia ni los transferimos a terceros, salvo las excepciones previstas en la ley o por requerimiento de autoridad competente.

Su expediente se conserva por un mínimo de 5 años contados a partir del último acto, como lo exige la norma.

Usted puede ejercer sus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO), así como revocar su consentimiento, presentando una solicitud en recepción o en la sección "Privacidad" de este sistema. Responderemos en un plazo máximo de 20 días hábiles.

Cualquier cambio a este aviso se publicará en recepción y en este sistema.`,

  privacy_notice_short: `{{clinica}} es responsable de sus datos personales, incluidos datos de salud, que usamos para integrar su expediente clínico, atenderle, agendar sus citas y administrar su membresía. Puede consultar el aviso integral y ejercer sus derechos ARCO en recepción.`,

  consent_template: `CARTA DE CONSENTIMIENTO INFORMADO PARA TRATAMIENTO DE FISIOTERAPIA

Yo, {{firmante}}, en mi carácter de {{parentesco}} de {{paciente}}, declaro que se me explicó en lenguaje claro el diagnóstico fisioterapéutico, el plan de tratamiento propuesto, sus objetivos, beneficios esperados y riesgos posibles (dolor muscular posterior al ejercicio, fatiga, irritación de la piel por agentes físicos o, de forma poco frecuente, agravamiento temporal de los síntomas), así como las alternativas existentes.

Entiendo que puedo hacer preguntas en cualquier momento, que mi participación es voluntaria y que puedo suspender el tratamiento cuando lo decida, informando a mi fisioterapeuta.

Me comprometo a informar cualquier cambio en mi estado de salud, medicamentos o molestias durante el tratamiento.

Autorizo al personal de {{clinica}} a realizar las valoraciones y procedimientos de fisioterapia indicados.`,

  biometric_consent: `CONSENTIMIENTO PARA EL USO DE HUELLA DACTILAR

Yo, {{firmante}}, en mi carácter de {{parentesco}} de {{paciente}}, autorizo de forma expresa a {{clinica}} a registrar mi huella dactilar en el lector biométrico de recepción con la única finalidad de registrar mi asistencia.

Se me informó que la huella se almacena únicamente dentro del lector como una plantilla matemática, que el sistema de la clínica no guarda ni puede reconstruir la imagen de mi huella, y que puedo solicitar su eliminación en cualquier momento, en cuyo caso mi asistencia se registrará de forma manual.`,

  rx_footer: 'Este documento no sustituye la valoración médica. Ante cualquier reacción adversa suspenda el tratamiento y comuníquese con la clínica.',
};
