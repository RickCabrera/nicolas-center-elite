'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { PageHeader } from '@/components/shell';
import { Skeleton, Tabs } from '@/components/ui';
import { useApi } from '@/lib/client';
import { DevicesSettings } from '@/modules/attendance/devices-settings';
import { PlansSettings } from '@/modules/billing/plans-settings';
import { BillingSettingsTab } from '@/modules/invoicing/billing-settings-tab';
import { AuditTab } from '@/modules/settings/audit-tab';
import { CatalogsTab } from '@/modules/settings/catalogs-tab';
import { ClinicTab } from '@/modules/settings/clinic-tab';
import { DataTab } from '@/modules/settings/data-tab';
import { LocationsTab } from '@/modules/settings/locations-tab';
import { ParamsTab } from '@/modules/settings/params-tab';
import { TemplatesTab } from '@/modules/settings/templates-tab';

const TABS = [
  { key: 'clinica', label: 'Clínica' },
  { key: 'sedes', label: 'Sedes' },
  { key: 'membresias', label: 'Membresías' },
  { key: 'cobros', label: 'Cobros y facturación' },
  { key: 'lectores', label: 'Lectores' },
  { key: 'catalogos', label: 'Catálogos' },
  { key: 'parametros', label: 'Parámetros' },
  { key: 'plantillas', label: 'Plantillas' },
  { key: 'auditoria', label: 'Auditoría' },
  { key: 'datos', label: 'Datos' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function Settings() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : 'clinica';
  const bar = useRef<HTMLDivElement>(null);
  // LEG-03 · contador de solicitudes de privacidad pendientes, visible desde cualquier pestaña.
  const { data: arco } = useApi<{ pending: number }>('/api/arco');
  const tabs = TABS.map((t) => (t.key === 'datos' && arco?.pending ? { ...t, label: `Datos (${arco.pending})` } : t));

  // En pantallas angostas la pestaña activa puede quedar fuera de la tira: se trae a la vista.
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);

  return (
    <div className="page">
      <PageHeader title="Configuración" sub="Clínica, membresías, cobros, lector y catálogos" />
      <div ref={bar}>
        <Tabs tabs={tabs} value={tab} onChange={(k) => router.replace(`${pathname}?tab=${k}`, { scroll: false })} />
      </div>
      {tab === 'clinica' && <ClinicTab />}
      {tab === 'sedes' && <LocationsTab />}
      {tab === 'membresias' && <PlansSettings />}
      {tab === 'cobros' && <BillingSettingsTab />}
      {tab === 'lectores' && <DevicesSettings />}
      {tab === 'catalogos' && <CatalogsTab />}
      {tab === 'parametros' && <ParamsTab />}
      {tab === 'plantillas' && <TemplatesTab />}
      {tab === 'auditoria' && <AuditTab />}
      {tab === 'datos' && <DataTab />}
    </div>
  );
}

// CFG-01…CFG-10 · Configuración (solo dueño: el grupo (owner) ya bloquea a cualquier otro rol).
export default function ConfiguracionPage() {
  return (
    <Suspense fallback={<div className="page"><Skeleton rows={4} /></div>}>
      <Settings />
    </Suspense>
  );
}
