/** Textos y reglas de consentimientos compartidos por servidor y navegador (EXP-10 / PAC-08). */
export const CONSENT_KINDS = ['privacy', 'informed', 'biometric'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_TITLE: Record<ConsentKind, string> = {
  privacy: 'Aviso de privacidad',
  informed: 'Consentimiento informado',
  biometric: 'Consentimiento de uso de huella',
};

export const RELATIONSHIPS = ['Paciente', 'Madre', 'Padre', 'Tutor'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/**
 * Resuelve quién firma. Cuando firma el propio paciente se redacta "por mi propio derecho, en mi carácter
 * de paciente" en lugar de "en mi carácter de paciente de <sí mismo>". Acepta el texto con {{paciente}}
 * todavía como marcador o ya sustituido. Cualquier marcador sobrante se elimina.
 */
export function resolveSigner(body: string, patientName: string, signerName: string, relationship: string): string {
  let out = body;
  if (relationship === 'Paciente') {
    const name = patientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`en mi carácter de \\{\\{parentesco\\}\\} de (?:\\{\\{paciente\\}\\}|${name})`, 'g'),
      'por mi propio derecho, en mi carácter de paciente');
  }
  return out
    .replaceAll('{{firmante}}', () => signerName)
    .replaceAll('{{parentesco}}', () => relationship.toLowerCase())
    .replaceAll('{{paciente}}', () => patientName)
    .replace(/\{\{[^}]*\}\}/g, '');
}
