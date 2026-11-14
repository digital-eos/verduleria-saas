import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMerchantForUser, hasStoreAddress } from "@/lib/merchant";
import { providerName, isMpQrEnabled, mpQrDisabledResponse } from "@/lib/payments";
import { toAccountStatusDTO } from "@/lib/payments/account";

export const dynamic = "force-dynamic";

/**
 * GET /api/mercadopago/status — estado de la conexión del comercio.
 * La caja lo usa para habilitar "Mercado Pago (QR)"; el admin además recibe los datos del comercio.
 * Nunca devuelve tokens.
 */
export async function GET() {
  if (!isMpQrEnabled()) return mpQrDisabledResponse(); // cobro QR apagado (FEATURE_MP_QR)
  try {
    const me = await requireUser();
    const merchant = await getMerchantForUser(me);
    const account = await prisma.mercadoPagoAccount.findUnique({ where: { merchantId: merchant.id } });
    const status = toAccountStatusDTO(providerName(), account);
    if (me.role !== "ADMIN") return NextResponse.json(status);
    return NextResponse.json({
      ...status,
      merchant: {
        name: merchant.name,
        streetName: merchant.streetName ?? "",
        streetNumber: merchant.streetNumber ?? "",
        city: merchant.city ?? "",
        state: merchant.state ?? "",
        latitude: merchant.latitude?.toString() ?? "",
        longitude: merchant.longitude?.toString() ?? "",
        reference: merchant.reference ?? "",
        hasAddress: hasStoreAddress(merchant),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
