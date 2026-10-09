'use client';
/**
 * Componentes base (UI-02). Toda pantalla se arma con estos y con las clases de globals.css.
 */
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { BILLING_LABEL, type BillingState } from '@/lib/format';
import { FingerRings } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────── Botón ─────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'gold' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
};
export function Button({ variant = 'default', size = 'md', block, loading, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx('btn', variant !== 'default' && variant, size !== 'md' && size, block && 'block', className)} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ───────── Campos ─────────
/** Etiqueta + control + error. El control va como hijo: <Field label="Nombre" error={e.nombre}><Input .../></Field> */
export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      <span>{label}</span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </label>
  );
}
export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
}
export function Select({ className, invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select className={cx('input', className)} aria-invalid={invalid || undefined} {...rest}>{children}</select>;
}
export function Textarea({ className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
}
export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="check"><input type="checkbox" {...rest} /><span>{label}</span></label>;
}

// ───────── Superficies ─────────
export function Card({ title, action, blue, children, className, lg }: { title?: ReactNode; action?: ReactNode; blue?: boolean; children: ReactNode; className?: string; lg?: boolean }) {
  return (
    <section className={cx('card', lg && 'lg', className)}>
      {(title || action) && (
        <div className="card-head">
          <h3 className={cx('t-h3', blue && 'blue')}>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function StatCard({ label, value, note, color }: { label: string; value: ReactNode; note?: string; color?: string }) {
  return (
    <div className="card">
      <div className="t-label">{label}</div>
      <div style={{ marginTop: 10, font: '800 30px/1 var(--f-head)', color: color ?? 'var(--ink)' }}>{value}</div>
      {note && <div className="t-small" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
export function KV({ label, children, tone }: { label: string; children: ReactNode; tone?: 'gold' | 'blue' }) {
  return (
    <div className="kv">
      <div className="t-label">{label}</div>
      <div className={tone}>{children}</div>
    </div>
  );
}
export function Avatar({ text, lg }: { text: string; lg?: boolean }) {
  return <div className={cx('avatar', lg && 'lg')} aria-hidden="true">{text}</div>;
}

// ───────── Insignias y filtros ─────────
export function Badge({ tone, children }: { tone?: 'green' | 'gold' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={cx('badge', tone)}>{children}</span>;
}
const BILLING_TONE: Record<BillingState, 'green' | 'gold' | 'red' | undefined> = {
  pagado: 'green', por_vencer: 'gold', vencido: 'red', pausado: undefined, sin_plan: undefined,
};
/** Insignia de estado de pago: PAGADO / POR VENCER / VENCIDO (calculado por el servidor). */
export function BillingBadge({ state }: { state: BillingState | null | undefined }) {
  const s = state ?? 'sin_plan';
  return <Badge tone={BILLING_TONE[s]}>{BILLING_LABEL[s]}</Badge>;
}
export function Chip({ on, square, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; square?: boolean }) {
  return <button type="button" className={cx('chip', square && 'sq')} aria-pressed={!!on} {...rest}>{children}</button>;
}
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="scroll-x" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" className="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}

// ───────── Estados ─────────
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Skeleton({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className="stack sm" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ minHeight: height }} />)}
    </div>
  );
}
export function ErrorNote({ error, retry }: { error: { message: string } | null | undefined; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice red" role="alert">
      {error.message} {retry && <button type="button" className="btn-link" onClick={retry} style={{ marginLeft: 8 }}>Reintentar</button>}
    </div>
  );
}
export function Notice({ tone, children }: { tone?: 'gold' | 'red' | 'green'; children: ReactNode }) {
  return <div className={cx('notice', tone)}>{children}</div>;
}

// ───────── Hoja (modal) ─────────
export function Sheet({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.btn-icon)')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      clearTimeout(t);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  // Se monta en <body> para cubrir siempre toda la ventana, sin importar dónde se use.
  return createPortal(
    <div className="sheet-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('sheet', wide && 'wide')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {children}
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmación con motivo opcional u obligatorio (cancelar cita, anular pago, archivar estudio…). */
export function Confirm({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirmar', danger, reason, reasonLabel = 'Motivo',
}: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> | void; title: string; message?: ReactNode;
  confirmLabel?: string; danger?: boolean; reason?: 'required' | 'optional'; reasonLabel?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(''); }, [open]);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(text.trim()); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={<>
        <Button onClick={onClose}>Volver</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={reason === 'required' && text.trim().length < 3} onClick={go}>{confirmLabel}</Button>
      </>}>
      <div className="stack md">
        {message && <div className="t-body">{message}</div>}
        {reason && (
          <Field label={reasonLabel + (reason === 'optional' ? ' (opcional)' : '')}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe el motivo" />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

// ───────── Avisos (toast) ─────────
type ToastFn = (message: string, kind?: 'ok' | 'error') => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<ToastFn>((message, kind = 'ok') => {
    setT({ message, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), kind === 'error' ? 4200 : 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={cx('toast', t.kind === 'error' && 'error')} role="status" aria-live="polite">{t.message}</div>}
    </ToastCtx.Provider>
  );
}

// ───────── Superposición de lectura de huella ─────────
export function ScanOverlay({ title, sub, onCancel, children }: { title: string; sub?: string; onCancel?: () => void; children?: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="overlay" role="alertdialog" aria-label={title}>
      <div className="scan-ring"><FingerRings size={76} pulse /><div className="beam" /></div>
      <div>
        <div style={{ font: '700 15px/1.2 var(--f-head)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{title}</div>
        {sub && <div className="t-label" style={{ marginTop: 8, textTransform: 'none', letterSpacing: '.06em', fontSize: 12 }}>{sub}</div>}
      </div>
      {children}
      {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
    </div>,
    document.body,
  );
}

/** Hook de formulario mínimo: valores, cambio por campo, errores por campo del servidor. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k as string] ? { ...e, [k as string]: '' } : e));
  }, []);
  /** Para <Input {...bind('nombre')} /> con valores de texto. */
  const bind = (k: keyof T) => ({
    value: (values[k] ?? '') as string,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as T[keyof T]),
    invalid: !!errors[k as string],
  });
  const reset = useCallback((v: T = initial) => { setValues(v); setErrors({}); }, [initial]);
  return { values, set, bind, errors, setErrors, reset, setValues };
}
