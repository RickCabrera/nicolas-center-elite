/**
 * HUE-12 · Cálculo PURO de horas trabajadas a partir de las lecturas de un día.
 *
 * Regla: las horas son la suma de los pares entrada → salida. Una entrada que se queda sin salida
 * marca el día como "incompleto" y esa entrada NO suma (los pares cerrados del mismo día sí cuentan).
 * Una salida sin entrada previa se ignora y también marca el día como incompleto.
 */
import { addDays, fmtTime, isoDate, weekday } from '@/lib/dates';

export type Reading = { occurred_at: Date | string; direction: 'in' | 'out' };

export type DayHours = {
  first_in: string | null;   // 'HH:MM' local
  last_out: string | null;   // 'HH:MM' local
  minutes: number;
  pairs: number;
  incomplete: boolean;
};

export function dayHours(readings: Reading[]): DayHours {
  const list = readings
    .map((r) => ({ at: typeof r.occurred_at === 'string' ? new Date(r.occurred_at) : r.occurred_at, direction: r.direction }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  let open: Date | null = null;
  let minutes = 0, pairs = 0, incomplete = false;
  let firstIn: Date | null = null, lastOut: Date | null = null;
  for (const r of list) {
    if (r.direction === 'in') {
      if (open) incomplete = true; // dos entradas seguidas: la anterior quedó sin salida
      open = r.at;
      firstIn ??= r.at;
    } else {
      if (!open) { incomplete = true; continue; }
      minutes += Math.max(0, Math.round((r.at.getTime() - open.getTime()) / 60000));
      pairs++;
      lastOut = r.at;
      open = null;
    }
  }
  if (open) incomplete = true;
  return {
    first_in: firstIn ? fmtTime(firstIn) : null,
    last_out: lastOut ? fmtTime(lastOut) : null,
    minutes, pairs, incomplete,
  };
}

/** Lunes de la semana de una fecha 'AAAA-MM-DD'. */
export function weekStart(date: string): string {
  const wd = weekday(date); // 0 = domingo
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** 125 → '2:05' */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  return `${h}:${String(min % 60).padStart(2, '0')}`;
}

export type StaffReading = Reading & { user_id: string; person_name: string; location_name: string };
export type StaffDay = DayHours & { date: string };
export type StaffReport = {
  user_id: string;
  person_name: string;
  location_name: string;
  days: StaffDay[];
  weeks: { week_start: string; minutes: number; incomplete_days: number }[];
  total_minutes: number;
  incomplete_days: number;
};

/** Agrupa lecturas del personal por persona → día (hora de la clínica) → semana (lunes a domingo). */
export function buildStaffReport(rows: StaffReading[]): StaffReport[] {
  const byUser = new Map<string, { name: string; loc: string; days: Map<string, Reading[]> }>();
  for (const r of rows) {
    let u = byUser.get(r.user_id);
    if (!u) byUser.set(r.user_id, (u = { name: r.person_name, loc: r.location_name, days: new Map() }));
    const day = isoDate(r.occurred_at);
    const list = u.days.get(day) ?? [];
    list.push(r);
    u.days.set(day, list);
  }
  const out: StaffReport[] = [];
  for (const [user_id, u] of byUser) {
    const days: StaffDay[] = [...u.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, ...dayHours(list) }));
    const weeks = new Map<string, { minutes: number; incomplete_days: number }>();
    for (const d of days) {
      const k = weekStart(d.date);
      const w = weeks.get(k) ?? { minutes: 0, incomplete_days: 0 };
      w.minutes += d.minutes;
      if (d.incomplete) w.incomplete_days++;
      weeks.set(k, w);
    }
    out.push({
      user_id, person_name: u.name, location_name: u.loc, days,
      weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week_start, w]) => ({ week_start, ...w })),
      total_minutes: days.reduce((s, d) => s + d.minutes, 0),
      incomplete_days: days.filter((d) => d.incomplete).length,
    });
  }
  return out.sort((a, b) => a.person_name.localeCompare(b.person_name, 'es'));
}

/** Celda CSV con comillas cuando hace falta; neutraliza fórmulas de hoja de cálculo. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.:]\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(',');
