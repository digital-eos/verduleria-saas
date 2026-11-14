import type { Merchant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/auth";

/**
 * Comercio del usuario logueado.
 * Hoy cada instalación tiene un solo comercio: si el usuario todavía no tiene uno asignado
 * (ej. el admin creado en la configuración inicial), se le asigna el primero (o se crea).
 */
export async function getMerchantForUser(me: Pick<AuthUser, "id">): Promise<Merchant> {
  const user = await prisma.user.findUnique({ where: { id: me.id }, include: { merchant: true } });
  if (user?.merchant) return user.merchant;

  const merchant =
    (await prisma.merchant.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.merchant.create({ data: { name: "Mi comercio" } }));
  await prisma.user.update({ where: { id: me.id }, data: { merchantId: merchant.id } });
  return merchant;
}

export const merchantIdFor = async (me: Pick<AuthUser, "id">) => (await getMerchantForUser(me)).id;

/** La dirección mínima que pide Mercado Pago para crear la sucursal */
export const hasStoreAddress = (m: Merchant) =>
  !!(m.name && m.streetName && m.streetNumber && m.city && m.state && m.latitude != null && m.longitude != null);
