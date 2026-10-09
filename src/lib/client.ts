'use client';
import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr';

/** Error de la API con su código y, si aplica, el mensaje por campo. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', 'Sin conexión. Revisa tu internet e intenta de nuevo.');
  }
  let json: { ok?: boolean; data?: T; error?: { code: string; message: string; fields?: Record<string, string> } } | null = null;
  try {
    json = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  if (!res.ok || !json?.ok) {
    const err = json?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?expirada=1';
    }
    if (err?.code === 'password_change_required' && typeof window !== 'undefined' && !window.location.pathname.startsWith('/cambiar-contrasena')) {
      window.location.href = '/cambiar-contrasena';
    }
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Ocurrió un error. Intenta de nuevo.', err?.fields);
  }
  return json.data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
};

/**
 * Lectura con caché y revalidación. `url` null = no pedir todavía.
 *   const { data, error, isLoading, mutate } = useApi<Patient[]>('/api/patients?q=' + q);
 * Para datos en vivo (asistencias): useApi(url, { refreshInterval: 4000 }).
 */
export function useApi<T>(url: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(url, (u: string) => api.get<T>(u), { revalidateOnFocus: true, keepPreviousData: true, ...config });
}

/** Revalida todas las lecturas cuya URL empiece con alguno de los prefijos dados. */
export function refresh(...prefixes: string[]) {
  return globalMutate((key) => typeof key === 'string' && prefixes.some((p) => key.startsWith(p)));
}

/** Construye una query string omitiendo valores vacíos. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
