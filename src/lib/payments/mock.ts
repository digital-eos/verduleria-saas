import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  QR_TTL_MINUTES,
  PaymentProviderError,
  type CreateQrOrderInput,
  type CreateQrOrderResult,
  type GetOrderResult,
  type OrderStatus,
  type PaymentProvider,
} from "./types";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** "ORD" + 26 caracteres alfanuméricos en mayúscula (mismo formato que MP) */
export function mockOrderId(): string {
  let s = "ORD";
  for (let i = 0; i < 26; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
}

/**
 * Contenido del QR de DEMO: texto plano, SIN ningún valor de pago.
 * No usa el formato EMVCo de Mercado Pago: si alguien lo escanea con la app de MP (o con la
 * cámara del celular) solo ve este texto, nunca un cobro. Sirve para mostrar el proceso al cliente.
 */
function demoQrText(orderId: string, total: number): string {
  return `LIBRETITA DEMO - QR de prueba, NO es un pago real. Total: $ ${total.toFixed(2)} - Orden: ${orderId}`;
}

/** Segundos tras los cuales el pago se aprueba solo (0 = desactivado, hay que tocar "Simular pago") */
const autoApproveSeconds = () => {
  const n = Number(process.env.MOCK_AUTO_APPROVE_SECONDS ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Proveedor de DEMO: no habla con ninguna API, nadie cobra plata de verdad.
 *
 * El "lado Mercado Pago" de cada orden se guarda en la tabla payment_orders (no en memoria),
 * porque en Vercel cada consulta puede caer en una instancia distinta del servidor.
 */
export class MockMercadoPagoProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createQrOrder(input: CreateQrOrderInput): Promise<CreateQrOrderResult> {
    const orderId = mockOrderId();
    const qrData = demoQrText(orderId, input.totalAmount);
    const expiresAt = new Date(Date.now() + QR_TTL_MINUTES * 60_000).toISOString();
    return { orderId, qrData, status: "created", expiresAt };
  }

  async getOrder(orderId: string): Promise<GetOrderResult> {
    const row = await prisma.paymentOrder.findUnique({ where: { mpOrderId: orderId } });
    if (!row) throw new PaymentProviderError(`Orden ${orderId} inexistente (demo)`);

    let status = row.status as OrderStatus;
    if (status === "created") {
      const auto = autoApproveSeconds();
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) status = "expired";
      else if (auto && Date.now() - row.createdAt.getTime() >= auto * 1000) status = "processed";
    }
    return { orderId, status, totalAmount: row.totalAmount.toFixed(2) };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const { status } = await this.getOrder(orderId);
    // Igual que MP: no se puede cancelar una orden ya pagada / vencida.
    if (status !== "created") throw new PaymentProviderError(`No se puede cancelar una orden en estado ${status}`);
    // El estado "canceled" lo guarda el servicio (payment-service), que es la "fuente de verdad" en demo.
  }

  /** Solo demo: el botón "Simular pago (demo)" pasa la orden a "processed" */
  async simulatePayment(orderId: string): Promise<void> {
    const { status } = await this.getOrder(orderId);
    if (status !== "created") throw new PaymentProviderError(`La orden ya está en estado ${status}`);
    await prisma.paymentOrder.update({ where: { mpOrderId: orderId }, data: { status: "processed" } });
  }
}
