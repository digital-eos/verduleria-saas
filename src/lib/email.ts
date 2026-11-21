/**
 * Envío de emails con Resend (API HTTP, sin dependencias).
 * Variables: RESEND_API_KEY y EMAIL_FROM (ej. "Libretita <hola@tudominio.com>", dominio verificado en Resend).
 * En desarrollo, sin RESEND_API_KEY, el email no se manda: se muestra en la consola del servidor.
 */

export type Email = { to: string; subject: string; html: string; text: string };

export const emailConfigured = () => !!process.env.RESEND_API_KEY;

/** Devuelve true si se mandó; false si es desarrollo sin proveedor (solo se loguea). */
export async function sendEmail(mail: Email): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("Falta la variable RESEND_API_KEY");
    console.log(`\n[email] (desarrollo, no se envía) Para: ${mail.to}\nAsunto: ${mail.subject}\n${mail.text}\n`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Libretita <onboarding@resend.dev>",
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return true;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function verificationEmail(to: string, name: string, merchantName: string, link: string): Email {
  return {
    to,
    subject: "Confirmá tu email para empezar a usar Libretita",
    text:
      `Hola ${name}:\n\nGracias por registrar ${merchantName} en Libretita.\n` +
      `Confirmá tu email entrando a este enlace (vale 48 horas):\n\n${link}\n\n` +
      `Si no fuiste vos, ignorá este mensaje.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#222">
  <h2>📒 Libretita</h2>
  <p>Hola ${esc(name)}:</p>
  <p>Gracias por registrar <b>${esc(merchantName)}</b> en Libretita. Confirmá tu email para empezar:</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${esc(link)}" style="background:#2e7d32;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Confirmar mi email</a>
  </p>
  <p style="color:#666;font-size:13px">El enlace vale 48 horas. Si no fuiste vos, ignorá este mensaje.</p>
</div>`,
  };
}
