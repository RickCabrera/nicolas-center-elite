'use client';
import { useApi } from '@/lib/client';
import { Select } from './ui';

export type Meta = {
  clinic: { name: string; legal_name: string | null; tagline: string | null; phone: string | null; email: string | null; settings: Record<string, unknown> };
  locations: { id: string; code: string; name: string; street: string; neighborhood: string; city: string; state: string; zip: string; phone: string; hours: string; active: boolean }[];
  therapists: { id: string; full_name: string; title: string; display_name: string; specialty: string; location_id: string | null; location_name: string | null; is_physician: boolean; role: string; active: boolean }[];
  /** AUTH-10 · Personal de recepción: no recibe pacientes ni citas; solo aparece donde se elige "personal". */
  reception: { id: string; full_name: string; title: string; display_name: string; location_id: string | null; location_name: string | null; active: boolean }[];
  plans: { id: string; name: string; kind: 'monthly' | 'package' | 'single'; price_cents: number; period_days: number; sessions_count: number | null; active: boolean; position: number }[];
  session_types: { id: string; name: string; default_duration_min: number; active: boolean; position: number }[];
  study_types: { name: string; active: boolean; position: number }[];
  tags: { name: string; active: boolean; position: number }[];
  simulator: boolean;
};

/** Catálogos compartidos (sedes, fisioterapeutas, planes, tipos). Se piden una vez y se reutilizan. */
export function useMeta() {
  const r = useApi<Meta>('/api/meta', { revalidateOnFocus: false, dedupingInterval: 30000 });
  return { meta: r.data, error: r.error, reload: r.mutate };
}

export type PatientOption = { id: string; full_name: string; record_number: string; therapist_id: string; location_id: string };
export function usePatientOptions() {
  return useApi<PatientOption[]>('/api/patients/options', { revalidateOnFocus: false });
}

/** Selector de paciente (solo muestra los que el usuario puede ver). */
export function PatientPicker({ value, onChange, invalid, placeholder = 'Selecciona un paciente' }: { value: string; onChange: (id: string) => void; invalid?: boolean; placeholder?: string }) {
  const { data } = usePatientOptions();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{data ? placeholder : 'Cargando…'}</option>
      {data?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
    </Select>
  );
}
