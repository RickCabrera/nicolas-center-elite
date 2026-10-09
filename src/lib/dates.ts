/**
 * Fechas y horas de la clínica (INF-07). Todo se muestra en America/Mexico_City y en formato es-MX.
 * Reglas:
 *   · Una FECHA sin hora viaja como texto 'AAAA-MM-DD' (nunca como Date).
 *   · Un INSTANTE viaja como ISO 8601 con zona (timestamptz).
 * Estas funciones sirven igual en servidor y navegador.
 */
export const TZ = 'America/Mexico_City';

const parts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute'), ss: get('second'), wd: get('weekday') };
};

/** Fecha local de la clínica de un instante → 'AAAA-MM-DD'. */
export function isoDate(d: Date | string = new Date()): string {
  const p = parts(typeof d === 'string' ? new Date(d) : d);
  return `${p.y}-${p.m}-${p.d}`;
}
export const todayIso = () => isoDate(new Date());

/** Hora local 'HH:MM' de un instante. */
export function fmtTime(d: Date | string): string {
  const p = parts(typeof d === 'string' ? new Date(d) : d);
  return `${p.hh}:${p.mm}`;
}

/** 'AAAA-MM-DD' o instante → 'DD/MM/AAAA'. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const iso = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : isoDate(d as Date | string);
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y}`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

/** Desfase de la zona de la clínica respecto a UTC, en minutos, para una fecha dada. */
function tzOffsetMinutes(at: Date): number {
  const p = parts(at);
  const asUtc = Date.UTC(+p.y, +p.m - 1, +p.d, +p.hh, +p.mm, +p.ss);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Fecha 'AAAA-MM-DD' + hora 'HH:MM' locales de la clínica → instante. */
export function localToInstant(date: string, time = '00:00'): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
}

/** Suma días a una fecha 'AAAA-MM-DD'. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Día de la semana (0 = domingo) de una fecha 'AAAA-MM-DD'. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WD_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'Hoy · 18 ago' / 'Mié · 19 ago' (como la tira de días del mockup). */
export function dayLabel(date: string, today = todayIso()): string {
  const [, m, d] = date.split('-').map(Number);
  return `${date === today ? 'Hoy' : WD[weekday(date)]} · ${d} ${MES[m - 1]}`;
}

/** 'Martes 18 de agosto' */
export function longDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WD_LONG[weekday(date)]} ${d} de ${MES_LONG[m - 1]}`;
}

export const monthName = (m: number) => MES_LONG[m - 1];
export const weekdayShort = (n: number) => WD[n];
export const weekdayLong = (n: number) => WD_LONG[n];

/** Edad en años cumplidos a partir de 'AAAA-MM-DD' (PAC-03: la edad nunca se captura). */
export function ageFrom(birth: string, today = todayIso()): number {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

/** Acepta 'DD/MM/AAAA' o 'AAAA-MM-DD' y devuelve 'AAAA-MM-DD', o null si no es una fecha real. */
export function parseDateInput(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let mt = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mt) [d, m, y] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
