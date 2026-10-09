'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Empty, Field, Notice, Select, Sheet, Skeleton, useToast } from '@/components/ui';
import { usePatientOptions, useMeta } from '@/components/meta';
import { api, ApiError, refresh } from '@/lib/client';
import { waitForCommand } from './use-command';

type DevicePerson = {
  employee_no: string; name: string; fingerprints: number; faces?: number; cards?: number;
  linked: { type: 'patient' | 'staff'; id: string; name: string; active: boolean } | null;
};

/**
 * Personas que ya existen en el lector (por ejemplo, dadas de alta antes de instalar el sistema).
 * Las que no corresponden a nadie se pueden vincular con un paciente o alguien del equipo para que sus
 * lecturas cuenten como asistencia sin volver a registrar la huella.
 */
export function DevicePersonsSheet({ device, onClose }: { device: { id: string; name: string } | null; onClose: () => void }) {
  const toast = useToast();
  const { meta } = useMeta();
  const patients = usePatientOptions();
  const [persons, setPersons] = useState<DevicePerson[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<DevicePerson | null>(null);
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = async () => {
    if (!device) return;
    setLoading(true); setError(''); setPersons(null);
    try {
      const r = await api.post<{ command_id: string; bridge_online: boolean }>(`/api/devices/${device.id}/persons`);
      if (!r.bridge_online) setError('El agente puente no está conectado: la lista llegará cuando vuelva.');
      const res = await waitForCommand(r.command_id, { timeoutMs: 45000, isAborted: () => !alive.current });
      if (!alive.current) return;
      if (res.outcome !== 'done') {
        setError(res.outcome === 'error' ? res.message : 'El lector no respondió a tiempo. Intenta de nuevo.');
        return;
      }
      const list = await api.get<{ persons: DevicePerson[] }>(`/api/devices/${device.id}/persons?command_id=${r.command_id}`);
      setPersons(list.persons);
      setError('');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (device) void load(); else setPersons(null); }, [device?.id]);

  const link = async () => {
    if (!device || !linking || !target) return;
    const [type, id] = target.split(':') as ['patient' | 'staff', string];
    setSaving(true);
    try {
      const r = await api.post<{ reassigned_events: number }>(`/api/devices/${device.id}/link`, {
        employee_no: linking.employee_no, person_type: type, person_id: id, has_fingerprint: linking.fingerprints > 0,
      });
      toast(r.reassigned_events ? `Vinculado · ${r.reassigned_events} lectura(s) anteriores reasignadas` : 'Vinculado');
      setLinking(null); setTarget('');
      void refresh('/api/attendance', '/api/patients', '/api/users');
      await load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const staff = (meta?.therapists ?? []).filter((t) => t.active);
  return (
    <>
      <Sheet open={!!device} onClose={onClose} wide title={`Personas en el lector · ${device?.name ?? ''}`}>
        <div className="stack md">
          <div className="t-sub">Quienes ya están dados de alta en el lector. Si alguien no corresponde a nadie del sistema, vincúlalo y sus lecturas contarán como su asistencia sin volver a registrar la huella.</div>
          {error && <Notice tone="gold">{error}</Notice>}
          {loading && !persons && <Skeleton rows={4} />}
          {persons && persons.length === 0 && <Empty>El lector no tiene personas dadas de alta.</Empty>}
          {persons && persons.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Número</th><th>Nombre en el lector</th><th className="num">Huellas</th><th>En el sistema</th><th /></tr></thead>
                <tbody>
                  {persons.map((p) => (
                    <tr key={p.employee_no}>
                      <td className="t-mono">{p.employee_no}</td>
                      <td>{p.name || '—'}</td>
                      <td className="num">{p.fingerprints}</td>
                      <td>{p.linked ? <>{p.linked.name} <Badge tone={p.linked.type === 'staff' ? 'gold' : 'blue'}>{p.linked.type === 'staff' ? 'Equipo' : 'Paciente'}</Badge></> : <Badge>Sin vincular</Badge>}</td>
                      <td style={{ textAlign: 'right' }}>{!p.linked && <Button size="sm" onClick={() => { setLinking(p); setTarget(''); }}>Vincular</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="hstack"><Button size="sm" loading={loading} onClick={load}>Volver a leer el lector</Button></div>
        </div>
      </Sheet>
      <Sheet open={!!linking} onClose={() => setLinking(null)} title={`Vincular ${linking?.employee_no ?? ''}${linking?.name ? ' · ' + linking.name : ''}`}
        footer={<><Button onClick={() => setLinking(null)}>Cancelar</Button><Button variant="primary" loading={saving} disabled={!target} onClick={link}>Vincular</Button></>}>
        <div className="stack md">
          <Field label="¿Quién es en el sistema?">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Selecciona</option>
              <optgroup label="Equipo">{staff.map((t) => <option key={t.id} value={`staff:${t.id}`}>{t.display_name}</option>)}</optgroup>
              <optgroup label="Pacientes">{(patients.data ?? []).map((p) => <option key={p.id} value={`patient:${p.id}`}>{p.full_name}</option>)}</optgroup>
            </Select>
          </Field>
          <div className="t-small">{linking && linking.fingerprints > 0 ? 'Ya tiene huella registrada en el lector: quedará marcada como registrada.' : 'No tiene huella en el lector: después regístrala desde su ficha.'} Sus lecturas anteriores que llegaron como “no reconocido” se asignarán a esta persona.</div>
        </div>
      </Sheet>
    </>
  );
}
