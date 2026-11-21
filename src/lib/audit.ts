import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/auth";

export type AuditAction =
  | "SETUP"
  | "SIGNUP"
  | "EMAIL_VERIFIED"
  | "MERCHANT_UPDATE"
  | "LOGIN"
  | "LOGIN_FAILED"
  | "PRODUCT_CREATE"
  | "PRODUCT_UPDATE"
  | "PRODUCT_DELETE"
  | "PRODUCT_DEACTIVATE"
  | "SALE_CANCEL"
  | "SALE_RESTORE"
  | "SALE_PAYMENT_CHANGE"
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_PASSWORD_RESET"
  | "MP_CONNECT"
  | "MP_DISCONNECT"
  | "MP_SETUP"
  | "DEVICE_CLAIM"
  | "DEVICE_CLAIM_FAILED"
  | "DEVICE_UNLINK";

export const AUDIT_LABELS: Record<AuditAction, string> = {
  SETUP: "Configuración inicial",
  SIGNUP: "Comercio registrado",
  EMAIL_VERIFIED: "Email verificado",
  MERCHANT_UPDATE: "Datos del negocio cambiados",
  LOGIN: "Ingreso",
  LOGIN_FAILED: "Ingreso fallido",
  PRODUCT_CREATE: "Producto creado",
  PRODUCT_UPDATE: "Producto modificado",
  PRODUCT_DELETE: "Producto eliminado",
  PRODUCT_DEACTIVATE: "Producto desactivado",
  SALE_CANCEL: "Venta anulada",
  SALE_RESTORE: "Venta restaurada",
  SALE_PAYMENT_CHANGE: "Medio de pago cambiado",
  USER_CREATE: "Usuario creado",
  USER_UPDATE: "Usuario modificado",
  USER_PASSWORD_RESET: "Clave cambiada",
  MP_CONNECT: "Mercado Pago conectado",
  MP_DISCONNECT: "Mercado Pago desconectado",
  MP_SETUP: "Caja de Mercado Pago creada",
  DEVICE_CLAIM: "Equipo de balanza vinculado",
  DEVICE_CLAIM_FAILED: "Vinculación de equipo fallida",
  DEVICE_UNLINK: "Equipo de balanza desvinculado",
};

/** `user` lleva su comercio: el registro queda en la auditoría de ESE comercio. */
export async function audit(
  user: (Pick<AuthUser, "id" | "username"> & { merchantId?: number }) | null,
  action: AuditAction,
  entity: string,
  entityId: string | number | null,
  details?: Prisma.InputJsonValue,
  usernameOverride?: string,
  merchantIdOverride?: number | null,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: user?.id ?? null,
        merchantId: merchantIdOverride ?? user?.merchantId ?? null,
        username: usernameOverride ?? user?.username ?? "-",
        action,
        entity,
        entityId: entityId == null ? null : String(entityId),
        ...(details !== undefined ? { details } : {}),
      },
    });
  } catch (e) {
    // La auditoría nunca debe romper la operación principal
    console.error("audit error", e);
  }
}

/** Devuelve { campo: { antes, después } } solo con los campos que cambiaron */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (b !== undefined && String(a) !== String(b)) out[k] = { antes: a, despues: b };
  }
  return out;
}
