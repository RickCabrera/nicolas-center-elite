'use client';
import { useState, type ReactNode } from 'react';
import { Button, Input, Notice, useToast } from '@/components/ui';
import type { InviteResult } from './types';

/** Subtítulo de sección dentro de una hoja o tarjeta. */
export function SectionTitle({ children, tone }: { children: ReactNode; tone?: 'red' }) {
  return <h4 className={`t-h3 ${tone === 'red' ? 'red' : 'blue'}`} style={{ margin: 0 }}>{children}</h4>;
}

/** Avatar redondo con iniciales doradas, como las tarjetas de Equipo del mockup. */
export function TeamAvatar({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <div aria-hidden="true" style={{
      width: 46, height: 46, flex: 'none', borderRadius: '50%', background: 'var(--glass-soft)', border: '1px solid #3a2f13',
      display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 14px/1 var(--f-head)',
      color: dim ? 'var(--ink-5)' : 'var(--gold)',
    }}>{text}</div>
  );
}

/**
 * EQ-02 · Resultado de una invitación o restablecimiento: dice con honestidad si el correo salió
 * y SIEMPRE deja el enlace a la mano para copiarlo (sirve mientras el correo no esté configurado).
 */
export function InviteLinkBox({ result, email }: { result: InviteResult; email: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const reset = result.kind === 'reset';
  const hours = result.expires_hours ?? (reset ? 2 : 72);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.invite_link);
    } catch {
      // Navegadores sin permiso de portapapeles: se selecciona el texto para copiarlo a mano.
      const el = document.getElementById('invite-link') as HTMLInputElement | null;
      el?.focus(); el?.select();
      try { document.execCommand('copy'); } catch { return toast('Selecciona el enlace y cópialo manualmente.', 'error'); }
    }
    setCopied(true);
    toast('Enlace copiado');
  };
  return (
    <div className="stack md">
      {result.email_status === 'sent' && (
        <Notice tone="green">{reset ? 'Enlace de restablecimiento enviado a' : 'Invitación enviada a'} <b>{email}</b>.</Notice>
      )}
      {result.email_status === 'logged' && (
        <Notice tone="gold">
          {reset ? 'Enlace de restablecimiento creado para' : 'Invitación creada para'} <b>{email}</b>. El envío de correo aún no está
          configurado en el sistema, así que <b>no salió por correo</b>: copia el enlace y compártelo tú (por WhatsApp, por ejemplo).
        </Notice>
      )}
      {result.email_status === 'error' && (
        <Notice tone="red">No se pudo enviar el correo a <b>{email}</b>. Copia el enlace y compártelo directamente.</Notice>
      )}
      <label className="field">
        <span>{reset ? 'Enlace para definir una contraseña nueva' : 'Enlace de invitación'}</span>
        <div className="hstack">
          <Input id="invite-link" readOnly value={result.invite_link} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }} />
          <Button variant={copied ? 'success' : 'primary'} onClick={copy}>{copied ? 'Copiado' : 'Copiar enlace'}</Button>
        </div>
        <span className="hint">Vence en {hours} horas y solo sirve una vez. Con él la persona define su propia contraseña; tú nunca la conoces.</span>
      </label>
    </div>
  );
}

/** Barra horizontal proporcional (0-1). Dibujo propio en CSS: sin librerías. */
export function LoadBar({ ratio, tone = 'blue', height = 8, label }: { ratio: number; tone?: 'blue' | 'gold' | 'green'; height?: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  const color = tone === 'gold' ? 'var(--gold)' : tone === 'green' ? 'var(--green)' : 'var(--blue)';
  return (
    <div role="img" aria-label={label} style={{ height, borderRadius: height, background: 'rgba(255,255,255,.08)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.5)', overflow: 'hidden', minWidth: 0, flex: 1 }}>
      <div style={{ width: `${pct}%`, minWidth: pct > 0 ? 4 : 0, height: '100%', borderRadius: height, background: color, boxShadow: `0 0 12px -2px ${color}`, transition: 'width .3s ease' }} />
    </div>
  );
}
