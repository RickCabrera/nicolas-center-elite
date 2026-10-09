import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/archivo/800.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Nicolas Center Elite', template: '%s · Nicolas Center Elite' },
  description: 'Sistema clínico de Nicolas Center Elite: pacientes, agenda, recetas, mensualidades y asistencia.',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'NC Elite', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { themeColor: '#05060a', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
