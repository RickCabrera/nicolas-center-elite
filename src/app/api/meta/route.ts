import { route } from '@/lib/api';
import { simulatorEnabled } from '@/lib/env';

/**
 * Catálogos que casi toda pantalla necesita para sus selectores. Una sola lectura, cacheada por SWR.
 * Usa el hook `useMeta()` de '@/components/meta'.
 */
export const GET = route({ auth: 'user' }, async ({ db }) => {
  const [clinic] = await db`select name, legal_name, tagline, phone, email, settings from clinic`;
  const locations = await db`select id, code, name, street, neighborhood, city, state, zip, phone, hours, active from locations order by name`;
  const therapists = await db`
    select u.id, u.full_name, u.title, trim(u.title || ' ' || u.full_name) as display_name, u.specialty, u.location_id,
           l.name as location_name, u.is_physician, u.role, u.active
    from users u left join locations l on l.id = u.location_id
    where u.role = 'therapist' order by u.active desc, u.full_name`;
  // AUTH-10 · Personal de recepción (para el registro manual de asistencia del personal; no recibe pacientes ni citas).
  const reception = await db`
    select u.id, u.full_name, u.title, trim(u.title || ' ' || u.full_name) as display_name, u.location_id,
           l.name as location_name, u.active
    from users u left join locations l on l.id = u.location_id
    where u.role = 'reception' order by u.active desc, u.full_name`;
  const plans = await db`select id, name, kind, price_cents, period_days, sessions_count, active, position from membership_plans order by position, name`;
  const session_types = await db`select id, name, default_duration_min, active, position from session_types order by position, name`;
  const study_types = await db`select name, active, position from study_types order by position, name`;
  const tags = await db`select name, active, position from patient_tags order by position, name`;
  return { clinic, locations, therapists, reception, plans, session_types, study_types, tags, simulator: simulatorEnabled() };
});
