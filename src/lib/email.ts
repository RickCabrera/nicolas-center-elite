import type { Tx } from './db';
import { env } from './env';

/**
 * Envía un correo transaccional por Resend. Siempre deja registro en email_outbox.
 * Sin RESEND_API_KEY el correo no sale: queda con estado "logged" y se imprime en consola,
 * de modo que el sistema funciona completo antes de conectar el servicio.
 */
export async function sendEmail(tx: Tx, msg: { to: string; subject: string; text: string }): Promise<'sent' | 'logged' | 'error'> {
  const e = env();
  let status: 'sent' | 'logged' | 'error' = 'logged';
  let error: string | null = null;
  if (e.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      if (res.ok) status = 'sent';
      else {
        status = 'error';
        error = `Resend respondió ${res.status}: ${(await res.text()).slice(0, 300)}`;
      }
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (e.APP_ENV !== 'production') {
    console.log(`\n[correo no enviado · falta RESEND_API_KEY]\nPara: ${msg.to}\nAsunto: ${msg.subject}\n${msg.text}\n`);
  }
  await tx`insert into email_outbox (to_email, subject, body_text, status, error)
           values (${msg.to}, ${msg.subject}, ${msg.text}, ${status}, ${error})`;
  return status;
}
