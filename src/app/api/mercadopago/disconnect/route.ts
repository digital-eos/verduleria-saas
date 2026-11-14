import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { merchantIdFor } from "@/lib/merchant";
import { providerName } from "@/lib/payments";
import { toAccountStatusDTO } from "@/lib/payments/account";

export const dynamic = "force-dynamic";

/**
 * POST /api/mercadopago/disconnect — botón "Desconectar" (solo admin).
 * La cuenta pasa a "revoked": no se usa más su token hasta volver a conectar.
 * (Para revocar también el permiso del lado de Mercado Pago: Tu cuenta → Seguridad → Aplicaciones conectadas.)
 */
export async function POST() {
  try {
    const me = await requireUser("ADMIN");
    const merchantId = await merchantIdFor(me);
    const account = await prisma.mercadoPagoAccount.findUnique({ where: { merchantId } });
    if (!account) return NextResponse.json(toAccountStatusDTO(providerName(), null));

    const updated = await prisma.mercadoPagoAccount.update({ where: { id: account.id }, data: { status: "revoked" } });
    await audit(me, "MP_DISCONNECT", "MercadoPagoAccount", account.id, { mpUserId: account.mpUserId });
    return NextResponse.json(toAccountStatusDTO(providerName(), updated));
  } catch (e) {
    return handleError(e);
  }
}
