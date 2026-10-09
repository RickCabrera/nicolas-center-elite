import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { enqueueCommand } from '@/modules/attendance/server';

type DevicePerson = { employee_no: string; name: string; fingerprints: number; faces?: number; cards?: number };

/** Pide al agente puente la lista de personas que ya están dadas de alta en el lector. Solo dueño. */
export const POST = route({ auth: 'owner' }, async ({ params, user, system }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound('Lector no encontrado.');
  return system(async (tx) => {
    const [d] = await tx<{ id: string }[]>`select id from devices where id = ${params.id} and active`;
    if (!d) throw notFound('Lector no encontrado.');
    const command_id = await enqueueCommand(tx, { deviceId: d.id, kind: 'list_persons', createdBy: user.id });
    const [b] = await tx<{ online: boolean }[]>`select coalesce(bridge_seen_at > now() - interval '90 seconds', false) as online from devices where id = ${d.id}`;
    return { command_id, bridge_online: b.online };
  });
});

/**
 * Resultado de la lista: cada persona del lector con quién es en el sistema (si su número coincide
 * con un paciente o alguien del equipo). Las que no coinciden se pueden vincular (ver /link).
 */
export const GET = route({ auth: 'owner' }, async ({ params, query, system }) => {
  const commandId = (query as Record<string, string>).command_id ?? '';
  if (!z.uuid().safeParse(commandId).success) throw badRequest('Falta la orden.');
  return system(async (tx) => {
    const [c] = await tx<{ status: string; result: { persons?: DevicePerson[] } | null; error: string | null }[]>`
      select status, result, error from device_commands where id = ${commandId} and device_id = ${params.id} and kind = 'list_persons'`;
    if (!c) throw notFound('Orden no encontrada.');
    if (c.status !== 'done') return { status: c.status, persons: null };
    const persons = Array.isArray(c.result?.persons) ? c.result!.persons! : [];
    const nos = persons.map((p) => p.employee_no);
    const pats = await tx<{ id: string; full_name: string; hik_employee_no: string; status: string }[]>`
      select id, full_name, hik_employee_no, status from patients where hik_employee_no = any(${nos}::text[])`;
    const users = await tx<{ id: string; name: string; hik_employee_no: string; active: boolean }[]>`
      select id, trim(title || ' ' || full_name) as name, hik_employee_no, active from users where hik_employee_no = any(${nos}::text[])`;
    return {
      status: 'done',
      persons: persons.map((p) => {
        const pt = pats.find((x) => x.hik_employee_no === p.employee_no);
        const us = users.find((x) => x.hik_employee_no === p.employee_no);
        const linked = pt ? { type: 'patient' as const, id: pt.id, name: pt.full_name, active: pt.status === 'active' }
          : us ? { type: 'staff' as const, id: us.id, name: us.name, active: us.active } : null;
        return { ...p, linked };
      }),
    };
  });
});
