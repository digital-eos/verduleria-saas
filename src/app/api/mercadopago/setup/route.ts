import { NextRequest, NextResponse } from "next/server";
import { HttpError, handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { merchantIdFor } from "@/lib/merchant";
import { providerName } from "@/lib/payments";
import { provisionStoreAndPos, toAccountStatusDTO } from "@/lib/payments/account";

export const dynamic = "force-dynamic";

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function coord(v: unknown, label: string, limit: number): number {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || Math.abs(n) > limit || n === 0) throw new HttpError(400, `${label} inválida`);
  return Math.round(n * 1e6) / 1e6;
}

/**
 * POST /api/mercadopago/setup  (solo admin)
 *   { name, streetName, streetNumber, city, state, latitude, longitude, reference? }
 * Guarda nombre y dirección del comercio y, si la cuenta de Mercado Pago está conectada,
 * crea la sucursal y la caja que falten. También sirve para reintentar si falló al conectar.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser("ADMIN");
    const merchantId = await merchantIdFor(me);
    const b = await req.json().catch(() => ({}));

    const data = {
      name: text(b.name, 60),
      streetName: text(b.streetName, 100),
      streetNumber: text(b.streetNumber, 10),
      city: text(b.city, 60),
      state: text(b.state, 60),
      latitude: coord(b.latitude, "Latitud", 90),
      longitude: coord(b.longitude, "Longitud", 180),
      reference: text(b.reference, 100) || null,
    };
    const missing = (["name", "streetName", "streetNumber", "city", "state"] as const).filter((k) => !data[k]);
    if (missing.length) throw new HttpError(400, "Completá nombre, calle, número, ciudad y provincia");

    await prisma.merchant.update({ where: { id: merchantId }, data });

    let account = await prisma.mercadoPagoAccount.findUnique({ where: { merchantId } });
    if (providerName() === "mercadopago" && account?.status === "connected" && !account.posId) {
      account = await provisionStoreAndPos(merchantId);
      await audit(me, "MP_SETUP", "MercadoPagoAccount", account.id, { sucursal: account.storeId, caja: account.posId });
    }
    return NextResponse.json(toAccountStatusDTO(providerName(), account));
  } catch (e) {
    return handleError(e);
  }
}
