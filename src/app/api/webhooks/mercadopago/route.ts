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
 * No confiamos en el contenido del aviso: validamos la firma y después consultamos
 * la orden a la API (syncPaymentOrder), que es la que manda.
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

    console.log("[webhook mercadopago]", body?.type, body?.action, dataId);
    if (!dataId) return NextResponse.json({ ok: true });

    // Avisos de otras cosas (pagos online, etc.) o de órdenes que no son nuestras: se ignoran con 200
    const row = await prisma.paymentOrder.findUnique({ where: { mpOrderId: dataId } });
    if (!row) return NextResponse.json({ ok: true, ignored: true });

    const order = await syncPaymentOrder(row);
    return NextResponse.json({ ok: true, status: order.status });
  } catch (e) {
    console.error("[webhook mercadopago]", e);
    // 500 → Mercado Pago reintenta más tarde
    return NextResponse.json({ error: "Error procesando la notificación" }, { status: 500 });
  }
}
