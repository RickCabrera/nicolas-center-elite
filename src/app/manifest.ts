import type { MetadataRoute } from 'next';

// UI-04 · Permite "Agregar a inicio" en el celular con el logo de la clínica.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nicolas Center Elite',
    short_name: 'NC Elite',
    description: 'Sistema clínico de Nicolas Center Elite',
    start_url: '/inicio',
    display: 'standalone',
    background_color: '#05060a',
    theme_color: '#05060a',
    lang: 'es-MX',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
