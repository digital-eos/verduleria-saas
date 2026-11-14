import { NextRequest, NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { createPaymentOrder } from "@/lib/payments/service";
import { isMpQrEnabled, mpQrDisabledResponse } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/orders   { items: [{ code, quantity }] }
 * Crea un cobro con QR (demo o Mercado Pago según PAYMENT_PROVIDER).
 * El total se calcula en el servidor con los precios de la base.
 * La venta se registra recién cuando el pago queda aprobado.
 */
export async function POST(req: NextRequest) {
  if (!isMpQrEnabled()) return mpQrDisabledResponse(); // cobro QR apagado (FEATURE_MP_QR)
  try {
    const me = await requireUser();
    const body = await req.json().catch(() => null);
    const order = await createPaymentOrder(me, body?.items);
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
