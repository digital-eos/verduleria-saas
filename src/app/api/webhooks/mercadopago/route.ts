import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { providerName, verifyWebhookSignature } from "@/lib/payments";
import { syncPaymentOrder } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/mercadopago — notificaciones de Mercado Pago (ruta pública, sin sesión).
 *
 * TODO MP: en "Tus integraciones" de Mercado Pago → Webhooks, configurar
 *   URL:     https://<tu-dominio>/api/webhooks/mercadopago
 *   Evento:  "Order (Mercado Pago)"
 * y copiar la "clave secreta" a MP_WEBHOOK_SECRET.
 *
 * No confiamos en el contenido del aviso: validamos la firma, buscamos la cuenta del comercio
 * por el `user_id` del aviso y volvemos a leer la orden (GET /v1/orders/{id}) con EL TOKEN DE
 * ESE COMERCIO (syncPaymentOrder → getMerchantMpClient) antes de registrar la venta.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dataId: string | null = req.nextUrl.searchParams.get("data.id") ?? body?.data?.id ?? null;

  if (providerName() === "mock") {
    console.log("[webhook mercadopago] (modo demo, se ignora)", JSON.stringify(body));
    return NextResponse.json({ ok: true, demo: true });
  }

  try {
    const valid = verifyWebhookSignature({
      xSignature: req.headers.get("x-signature"),
      xRequestId: req.headers.get("x-request-id"),
      dataId,
    });
    if (!valid) {
      console.warn("[webhook mercadopago] firma inválida", { dataId });
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const mpUserId = body?.user_id != null ? String(body.user_id) : null;
    console.log("[webhook mercadopago]", body?.type, body?.action, dataId, mpUserId);
    if (!dataId) return NextResponse.json({ ok: true });

    // Cuenta del comercio que recibió el pago. Si no la conocemos, el aviso no es para nosotros.
    const account = mpUserId ? await prisma.mercadoPagoAccount.findUnique({ where: { mpUserId } }) : null;
    if (!account) {
      console.warn("[webhook mercadopago] user_id sin cuenta conectada, se ignora", { mpUserId, dataId });
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Avisos de otras cosas (pagos online, etc.) o de órdenes que no son nuestras: se ignoran con 200
    const row = await prisma.paymentOrder.findUnique({ where: { mpOrderId: dataId } });
    if (!row) return NextResponse.json({ ok: true, ignored: true });
    if (row.merchantId !== account.merchantId) {
      console.warn("[webhook mercadopago] la orden es de otro comercio, se ignora", { dataId, mpUserId });
      return NextResponse.json({ ok: true, ignored: true });
    }

    // force: aunque ya esté pagado, volvemos a consultar (puede ser un aviso de reembolso)
    const order = await syncPaymentOrder(row, { force: true });
    return NextResponse.json({ ok: true, status: order.status });
  } catch (e) {
    console.error("[webhook mercadopago]", e);
    // 500 → Mercado Pago reintenta más tarde
    return NextResponse.json({ error: "Error procesando la notificación" }, { status: 500 });
  }
}
