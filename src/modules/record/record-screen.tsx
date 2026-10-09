'use client';
// EXP-06 · El expediente incrusta las pestañas Estudios, Recetas y Membresía de sus módulos.
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/shell';
import { Avatar, BillingBadge, Button, ErrorNote, KV, Notice, Sheet, Skeleton, Tabs, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { refresh, useApi } from '@/lib/client';
import { fmtDate } from '@/lib/dates';
import { initials } from '@/lib/format';
import { NewAppointmentSheet } from '@/modules/agenda/new-appointment-sheet';
import { MembershipPanel } from '@/modules/billing/membership-panel';
import { NewDocumentSheet } from '@/modules/documents/new-document-sheet';
import { PatientDocuments } from '@/modules/documents/patient-documents';
import { EditPatientSheet } from '@/modules/patients/edit-patient-sheet';
import { PatientStatusSheet } from '@/modules/patients/status-sheet';
import type { PatientDetail } from '@/modules/patients/types';
import { PatientStudies } from '@/modules/studies/patient-studies';
import { UploadStudySheet } from '@/modules/studies/upload-sheet';
import { AccessTab } from './access-tab';
import { ConsentSheet } from './consent-sheet';
import type { ConsentKind } from './consent-text';
import { OnboardingChecklist, SignedDocuments, latestByKind } from './consents-panel';
import { NoteSheet, type AddendumTarget } from './note-sheet';
import { NotesTab } from './notes-tab';
import { ProfileTab } from './profile-tab';
import { ReassignPatientSheet } from './reassign-patient-sheet';
import type { Consent, ProfileData } from './types';

const TABS = [
  { key: 'perfil', label: 'Perfil clínico' },
  { key: 'sesiones', label: 'Sesiones' },
  { key: 'estudios', label: 'Estudios' },
  { key: 'recetas', label: 'Recetas' },
  { key: 'membresia', label: 'Membresía' },
  { key: 'accesos', label: 'Accesos' },
] as const;
// AUTH-10 · Recepción no ve nada clínico: solo la membresía y los documentos firmados del alta.
const RECEPTION_TABS = [
  { key: 'membresia', label: 'Membresía' },
  { key: 'firmas', label: 'Documentos firmados' },
] as const;
type TabKey = (typeof TABS)[number]['key'] | 'firmas';
type Open = null | 'rx' | 'study' | 'appointment' | 'edit' | 'status' | 'reassign' | 'more';

function membershipText(p: PatientDetail): { main: string; detail: string } {
  if (!p.plan_name) return { main: 'Sin plan', detail: '' };
  if (p.plan_kind === 'package') {
    const n = p.sessions_remaining ?? 0;
    return { main: p.plan_name, detail: `${n} ${n === 1 ? 'sesión restante' : 'sesiones restantes'}` };
  }
  return { main: p.plan_name, detail: p.next_due_date ? `Vence ${fmtDate(p.next_due_date)}` : '' };
}
const join = (...parts: (string | null | undefined)[]) => parts.map((s) => s?.trim()).filter(Boolean).join(' · ');

/** EXP-01 · Pantalla del expediente: encabezado, checklist de alta, pestañas y hojas de acción. */
export function RecordScreen({ patientId }: { patientId: string }) {
  const user = useUser();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/api/patients/${patientId}`;

  const patient = useApi<PatientDetail>(base);
  // El perfil se pide siempre, en cualquier pestaña: su lectura es la que registra el acceso al expediente.
  // Recepción no lo pide: la API le respondería 403.
  const clinical = user.isClinical;
  const profile = useApi<ProfileData>(patient.data && clinical ? `${base}/profile` : null);
  const consents = useApi<Consent[]>(patient.data ? `${base}/consents` : null);

  const tabs: readonly { key: TabKey; label: string }[] = clinical ? TABS.filter((t) => t.key !== 'accesos' || user.isOwner) : RECEPTION_TABS;
  const firstTab: TabKey = clinical ? 'perfil' : 'membresia';
  const wanted = search.get('tab');
  const tab: TabKey = tabs.find((t) => t.key === wanted)?.key ?? firstTab;
  const setTab = (k: TabKey) => {
    const q = new URLSearchParams(search.toString());
    if (k === firstTab) q.delete('tab'); else q.set('tab', k);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const [open, setOpen] = useState<Open>(null);
  const [note, setNote] = useState<{ open: boolean; addendumOf: AddendumTarget | null }>({ open: false, addendumOf: null });
  const [consentKind, setConsentKind] = useState<ConsentKind | null>(null);
  const close = () => setOpen(null);

  // Llegada desde el alta (?alta=1): aviso y foco en el checklist.
  const isNew = search.get('alta') === '1';
  const checklist = useRef<HTMLElement>(null);
  const greeted = useRef(false);
  const loaded = !!patient.data;
  useEffect(() => {
    if (!isNew || !loaded || greeted.current) return;
    greeted.current = true;
    toast('Paciente registrado');
    const t = setTimeout(() => {
      checklist.current?.focus({ preventScroll: true });
      checklist.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 150);
    return () => clearTimeout(t);
  }, [isNew, loaded, toast]);

  const p = patient.data;
  const title = clinical ? 'Expediente clínico' : 'Ficha del paciente';
  if (!p) {
    return (
      <div className="page">
        <PageHeader title={title} back={{ href: '/pacientes', label: 'Pacientes' }} />
        {patient.error
          ? patient.error.status === 404
            ? <Notice tone="red">No encontramos este expediente o no está asignado a ti. <Link href="/pacientes">Volver a pacientes</Link></Notice>
            : <ErrorNote error={patient.error} retry={() => patient.mutate()} />
          : <Skeleton rows={3} height={120} />}
      </div>
    );
  }

  const inactive = p.status === 'inactive';
  const signed = latestByKind(consents.data);
  const pending = !!consents.data && (!signed.privacy || !signed.informed || !signed.biometric || !p.fingerprint_enrolled_at);
  const showChecklist = !inactive && (isNew || pending);
  const memb = membershipText(p);
  const reloadPatient = () => refresh(base);
  const more = (which: Open) => () => setOpen(which);

  return (
    <div className="page">
      <PageHeader title={title} sub={p.full_name} back={{ href: '/pacientes', label: 'Pacientes' }} />

      {inactive && (
        <Notice tone="red">
          Paciente dado de baja{p.deactivated_at ? ` el ${fmtDate(p.deactivated_at)}` : ''}{p.deactivation_reason ? `. Motivo: ${p.deactivation_reason}` : ''}.
          {' '}El expediente se conserva y puede consultarse{user.isOwner ? '; puedes reactivarlo desde "Más".' : '.'}
        </Notice>
      )}

      <section className="card lg">
        <div className="hstack wrap" style={{ gap: 14 }}>
          <Avatar text={initials(p.full_name)} lg />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="t-h2" style={{ overflowWrap: 'anywhere' }}>{p.full_name}</h2>
            <div className="t-sub" style={{ marginTop: 4, color: 'var(--ink-4)' }}>
              {p.age} {p.age === 1 ? 'año' : 'años'} · {fmtDate(p.birth_date)} · {p.location_name} · <span className="t-mono" style={{ fontSize: 12 }}>{p.record_number}</span>
            </div>
          </div>
          {inactive ? <span className="badge red">Baja</span> : <BillingBadge state={p.billing_state} />}
        </div>

        <div className="grid-kv" style={{ marginTop: 16 }}>
          <KV label="Teléfono">{p.phone || '—'}</KV>
          <KV label="Emergencia">{join(p.emergency_name, p.emergency_phone) || '—'}</KV>
          <KV label="Fisioterapeuta" tone="gold">{p.therapist_display}</KV>
          <KV label="Membresía">
            {memb.main}
            {memb.detail && <span className="t-small" style={{ display: 'block', marginTop: 3 }}>{memb.detail}</span>}
          </KV>
          {(p.age < 18 || p.guardian_name) && (
            <KV label="Tutor">
              {p.guardian_name ? `${p.guardian_name}${p.guardian_relationship ? ` (${p.guardian_relationship})` : ''}` : '—'}
              {p.guardian_phone && <span className="t-small" style={{ display: 'block', marginTop: 3 }}>{p.guardian_phone}</span>}
            </KV>
          )}
        </div>

        {clinical ? (
          <div className="hstack wrap no-print" style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={more('rx')} disabled={inactive}>Nueva receta</Button>
            <Button onClick={() => setNote({ open: true, addendumOf: null })}>Agregar nota</Button>
            <Button variant="gold" onClick={more('study')}>Subir estudio</Button>
            <Button onClick={more('more')} aria-haspopup="dialog">Más</Button>
          </div>
        ) : (
          <div className="hstack wrap no-print" style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={more('appointment')} disabled={inactive}>Agendar cita</Button>
            <Button onClick={more('edit')}>Editar datos</Button>
          </div>
        )}
      </section>

      {showChecklist && (
        <OnboardingChecklist ref={checklist} patientId={p.id} consents={consents.data} loading={consents.isLoading} error={consents.error}
          retry={() => consents.mutate()} fingerprintAt={p.fingerprint_enrolled_at} onSign={setConsentKind} onEnrolled={reloadPatient} />
      )}

      <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} />

      {tab === 'perfil' && clinical && (
        <div className="stack">
          <ProfileTab patientId={p.id} reason={p.reason} data={profile.data} error={profile.error} loading={profile.isLoading} reload={() => profile.mutate()} />
          <SignedDocuments consents={consents.data} loading={consents.isLoading} error={consents.error} retry={() => consents.mutate()} onSign={setConsentKind} />
        </div>
      )}
      {tab === 'sesiones' && clinical && (
        <NotesTab patientId={p.id} onAdd={() => setNote({ open: true, addendumOf: null })} onAddendum={(n) => setNote({ open: true, addendumOf: n })} />
      )}
      {tab === 'estudios' && clinical && <PatientStudies patientId={p.id} />}
      {tab === 'recetas' && clinical && <PatientDocuments patientId={p.id} />}
      {tab === 'firmas' && !clinical && (
        <SignedDocuments consents={consents.data} loading={consents.isLoading} error={consents.error} retry={() => consents.mutate()} onSign={setConsentKind} />
      )}
      {tab === 'membresia' && <MembershipPanel patientId={p.id} />}
      {tab === 'accesos' && user.isOwner && <AccessTab patientId={p.id} />}

      {/* Acciones menos frecuentes, agrupadas para no saturar el encabezado en el celular. */}
      <Sheet open={open === 'more'} onClose={close} title="Más acciones">
        <div className="stack sm">
          {!inactive && <button type="button" className="more-item" onClick={more('appointment')}>Agendar cita</button>}
          <button type="button" className="more-item" onClick={more('edit')}>Editar datos</button>
          <a className="more-item" href={`${base}/summary`} target="_blank" rel="noopener" onClick={close}>Resumen PDF</a>
          {user.isOwner && !inactive && <button type="button" className="more-item" onClick={more('reassign')}>Reasignar fisioterapeuta</button>}
          {user.isOwner && (
            <button type="button" className="more-item" onClick={more('status')} style={inactive ? undefined : { color: 'var(--red)' }}>
              {inactive ? 'Reactivar paciente' : 'Dar de baja'}
            </button>
          )}
        </div>
      </Sheet>

      {clinical && <NewDocumentSheet open={open === 'rx'} onClose={close} patientId={p.id} />}
      {clinical && <UploadStudySheet open={open === 'study'} onClose={close} patientId={p.id} onDone={() => refresh('/api/studies', base)} />}
      <NewAppointmentSheet open={open === 'appointment'} onClose={close} patientId={p.id} onSaved={() => refresh('/api/appointments')} />
      <EditPatientSheet open={open === 'edit'} onClose={close} patient={p} onSaved={reloadPatient} />
      {user.isOwner && <PatientStatusSheet open={open === 'status'} onClose={close} patientId={p.id} status={p.status} onDone={reloadPatient} />}
      {user.isOwner && (
        <ReassignPatientSheet open={open === 'reassign'} onClose={close} patientId={p.id} patientName={p.full_name} therapistId={p.therapist_id} onDone={reloadPatient} />
      )}
      {clinical && <NoteSheet open={note.open} onClose={() => setNote((n) => ({ ...n, open: false }))} patientId={p.id} addendumOf={note.addendumOf} />}
      {consentKind && (
        <ConsentSheet open onClose={() => setConsentKind(null)} patientId={p.id} kind={consentKind} />
      )}
    </div>
  );
}
