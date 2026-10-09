'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * EXP-10 · Panel de firma en canvas (dedo, lápiz o mouse).
 * Los trazos se guardan normalizados (0-1) para redibujarse si cambia el tamaño, y la imagen se exporta
 * siempre a 640 × 200 px con fondo transparente, así el PNG pesa unos cuantos KB.
 * `onChange` recibe el data URL cuando hay una firma trazada y `null` cuando el panel está vacío.
 */
type Point = { x: number; y: number };
const OUT_W = 640, OUT_H = 200;
const INK = '#14161a';

function paint(ctx: CanvasRenderingContext2D, strokes: Point[][], w: number, h: number, lineWidth: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.length) continue;
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x * w, s[0].y * h, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x * w, s[0].y * h);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x * w, s[i].y * h);
    ctx.stroke();
  }
}

/** Una firma real ocupa espacio: un toque accidental o una raya mínima no cuentan. */
function hasInk(strokes: Point[][]): boolean {
  const pts = strokes.flat();
  if (pts.length < 6) return false;
  const xs = pts.map((p) => p.x * OUT_W), ys = pts.map((p) => p.y * OUT_H);
  return Math.max(...xs) - Math.min(...xs) >= 30 && Math.max(...ys) - Math.min(...ys) >= 14;
}

export function SignaturePad({ onChange, invalid, disabled }: { onChange: (dataUrl: string | null) => void; invalid?: boolean; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    if (ctx) paint(ctx, strokes.current, w, h, 2.4 * dpr * (rect.width / OUT_W > 0.75 ? 1 : 0.85));
  }, []);

  useEffect(() => {
    redraw();
    const c = canvas.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(redraw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  const emit = useCallback(() => {
    const ok = hasInk(strokes.current);
    setEmpty(strokes.current.length === 0);
    if (!ok) return onChange(null);
    const out = document.createElement('canvas');
    out.width = OUT_W;
    out.height = OUT_H;
    const ctx = out.getContext('2d');
    if (!ctx) return onChange(null);
    paint(ctx, strokes.current, OUT_W, OUT_H, 2.6);
    onChange(out.toDataURL('image/png'));
  }, [onChange]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) };
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    strokes.current.push([point(e)]);
    setEmpty(false);
    redraw();
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const s = strokes.current[strokes.current.length - 1];
    const p = point(e), last = s[s.length - 1];
    if (Math.abs(p.x - last.x) * OUT_W < 1 && Math.abs(p.y - last.y) * OUT_H < 1) return;
    s.push(p);
    redraw();
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    emit();
  };
  const clear = () => {
    strokes.current = [];
    redraw();
    emit();
  };

  return (
    <div className="stack sm">
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvas} role="img" aria-label="Panel de firma. Traza la firma con el dedo, el lápiz o el mouse."
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{
            display: 'block', width: '100%', aspectRatio: `${OUT_W} / ${OUT_H}`, background: '#f7f7f4', borderRadius: 10,
            border: `1px solid ${invalid ? 'var(--red)' : 'rgba(255,255,255,.38)'}`, touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair',
          }}
        />
        <div aria-hidden="true" style={{ position: 'absolute', left: '8%', right: '8%', bottom: '22%', borderBottom: '1px solid #b9b9b2', pointerEvents: 'none' }} />
        {empty && (
          <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: '7%', textAlign: 'center', pointerEvents: 'none', font: "600 10px/1 var(--f-mono)", letterSpacing: '.12em', textTransform: 'uppercase', color: '#6d7682' }}>
            Firme aquí
          </div>
        )}
      </div>
      <div className="hstack between">
        <span className="t-small">Se firma con el dedo o con el mouse dentro del recuadro.</span>
        <button type="button" className="btn sm" onClick={clear} disabled={disabled || empty}>Limpiar</button>
      </div>
    </div>
  );
}
