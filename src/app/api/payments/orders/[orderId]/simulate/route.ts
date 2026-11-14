import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { findPaymentOrder, simulatePayment } from "@/lib/payments/service";
import { isMpQrEnabled, mpQrDisabledResponse } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** POST /api/payments/orders/:orderId/simulate — SOLO MODO DEMO: "Simular pago (demo)" */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  if (!isMpQrEnabled()) return mpQrDisabledResponse(); // cobro QR apagado (FEATURE_MP_QR)
  try {
    await requireUser();
    const { orderId } = await params;
    const row = await findPaymentOrder(orderId);
    return NextResponse.json(await simulatePayment(row));
  } catch (e) {
    return handleError(e);
  }
}
