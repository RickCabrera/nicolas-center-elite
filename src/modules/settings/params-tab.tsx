'use client';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNote, Input, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, refresh, useApi } from '@/lib/client';
import { SETTING_DEFAULTS, SETTING_RANGES, type ClinicSettings } from './shared';
import type { ClinicData } from './types';

type NumKey = keyof typeof SETTING_RANGES;
type BoolKey = Exclude<keyof ClinicSettings, NumKey>;

const NUMBERS: { key: NumKey; title: string; help: (v: number) => string }[] = [
  { key: 'due_soon_days', title: 'Días de anticipación para marcar una mensualidad como "por vencer"',
    help: (v) => `Un paciente pasa de PAGADO a POR VENCER cuando faltan ${v} ${v === 1 ? 'día' : 'días'} o menos para su fecha de pago. Cambia las insignias y los avisos de cobranza de inmediato.` },
  { key: 'attendance_tolerance_min', title: 'Minutos de tolerancia para ligar una lectura de huella con una cita',
    help: (v) => `Si el paciente pone su huella hasta ${v} minutos antes o después de la hora de su cita, la cita se marca sola como "asistió".` },
  { key: 'idle_minutes', title: 'Minutos de inactividad antes de cerrar la sesión',
    help: (v) => `Si nadie usa la aplicación durante ${v} minutos, pide iniciar sesión otra vez. Un valor corto protege los expedientes en equipos compartidos.` },
];
const SWITCHES: { key: BoolKey; title: string; on: string; off: string }[] = [
  { key: 'staff_alternate_in_out', title: 'El personal alterna entrada y salida',
    on: 'La primera lectura del día de cada persona del equipo es su entrada, la siguiente su salida, y así sucesivamente.',
    off: 'Todas las lecturas del personal se registran como entrada.' },
  { key: 'patient_alternate_in_out', title: 'Los pacientes también registran salida',
    on: 'La segunda lectura del día de un paciente cuenta como salida (no marca cita ni descuenta sesión).',
    off: 'Cada lectura de un paciente cuenta como llegada.' },
  { key: 'package_consume_on_attendance', title: 'Descontar una sesión del paquete por cada día de asistencia',
    on: 'Cuando un paciente con paquete de sesiones registra su asistencia, se le descuenta una sesión (máximo una por día).',
    off: 'Las sesiones de los paquetes no se descuentan solas: se ajustan a mano.' },
];

// CFG-06 · Parámetros de operación. Cambian el comportamiento de inmediato, sin desplegar nada.
export function ParamsTab() {
  const toast = useToast();
  const { data, error, mutate } = useApi<ClinicData>('/api/clinic');
  const [nums, setNums] = useState<Record<NumKey, string> | null>(null);
  const [bools, setBools] = useState<Record<BoolKey, boolean> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = (s: ClinicSettings) => {
    setNums({ due_soon_days: String(s.due_soon_days), attendance_tolerance_min: String(s.attendance_tolerance_min), idle_minutes: String(s.idle_minutes) });
    setBools({ staff_alternate_in_out: s.staff_alternate_in_out, patient_alternate_in_out: s.patient_alternate_in_out, package_consume_on_attendance: s.package_consume_on_attendance });
    setErrors({});
  };
  useEffect(() => {
    if (data && !nums) load(data.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error && !data) return <ErrorNote error={error} retry={() => mutate()} />;
  if (!data || !nums || !bools) return <Skeleton rows={6} height={72} />;

  const saved = data.settings;
  const changed: Partial<Record<keyof ClinicSettings, number | boolean>> = {};
  const problems: Record<string, string> = {};
  for (const { key } of NUMBERS) {
    const { min, max, unit } = SETTING_RANGES[key];
    const raw = nums[key].trim();
    const v = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(v >= min && v <= max)) problems[key] = `Escribe un número entero entre ${min} y ${max} ${unit}.`;
    else if (v !== saved[key]) changed[key] = v;
  }
  for (const { key } of SWITCHES) if (bools[key] !== saved[key]) changed[key] = bools[key];
  const dirty = Object.keys(changed).length > 0 || NUMBERS.some(({ key }) => nums[key].trim() !== String(saved[key]));

  const save = async () => {
    setErrors(problems);
    if (Object.keys(problems).length || !Object.keys(changed).length) return;
    setBusy(true);
    try {
      const r = await api.patch<ClinicData>('/api/clinic', { settings: changed });
      load(r.settings);
      await refresh('/api/clinic', '/api/meta', '/api/patients', '/api/billing', '/api/dashboard');
      toast('Parámetros guardados');
    } catch (e) {
      const ae = e as ApiError;
      const fe: Record<string, string> = {};
      for (const [k, m] of Object.entries(ae.fields ?? {})) fe[k.replace(/^settings\./, '')] = m;
      setErrors(fe);
      toast(ae.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <Card title="Tiempos y avisos" blue>
        <div className="stack sm">
          {NUMBERS.map(({ key, title, help }) => {
            const { min, max, unit } = SETTING_RANGES[key];
            const shown = /^\d+$/.test(nums[key].trim()) ? Number(nums[key]) : saved[key];
            return (
              <div key={key} className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: 12 }}>
                <label htmlFor={`p-${key}`} className="grow" style={{ flexBasis: 240 }}>
                  <span className="t-strong" style={{ display: 'block', lineHeight: 1.3 }}>{title}</span>
                  <span className="t-small" style={{ display: 'block', marginTop: 5, lineHeight: 1.4 }}>{help(shown)}</span>
                  {errors[key] && <span className="t-small red" role="alert" style={{ display: 'block', marginTop: 5 }}>{errors[key]}</span>}
                </label>
                <div style={{ flex: 'none', width: 104 }}>
                  <Input id={`p-${key}`} inputMode="numeric" autoComplete="off" value={nums[key]} invalid={!!errors[key]} aria-describedby={`u-${key}`}
                    style={{ textAlign: 'right', font: '600 15px/1 var(--f-mono)' }}
                    onChange={(e) => { setNums({ ...nums, [key]: e.target.value.replace(/\D/g, '').slice(0, 3) }); setErrors((x) => ({ ...x, [key]: '' })); }} />
                  <div id={`u-${key}`} className="t-label" style={{ marginTop: 5, textAlign: 'right', letterSpacing: '.08em' }}>{unit} · {min} a {max}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Lector de huella y paquetes" blue>
        <div className="stack sm">
          {SWITCHES.map(({ key, title, on, off }) => (
            <label key={key} className="row" style={{ alignItems: 'flex-start', padding: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={bools[key]} onChange={(e) => setBools({ ...bools, [key]: e.target.checked })}
                style={{ width: 20, height: 20, marginTop: 1, flex: 'none', accentColor: 'var(--blue)' }} />
              <span className="grow">
                <span className="t-strong" style={{ display: 'block', lineHeight: 1.3 }}>{title}</span>
                <span className="t-small" style={{ display: 'block', marginTop: 5, lineHeight: 1.4 }}>{bools[key] ? on : off}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <div className="hstack wrap col-span">
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Guardar parámetros</Button>
        <Button disabled={busy || !dirty} onClick={() => load(saved)}>Descartar cambios</Button>
        <Button disabled={busy} onClick={() => load(SETTING_DEFAULTS)}>Valores recomendados</Button>
        {dirty && <span className="t-small gold">Hay cambios sin guardar</span>}
      </div>
    </div>
  );
}
