import { randomUUID } from "node:crypto";
import type { PaymentOrder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, type AuthUser } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { toSaleDTO, type SaleDTO } from "@/lib/dto";
import { buildSaleLines, linesFromJSON, linesToJSON, setSaleStatus, type SaleLineJSON } from "@/lib/sales";
import { merchantIdFor } from "@/lib/merchant";
import {
  MockMercadoPagoProvider,
  PaymentProviderError,
  getPaymentProvider,
  isFinalStatus,
  providerName,
  type OrderStatus,
  type PaymentProvider,
} from "./index";
import { MercadoPagoNotReadyError, mpErrorMessage } from "./account";
import { MercadoPagoReconnectError } from "./mercadopago";

/**
 * Lógica de cobro con QR, independiente del proveedor (demo o Mercado Pago real).
 * La usan las rutas /api/payments/* y el webhook.
 */

export type PaymentOrderDTO = {
  id: string;
  orderId: string;
  provider: "mock" | "mercadopago";
  demo: boolean;
  status: OrderStatus;
  totalAmount: number;
  qrData: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  sale: SaleDTO | null;
};

type RowWithSale = PaymentOrder & { sale?: Parameters<typeof toSaleDTO>[0] | null };

export const toPaymentOrderDTO = (r: RowWithSale): PaymentOrderDTO => ({
  id: r.id,
  orderId: r.mpOrderId ?? "",
  provider: r.provider as PaymentOrderDTO["provider"],
  demo: r.provider === "mock",
  status: r.status as OrderStatus,
  totalAmount: Number(r.totalAmount),
  qrData: r.qrData,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  sale: r.sale ? toSaleDTO(r.sale) : null,
});

const withSale = { sale: { include: { items: true, user: { select: { name: true } } } } } as const;

/** La cuenta del comercio no está lista (sin conectar / revocada / sin caja) → 409 con el mensaje tal cual */
const isAccountError = (e: unknown): e is PaymentProviderError =>
  e instanceof MercadoPagoReconnectError || e instanceof MercadoPagoNotReadyError;

/**
 * El proveedor que creó la orden, con el token y la caja del COMERCIO de la orden.
 * (Una orden demo se sigue consultando en demo aunque cambie la config.)
 */
async function providerFor(row: PaymentOrder): Promise<PaymentProvider> {
  if (row.provider === "mock") return new MockMercadoPagoProvider();
  if (providerName() !== "mercadopago") {
    throw new HttpError(409, "Esta orden es de Mercado Pago, pero PAYMENT_PROVIDER no está en 'mercadopago'");
  }
  if (row.merchantId == null) throw new HttpError(409, "Este cobro no tiene comercio asociado");
  try {
    return await getPaymentProvider(row.merchantId);
  } catch (e) {
    if (isAccountError(e)) throw new HttpError(409, e.message);
    throw e;
  }
}

export async function findPaymentOrder(orderId: string) {
  const row = await prisma.paymentOrder.findUnique({ where: { mpOrderId: orderId }, include: withSale });
  if (!row) throw new HttpError(404, "No encontramos ese cobro");
  return row;
}

/** Crea el cobro: valida el ticket contra la base, guarda la orden y pide el QR al proveedor. */
export async function createPaymentOrder(me: AuthUser, rawItems: unknown): Promise<PaymentOrderDTO> {
  const { lines, total } = await buildSaleLines(rawItems);
  if (total.lte(0)) throw new HttpError(400, "El total tiene que ser mayor a $ 0");

  const merchantId = await merchantIdFor(me);
  let provider: PaymentProvider;
  try {
    provider = await getPaymentProvider(merchantId);
  } catch (e) {
    if (isAccountError(e)) throw new HttpError(409, e.message);
    throw e;
  }
  const row = await prisma.paymentOrder.create({
    data: {
      provider: provider.name,
      merchantId,
      totalAmount: total,
      items: linesToJSON(lines),
      userId: me.id,
      status: "created",
    },
  });

  const count = lines.length;
  try {
    const order = await provider.createQrOrder({
      totalAmount: Number(total),
      description: `Libretita · ${count} ${count === 1 ? "producto" : "productos"}`,
      externalReference: row.id,
      // MP pide cantidades enteras: cada línea va como 1 × subtotal (ej. "Tomate · 1,250 kg").
      // Así la suma de items es exactamente el total.
      items: lines.map((l) => ({
        title: l.productId === null ? l.productName : `${l.productName} · ${formatQty(Number(l.quantity), l.unit)}`,
        unitPrice: Number(l.subtotal),
        quantity: 1,
        externalCode: l.productCode,
      })),
      // Una clave nueva por cada intento de cobro ("Generar nuevo QR" = intento nuevo)
      idempotencyKey: randomUUID(),
    });

    const saved = await prisma.paymentOrder.update({
      where: { id: row.id },
      data: {
        mpOrderId: order.orderId,
        qrData: order.qrData,
        status: order.status,
        expiresAt: new Date(order.expiresAt),
      },
      include: withSale,
    });
    return toPaymentOrderDTO(saved);
  } catch (e) {
    console.error("[payments] createQrOrder", e);
    await prisma.paymentOrder.delete({ where: { id: row.id } }).catch(() => {});
    if (e instanceof Error && e.message.startsWith("Falta la variable")) throw e;
    if (isAccountError(e)) throw new HttpError(409, e.message);
    throw new HttpError(502, mpErrorMessage(e, "No pudimos generar el QR, intentá de nuevo"));
  }
}

