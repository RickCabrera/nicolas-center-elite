'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { SessionUser } from '@/lib/auth/session';
import type { Role } from '@/lib/db';
import { api } from '@/lib/client';
import { shortName } from '@/lib/format';
import { Icon } from './icons';
import { Sheet, ToastProvider } from './ui';
import { UserProvider, useUser } from './user-context';

type Item = { href: string; icon: string; label: string; short: string };

/** Etiqueta visible de cada rol (AUTH-10). */
export const ROLE_LABEL: Record<Role, string> = { owner: 'Dueño / Director', therapist: 'Fisioterapeuta', reception: 'Recepción' };

/** Menú por rol (AUTH-07): lo que no aparece aquí tampoco responde en la API para ese rol. */
export function navFor(role: Role): Item[] {
  const owner = role === 'owner';
  // AUTH-10 · Recepción: solo lo administrativo. Sin Recetas, Estudios, Configuración ni Equipo.
  if (role === 'reception') {
    return [
      { href: '/inicio', icon: 'dash', label: 'Inicio', short: 'Inicio' },
      { href: '/pacientes', icon: 'pacientes', label: 'Pacientes', short: 'Pacientes' },
      { href: '/agenda', icon: 'agenda', label: 'Agenda', short: 'Agenda' },
      { href: '/mensualidades', icon: 'pagos', label: 'Mensualidades', short: 'Pagos' },
      { href: '/huella', icon: 'huella', label: 'Control de huella', short: 'Huella' },
      { href: '/perfil', icon: 'perfil', label: 'Mi perfil', short: 'Perfil' },
    ];
  }
  return [
    { href: '/inicio', icon: 'dash', label: 'Inicio', short: 'Inicio' },
    { href: '/pacientes', icon: 'pacientes', label: owner ? 'Pacientes' : 'Mis pacientes', short: 'Pacientes' },
    { href: '/agenda', icon: 'agenda', label: owner ? 'Agenda' : 'Mi agenda', short: 'Agenda' },
    { href: '/recetas', icon: 'recetas', label: 'Recetas', short: 'Recetas' },
    { href: '/estudios', icon: 'estudios', label: 'Estudios', short: 'Estudios' },
    ...(owner ? [{ href: '/mensualidades', icon: 'pagos', label: 'Mensualidades', short: 'Pagos' }] : []),
    { href: '/huella', icon: 'huella', label: 'Control de huella', short: 'Huella' },
    ...(owner
      ? [{ href: '/configuracion', icon: 'config', label: 'Configuración', short: 'Ajustes' }, { href: '/equipo', icon: 'equipo', label: 'Equipo', short: 'Equipo' }]
      : []),
    { href: '/perfil', icon: 'perfil', label: 'Mi perfil', short: 'Perfil' },
  ];
}
const PRIMARY = ['/inicio', '/pacientes', '/agenda', '/huella'];

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const items = navFor(user.role);
  const isOn = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const logout = async () => {
    try { await api.post('/api/auth/logout'); } catch { /* la cookie se limpia igual */ }
    router.replace('/login');
    router.refresh();
  };
  const rest = items.filter((i) => !PRIMARY.includes(i.href));
  const restOn = rest.some((i) => isOn(i.href));

  return (
    <UserProvider user={user}>
      <ToastProvider>
        <div className="shell">
          <aside className="sidebar no-print">
            <div className="brand">
              { }
              <img src="/logo.png" alt="" />
              <div><b style={{ color: 'var(--blue)' }}>Nicolas</b><b>Center Elite</b></div>
            </div>
            <nav className="nav" aria-label="Principal">
              {items.map((i) => (
                <Link key={i.href} href={i.href} aria-current={isOn(i.href) ? 'page' : undefined}>
                  <Icon name={i.icon} on={isOn(i.href)} />{i.label}
                </Link>
              ))}
            </nav>
            <div className="session-box">
              <div className="t-label">Sesión</div>
              <div style={{ marginTop: 8, font: '600 14px/1.2 var(--f-head)' }}>{user.display_name}</div>
              <div className="t-small" style={{ marginTop: 3 }}>{user.role === 'therapist' ? user.specialty || ROLE_LABEL.therapist : ROLE_LABEL[user.role]}</div>
              <button type="button" className="btn sm block" style={{ marginTop: 12, fontFamily: 'var(--f-mono)', letterSpacing: '.14em', fontSize: 10 }} onClick={logout}>Salir</button>
            </div>
          </aside>

          <main className="main" id="contenido">{children}</main>

          <nav className="bottomnav no-print" aria-label="Principal">
            {items.filter((i) => PRIMARY.includes(i.href)).map((i) => (
              <Link key={i.href} href={i.href} aria-current={isOn(i.href) ? 'page' : undefined}>
                <Icon name={i.icon} on={isOn(i.href)} size={23} />{i.short}
              </Link>
            ))}
            <button type="button" onClick={() => setMore(true)} aria-expanded={more || restOn}>
              <Icon name="mas" on={more || restOn} size={23} />Más
            </button>
          </nav>

          <Sheet open={more} onClose={() => setMore(false)} title="Más opciones">
            <div className="stack sm">
              {rest.map((i) => (
                <Link key={i.href} href={i.href} className="more-item" aria-current={isOn(i.href) ? 'page' : undefined} onClick={() => setMore(false)}>
                  <Icon name={i.icon} on={isOn(i.href)} size={21} />{i.label}
                </Link>
              ))}
              <button type="button" className="more-item" onClick={logout}><Icon name="salir" size={21} />Cerrar sesión</button>
            </div>
          </Sheet>
        </div>
      </ToastProvider>
    </UserProvider>
  );
}

/**
 * Encabezado de cada pantalla: título, subtítulo y chip de rol (como el mockup).
 * `back` agrega el enlace de regreso encima ("← Pacientes").
 */
export function PageHeader({ title, sub, back, action }: { title: string; sub?: string; back?: { href: string; label: string }; action?: ReactNode }) {
  const user = useUser();
  return (
    <>
      <header className="topbar">
        { }
        <img src="/logo.png" alt="" className="only-mobile" />
        <div className="grow">
          <h1 className="t-title">{title}</h1>
          {sub && <div className="t-label ellipsis" style={{ marginTop: 2, lineHeight: 1.35, paddingTop: 1 }}>{sub}</div>}
        </div>
        {action}
        <Link href="/perfil" className={`rolechip no-print ${user.isOwner ? 'owner' : ''}`} title="Mi perfil">
          {user.isOwner ? 'Dueño' : user.isReception ? 'Recepción' : shortName(user.display_name)}
        </Link>
      </header>
      {back && <Link href={back.href} className="btn-link dim no-print" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', marginTop: -6, marginBottom: 14 }}>← {back.label}</Link>}
    </>
  );
}
