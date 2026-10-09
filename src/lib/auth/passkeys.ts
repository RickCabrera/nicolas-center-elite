import { env } from '../env';

/** Parámetros WebAuthn derivados de APP_URL: el RP ID es el dominio de la app. */
export function relyingParty() {
  const url = new URL(env().APP_URL);
  return { rpID: url.hostname, origin: url.origin, rpName: 'Nicolas Center Elite' };
}
export const WA_COOKIE = 'nce_wa';