class AlreadyFinalized extends Error {}

/**
 * Pago aprobado → se registra la venta (medio de pago: Mercado Pago).
 * Idempotente: si el polling y el webhook llegan a la vez, solo uno crea la venta.
 */
async function finalizePaidOrder(row: PaymentOrder) {
  if (row.saleId) return;
  const lines = linesFromJSON(row.items as SaleLineJSON[]);
  try {
    await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          total: row.totalAmount,
          paymentMethod: "MERCADOPAGO",
          userId: row.userId,
          items: { create: lines },
        },
      });
      const claimed = await tx.paymentOrder.updateMany({
        where: { id: row.id, saleId: null },
        data: { saleId: sale.id, status: "processed" },
      });
      if (claimed.count === 0) throw new AlreadyFinalized(); // otro proceso ya la registró → rollback
    });
  } catch (e) {
    if (!(e instanceof AlreadyFinalized)) throw e;
  }
}

/** Margen después de expiresAt antes de dar el cobro por vencido (el QR de MP puede tardar en cerrar) */
const EXPIRY_GRACE_MS = 2 * 60_000;

export type SyncOptions = {
  /** Consultar la API aunque el cobro ya esté pagado ("processed"): para detectar reembolsos (webhook) */
  force?: boolean;
};

/**
 * Consulta el estado al proveedor, lo guarda y:
 * - si se pagó → registra la venta;
 * - si se reembolsó → anula la venta (misma lógica que la anulación manual);
 * - si venció (expiresAt + 2 min) y MP no dice "processed" → "expired".
 */
export async function syncPaymentOrder(row: PaymentOrder, opts: SyncOptions = {}): Promise<PaymentOrderDTO> {
  if (!row.mpOrderId) throw new HttpError(404, "No encontramos ese cobro");

  const overdue =
    row.status === "created" && row.expiresAt != null && row.expiresAt.getTime() + EXPIRY_GRACE_MS < Date.now();

  if (!isFinalStatus(row.status) || (opts.force && row.status === "processed")) {
    let remote;
    try {
      remote = await (await providerFor(row)).getOrder(row.mpOrderId);
    } catch (e) {
      if (isAccountError(e)) throw new HttpError(409, e.message);
      throw e;
    }
    if (remote.status === "processed" && remote.totalAmount !== row.totalAmount.toFixed(2)) {
      console.warn(`[payments] ${row.mpOrderId}: total MP ${remote.totalAmount} ≠ total local ${row.totalAmount}`);
    }

    let next: OrderStatus = remote.status;
    // Un cobro pagado solo puede pasar a reembolsado (los estados intermedios de MP se leen como "created")
    if (row.status === "processed" && next !== "refunded") next = "processed";
    // Vencido: si MP sigue "esperando el pago", lo cerramos nosotros
    if (overdue && next === "created") next = "expired";

    if (next === "refunded" && row.status !== "refunded" && row.saleId) {
      // Primero la venta, después el estado: si algo falla en el medio, el reintento del webhook lo completa
      await setSaleStatus(row.saleId, "CANCELLED", null, {
        usernameOverride: "Mercado Pago",
        details: { motivo: "Reembolso en Mercado Pago", orden: row.mpOrderId },
      });
    }
    if (next !== row.status) {
      row = await prisma.paymentOrder.update({ where: { id: row.id }, data: { status: next } });
    }
  }
  if (row.status === "processed" && !row.saleId) await finalizePaidOrder(row);

  const fresh = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: row.id }, include: withSale });
  return toPaymentOrderDTO(fresh);
}

/** "Cancelar" en el modal. Si justo se pagó, devuelve el estado real (processed) en vez de cancelar. */
export async function cancelPaymentOrder(row: PaymentOrder): Promise<PaymentOrderDTO> {
  const current = await syncPaymentOrder(row);
  if (current.status !== "created") return current;

  try {
    await (await providerFor(row)).cancelOrder(row.mpOrderId!);
  } catch (e) {
    console.error("[payments] cancelOrder", e);
    if (e instanceof HttpError && e.status === 409) throw e;
    if (isAccountError(e)) throw new HttpError(409, e.message);
    // Puede haberse pagado / vencido mientras tanto
    const after = await syncPaymentOrder(row);
    if (after.status !== "created") return after;
    throw new HttpError(502, "No pudimos cancelar el cobro, intentá de nuevo");
  }
  const updated = await prisma.paymentOrder.update({
    where: { id: row.id },
    data: { status: "canceled" },
    include: withSale,
  });
  return toPaymentOrderDTO(updated);
}

/** Solo demo: simula que el cliente pagó. */
export async function simulatePayment(row: PaymentOrder): Promise<PaymentOrderDTO> {
  if (row.provider !== "mock" || providerName() !== "mock") {
    throw new HttpError(404, "La simulación solo existe en modo demo");
  }
  try {
    await new MockMercadoPagoProvider().simulatePayment(row.mpOrderId!);
  } catch (e) {
    console.warn("[payments] simulatePayment", (e as Error).message);
  }
  return syncPaymentOrder(row);
}
