import type { Merchant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/auth";

/** Comercio del usuario logueado (cada usuario pertenece a uno solo). */
export async function getMerchantForUser(me: Pick<AuthUser, "merchantId">): Promise<Merchant> {
  return prisma.merchant.findUniqueOrThrow({ where: { id: me.merchantId } });
}

export const merchantIdFor = async (me: Pick<AuthUser, "merchantId">) => me.merchantId;

/** La dirección mínima que pide Mercado Pago para crear la sucursal */
export const hasStoreAddress = (m: Merchant) =>
  !!(m.name && m.streetName && m.streetNumber && m.city && m.state && m.latitude != null && m.longitude != null);
