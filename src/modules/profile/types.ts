/** CFG-08 · Respuesta de GET /api/profile. */
export type Profile = {
  id: string; username: string; email: string; role: 'owner' | 'therapist' | 'reception'; full_name: string; title: string; display_name: string;
  specialty: string; phone: string; location_id: string | null; location_name: string | null;
  license_number: string | null; license_institution: string | null; specialty_license: string | null;
  is_physician: boolean; fingerprint_enrolled_at: string | null; last_login_at: string | null; created_at: string;
};
export type Passkey = { id: string; name: string; created_at: string; last_used_at: string | null };
export type SessionRow = { id: string; created_at: string; last_seen_at: string; method: string; device: string; current: boolean };
