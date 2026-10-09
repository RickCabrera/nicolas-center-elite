'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { SessionUser } from '@/lib/auth/session';

const Ctx = createContext<SessionUser | null>(null);
export function UserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
/** Usuario de la sesión dentro de la app. `isOwner` decide qué se muestra; el permiso real lo aplica la API. */
export function useUser() {
  const u = useContext(Ctx);
  if (!u) throw new Error('useUser debe usarse dentro de la app autenticada.');
  return { ...u, isOwner: u.role === 'owner' };
}
