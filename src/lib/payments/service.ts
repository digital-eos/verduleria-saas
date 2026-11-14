import { randomUUID } from "node:crypto";
import type { PaymentOrder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, type AuthUser } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { toSaleDTO, type SaleDTO } from "@/lib/dto";
import { buildSaleLines, linesFromJSON, linesToJSON, type SaleLineJSON } from "@/lib/sales";
import {
  MockMercadoPagoProvider,
  getPaymentProvider,
  isFinalStatus,
  providerName,
  type OrderStatus,
  type PaymentProvider,
} from "./index";
import { MercadoPagoOrdersProvider } from "./mercadopago";

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

/** El proveedor que creó la orden (una orden demo se sigue consultando en demo aunque cambie la config) */
function providerFor(row: PaymentOrder): PaymentProvider {
  if (row.provider === "mock") return new MockMercadoPagoProvider();
  const p = getPaymentProvider();
  if (!(p instanceof MercadoPagoOrdersProvider)) {
    throw new HttpError(409, "Esta orden es de Mercado Pago, pero PAYMENT_PROVIDER no está en 'mercadopago'");
  }
  return p;
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

  const provider = getPaymentProvider();
  const row = await prisma.paymentOrder.create({
    data: {
      provider: provider.name,
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
        title: `${l.productName} · ${formatQty(Number(l.quantity), l.unit)}`,
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
    throw new HttpError(502, "No pudimos generar el QR, intentá de nuevo");
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

/** Consulta el estado al proveedor, lo guarda y, si se pagó, registra la venta. */
export async function syncPaymentOrder(row: PaymentOrder): Promise<PaymentOrderDTO> {
  if (!row.mpOrderId) throw new HttpError(404, "No encontramos ese cobro");

  if (!isFinalStatus(row.status)) {
    const remote = await providerFor(row).getOrder(row.mpOrderId);
    if (remote.status === "processed" && remote.totalAmount !== row.totalAmount.toFixed(2)) {
      console.warn(`[payments] ${row.mpOrderId}: total MP ${remote.totalAmount} ≠ total local ${row.totalAmount}`);
    }
    if (remote.status !== row.status) {
      row = await prisma.paymentOrder.update({ where: { id: row.id }, data: { status: remote.status } });
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
    await providerFor(row).cancelOrder(row.mpOrderId!);
  } catch (e) {
    console.error("[payments] cancelOrder", e);
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
