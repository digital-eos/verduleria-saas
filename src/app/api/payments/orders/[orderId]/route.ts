import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { findPaymentOrder, syncPaymentOrder } from "@/lib/payments/service";
import { isMpQrEnabled, mpQrDisabledResponse } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/orders/:orderId
 * La caja lo consulta cada 3 s mientras espera el pago. Consulta al proveedor,
 * actualiza el estado y, si está "processed", registra la venta (una sola vez).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  if (!isMpQrEnabled()) return mpQrDisabledResponse(); // cobro QR apagado (FEATURE_MP_QR)
  try {
    await requireUser();
    const { orderId } = await params;
    const row = await findPaymentOrder(orderId);
    return NextResponse.json(await syncPaymentOrder(row));
  } catch (e) {
    return handleError(e);
  }
}
