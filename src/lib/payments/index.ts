import { createHmac, timingSafeEqual } from "node:crypto";
import { MockMercadoPagoProvider } from "./mock";
import { getMerchantMpClient } from "./account";
import type { PaymentProvider, ProviderName } from "./types";

export * from "./types";
export { MockMercadoPagoProvider } from "./mock";

/**
 * FEATURE_MP_QR="true" muestra el cobro con QR de Mercado Pago (en preparación).
 * Por defecto está APAGADO: no aparece en la caja ni en Configuración, y sus APIs responden 404.
 */
export function isMpQrEnabled(): boolean {
  return process.env.FEATURE_MP_QR?.trim().toLowerCase() === "true";
}

/** Respuesta de las rutas de Mercado Pago cuando el cobro QR está apagado */
export function mpQrDisabledResponse() {
  return Response.json({ error: "No encontrado" }, { status: 404 });
}

/** PAYMENT_PROVIDER=mock|mercadopago (por defecto: mock = modo demo) */
export function providerName(): ProviderName {
  return process.env.PAYMENT_PROVIDER === "mercadopago" ? "mercadopago" : "mock";
}

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable ${name} (necesaria con PAYMENT_PROVIDER=mercadopago)`);
  return v;
}

/**
 * Proveedor para cobrar en nombre de un comercio. Es el ÚNICO lugar donde se elige demo vs. real.
 * Real: token + caja de la cuenta de Mercado Pago que conectó ESE comercio (OAuth).
 */
export async function getPaymentProvider(merchantId: number): Promise<PaymentProvider> {
  if (providerName() === "mercadopago") return (await getMerchantMpClient(merchantId)).provider;
  return new MockMercadoPagoProvider();
}

/** Antigüedad máxima aceptada de un webhook (diferencia entre ts y la hora del servidor) */
const WEBHOOK_TOLERANCE_MS = 10 * 60_000;

/**
 * Valida la firma de una notificación (webhook) de Mercado Pago.
 * Rechaza también los avisos con ts a más de 10 minutos de la hora actual.
 *   x-signature: "ts=1704908010,v1=618c8534..."   x-request-id: "<uuid>"
 *   firma = HMAC-SHA256(MP_WEBHOOK_SECRET, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 */
export function verifyWebhookSignature(opts: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}): boolean {
  const secret = requiredEnv("MP_WEBHOOK_SECRET");
  if (!opts.xSignature) return false;
  const parts = Object.fromEntries(
    opts.xSignature.split(",").map((p) => p.split("=", 2).map((s) => s.trim()) as [string, string]),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // Anti-replay: el aviso tiene que ser reciente. ts puede venir en segundos o en milisegundos.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
  if (Math.abs(Date.now() - tsMs) > WEBHOOK_TOLERANCE_MS) return false;

  // Los ids alfanuméricos van en minúscula en el manifest (según la doc de MP)
  let manifest = "";
  if (opts.dataId) manifest += `id:${opts.dataId.toLowerCase()};`;
  if (opts.xRequestId) manifest += `request-id:${opts.xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
