import { createHmac, timingSafeEqual } from "node:crypto";
import { MockMercadoPagoProvider } from "./mock";
import { MercadoPagoOrdersProvider } from "./mercadopago";
import type { PaymentProvider, ProviderName } from "./types";

export * from "./types";
export { MockMercadoPagoProvider } from "./mock";

/** PAYMENT_PROVIDER=mock|mercadopago (por defecto: mock = modo demo) */
export function providerName(): ProviderName {
  return process.env.PAYMENT_PROVIDER === "mercadopago" ? "mercadopago" : "mock";
}

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable ${name} (necesaria con PAYMENT_PROVIDER=mercadopago)`);
  return v;
}

/** Devuelve el proveedor configurado. Es el ÚNICO lugar donde se elige demo vs. real. */
export function getPaymentProvider(): PaymentProvider {
  if (providerName() === "mercadopago") {
    return new MercadoPagoOrdersProvider(requiredEnv("MP_ACCESS_TOKEN"), requiredEnv("MP_EXTERNAL_POS_ID"));
  }
  return new MockMercadoPagoProvider();
}

/**
 * Valida la firma de una notificación (webhook) de Mercado Pago.
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
