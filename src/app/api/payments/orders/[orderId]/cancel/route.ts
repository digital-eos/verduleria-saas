import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { cancelPaymentOrder, findPaymentOrder } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

/** POST /api/payments/orders/:orderId/cancel — botón "Cancelar" del modal */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    await requireUser();
    const { orderId } = await params;
    const row = await findPaymentOrder(orderId);
    return NextResponse.json(await cancelPaymentOrder(row));
  } catch (e) {
    return handleError(e);
  }
}
