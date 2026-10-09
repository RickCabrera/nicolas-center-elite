'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { SessionUser } from '@/lib/auth/session';

const Ctx = createContext<SessionUser | null>(null);
export function UserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
/**
 * Usuario de la sesión dentro de la app. Las banderas deciden qué se muestra; el permiso real lo aplica la API.
 * AUTH-10 · `isReception`: recepción · `isFront`: mostrador (dueño o recepción: ve a todos los pacientes y cobra) ·
 * `isClinical`: dueño o fisioterapeuta (puede abrir lo clínico del expediente).
 */
export function useUser() {
  const u = useContext(Ctx);
  if (!u) throw new Error('useUser debe usarse dentro de la app autenticada.');
  const isOwner = u.role === 'owner';
  const isReception = u.role === 'reception';
  return { ...u, isOwner, isReception, isFront: isOwner || isReception, isClinical: !isReception };
}
