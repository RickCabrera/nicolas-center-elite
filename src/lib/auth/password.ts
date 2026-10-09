import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 64;

/** Hash scrypt con sal por usuario. Formato: scrypt$N$r$p$sal$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, LEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Política de contraseña (AUTH-08). Devuelve el problema en español, o null si es válida. */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(password) || !/\d/.test(password)) return 'La contraseña debe incluir letras y números.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'La contraseña no puede contener tu usuario.';
  if (/^(.)\1+$/.test(password) || ['1234567890', 'contraseña1', 'password123'].includes(password.toLowerCase()))
    return 'Elige una contraseña menos predecible.';
  return null;
}
