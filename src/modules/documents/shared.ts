/**
 * Recetas médicas e indicaciones fisioterapéuticas: tipos y textos compartidos por servidor y navegador.
 * REC-01: son DOS documentos distintos. La receta médica solo lleva medicamentos y solo la emite un
 * médico con cédula (art. 28 Bis LGS); las indicaciones nunca llevan medicamentos.
 */
export type DocKind = 'prescription' | 'indications';
export type ItemKind = 'medication' | 'exercise' | 'physical_agent' | 'home_care';

export type DocumentItem = {
  id: string;
  position: number;
  kind: ItemKind;
  name: string;
  presentation: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
};

export type DocumentDetail = {
  id: string;
  kind: DocKind;
  folio_number: number;
  folio: string;
  location_id: string;
  patient_id: string;
  issuer_id: string;
  issuer_name: string;
  issuer_title: string;
  issuer_specialty: string;
  issuer_license: string | null;
  issuer_institution: string | null;
  issuer_specialty_license: string | null;
  clinic_name: string;
  location_name: string;
  location_address: string;
  location_phone: string;
  patient_name: string;
  patient_age: number;
  patient_sex: string | null;
  diagnosis: string;
  general_indications: string;
  footer: string;
  status: 'issued' | 'cancelled';
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  duplicated_from: string | null;
  issued_at: string;
  content_hash: string;
  items: DocumentItem[];
  can_cancel: boolean;
};

export type DocumentListItem = {
  id: string;
  kind: DocKind;
  folio: string;
  patient_id: string;
  patient_name: string;
  issuer_id: string;
  issuer_name: string;
  issuer_title: string;
  issued_at: string;
  status: 'issued' | 'cancelled';
  summary: string;
};
export type DocumentList = { items: DocumentListItem[]; total: number };

export const DOC_TITLE: Record<DocKind, string> = {
  prescription: 'Receta médica',
  indications: 'Indicaciones fisioterapéuticas',
};
export const DOC_SHORT: Record<DocKind, string> = { prescription: 'Receta médica', indications: 'Indicaciones' };
export const CLINIC_LINE = 'Fisioterapia y readaptación deportiva';

export const ITEM_LABEL: Record<ItemKind, string> = {
  medication: 'Medicamento',
  exercise: 'Ejercicio',
  physical_agent: 'Agente físico',
  home_care: 'Cuidado en casa',
};
/** Grupos de las indicaciones, en el orden en que se imprimen (REC-08). */
export const INDICATION_GROUPS: { kind: ItemKind; title: string }[] = [
  { kind: 'exercise', title: 'Ejercicios' },
  { kind: 'physical_agent', title: 'Agentes físicos' },
  { kind: 'home_care', title: 'Cuidados en casa' },
];

export const ROUTES = ['Oral', 'Tópica', 'Intramuscular', 'Intravenosa', 'Subcutánea', 'Sublingual', 'Rectal', 'Oftálmica', 'Ótica', 'Nasal', 'Inhalada'];

export const SEX_LABEL: Record<string, string> = { F: 'Femenino', M: 'Masculino', X: 'No especificado' };

export const PHYSICIAN_ONLY =
  'Solo un médico con cédula profesional puede emitir recetas de medicamentos (art. 28 Bis de la Ley General de Salud). El dueño habilita esta función en Equipo.';
export const LICENSE_REQUIRED = 'Registra tu cédula profesional en "Mi perfil" antes de emitir documentos.';
export const CONTROLLED_MSG =
  'Este medicamento es controlado y requiere recetario especial con código de barras; no puede emitirse desde el sistema.';

/** Igual que norm() de la base: minúsculas y sin acentos. */
export const normText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Nombre con título para firma y listas: 'L.F.T. Karla Ocampo'. */
export const withTitle = (title: string | null | undefined, name: string) => [title?.trim(), name].filter(Boolean).join(' ');

/** Renglón de receta en una línea: '500 mg · Oral · Cada 12 h · 7 días'. */
export const itemLine = (i: Pick<DocumentItem, 'dose' | 'route' | 'frequency' | 'duration'>) =>
  [i.dose, i.route, i.frequency, i.duration].map((x) => x?.trim()).filter(Boolean).join(' · ');

/** Huella corta para mostrar: 'A1B2 C3D4 E5F6'. */
export const shortHash = (h: string) => (h ? h.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1 ') : '');

/** Líneas bajo la firma (REC-08): especialidad, cédula, institución y cédula de especialidad. */
export function signatureLines(d: Pick<DocumentDetail, 'issuer_specialty' | 'issuer_license' | 'issuer_institution' | 'issuer_specialty_license'>): string[] {
  return [
    d.issuer_specialty?.trim() || '',
    d.issuer_license ? `Cédula profesional ${d.issuer_license}` : '',
    d.issuer_institution?.trim() || '',
    d.issuer_specialty_license ? `Cédula de especialidad ${d.issuer_specialty_license}` : '',
  ].filter(Boolean);
}
