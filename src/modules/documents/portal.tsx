'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Monta las hojas en <body>. `.page` conserva una animación con transform (fill-mode both), y eso la
 * vuelve el bloque contenedor de cualquier `position: fixed` que viva dentro: la hoja quedaría
 * recortada al alto de la página en lugar de cubrir la ventana.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}
