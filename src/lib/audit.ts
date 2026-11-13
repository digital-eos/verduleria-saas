import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/auth";

export type AuditAction =
  | "SETUP"
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
  | "USER_PASSWORD_RESET";

export const AUDIT_LABELS: Record<AuditAction, string> = {
  SETUP: "Configuración inicial",
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
};

export async function audit(
  user: Pick<AuthUser, "id" | "username"> | null,
  action: AuditAction,
  entity: string,
  entityId: string | number | null,
  details?: Prisma.InputJsonValue,
  usernameOverride?: string,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: user?.id ?? null,
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
