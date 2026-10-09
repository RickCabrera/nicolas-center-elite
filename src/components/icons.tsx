import type { CSSProperties } from 'react';

/** Iconos de línea del mockup (UI-04). */
const PATHS: Record<string, string[]> = {
  dash: ['M3 10.6 12 3.5l9 7.1', 'M5.6 9.2V20h12.8V9.2', 'M9.8 20v-6h4.4v6'],
  pacientes: ['M9 11.2a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z', 'M2.9 20c0-3.4 2.7-6.1 6.1-6.1s6.1 2.7 6.1 6.1', 'M16.4 4.9a3.1 3.1 0 0 1 0 6', 'M17.6 13.9c2.2.5 3.8 2.4 3.8 4.7V20'],
  agenda: ['M4.5 5.6h15v14.1h-15z', 'M8.4 3.2v4', 'M15.6 3.2v4', 'M4.5 10.2h15', 'M8.6 14h2', 'M13.4 14h2', 'M8.6 17h2', 'M13.4 17h2'],
  recetas: ['M6.2 3.2h8l4 4v13.6H6.2z', 'M14 3.2v4.2h4.2', 'M9 12h6', 'M9 15.4h6', 'M9 18.4h3.6'],
  estudios: ['M3.2 6.6a1.6 1.6 0 0 1 1.6-1.6h4l1.8 2.4h7.6a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z', 'M7.6 14.4l2.6-2.8 2.4 2.4 2.2-3 2.6 4'],
  pagos: ['M2.8 6.8h18.4v10.4H2.8z', 'M2.8 10.4h18.4', 'M6.2 14.2h3.4'],
  huella: ['M12 12.1a2 2 0 0 1 2 2v2.2', 'M8.6 16.9v-2.8a3.4 3.4 0 0 1 6.8 0v1.6', 'M5.9 17.4v-3.3a6.1 6.1 0 0 1 12.2 0v1.4', 'M4 12.6a8 8 0 0 1 15.2-3.4', 'M9 20.2a8 8 0 0 0 8.6-2.6'],
  config: ['M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z', 'M19.3 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4v.2a1.8 1.8 0 1 1-3.6 0V20a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9H4a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4V4a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.2a1.8 1.8 0 1 1 0 3.6H20a1.5 1.5 0 0 0-1.4.9Z'],
  equipo: ['M8.8 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z', 'M2.6 20c0-3.4 2.8-6.2 6.2-6.2S15 16.6 15 20', 'M16.2 5.2a3.1 3.1 0 0 1 0 6', 'M17.4 14.1c2.3.5 3.9 2.4 3.9 4.8V20'],
  perfil: ['M12 11.6a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Z', 'M4.6 20.2c0-3.9 3.3-6.4 7.4-6.4s7.4 2.5 7.4 6.4'],
  mas: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  salir: ['M9.5 4.5H5.5v15h4', 'M14 8l4 4-4 4', 'M18 12H9.5'],
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, on = false, size = 20, style }: { name: string; on?: boolean; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={on ? '#2e9bff' : 'rgba(255,255,255,.65)'}
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flex: 'none', filter: on ? 'drop-shadow(0 0 7px rgba(46,155,255,.75))' : 'none', ...style }}>
      {(PATHS[name] ?? PATHS.dash).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Anillos de huella del mockup (login, lector, enrolamiento). */
export function FingerRings({ size = 24, pulse = false, color = '#2e9bff' }: { size?: number; pulse?: boolean; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={size > 40 ? 1.2 : 1.4} aria-hidden="true"
      style={pulse ? { animation: 'pulse 1s ease-in-out infinite' } : undefined}>
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="12" cy="12" r="5.4" strokeDasharray="20 8" />
      <circle cx="12" cy="12" r="8.4" strokeDasharray="26 12" />
      <circle cx="12" cy="12" r="11" strokeDasharray="30 18" />
    </svg>
  );
}
