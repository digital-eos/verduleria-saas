import {
  QR_TTL_MINUTES,
  PaymentProviderError,
  type CreateQrOrderInput,
  type CreateQrOrderResult,
  type GetOrderResult,
  type OrderStatus,
  type PaymentProvider,
} from "./types";

const API = "https://api.mercadopago.com";

/** Todos los importes viajan como string decimal con 2 decimales: "1500.00" */
const amount = (n: number) => n.toFixed(2);

/**
 * La API de Orders tiene más estados que los nuestros. Los intermedios
 * (action_required, processing, at_terminal, failed: el cliente puede reintentar con el mismo QR)
 * se tratan como "created" = sigue esperando el pago.
 */
function mapStatus(s: unknown): OrderStatus {
  switch (s) {
    case "processed":
    case "expired":
    case "canceled":
    case "refunded":
      return s;
    default:
      return "created";
  }
}

type MpOrder = {
  id: string;
  status: string;
  status_detail?: string;
  total_amount?: string;
  type_response?: { qr_data?: string };
};

/**
 * Mercado Pago REAL (API de Orders, QR dinámico).
 * Se activa con PAYMENT_PROVIDER=mercadopago + MP_ACCESS_TOKEN + MP_EXTERNAL_POS_ID (+ MP_WEBHOOK_SECRET).
 * Docs: https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/qr-code/orders/create-order/post
 */
export class MercadoPagoOrdersProvider implements PaymentProvider {
  readonly name = "mercadopago" as const;

  constructor(
    private readonly accessToken: string,
    private readonly externalPosId: string,
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      // TODO MP: revisar en los logs de Vercel los errores reales (400 = body inválido, 401 = token, 404 = POS…)
      console.error(`[mercadopago] ${method} ${path} -> ${res.status}`, data);
      throw new PaymentProviderError(`Mercado Pago respondió ${res.status}`, data);
    }
    return data as T;
  }

  async createQrOrder(input: CreateQrOrderInput): Promise<CreateQrOrderResult> {
    const total = amount(input.totalAmount);
    // TODO MP: probar con credenciales de prueba (cuenta vendedor de test) antes de producción.
    const order = await this.request<MpOrder>(
      "POST",
      "/v1/orders",
      {
        type: "qr",
        total_amount: total,
        description: input.description.slice(0, 150),
        external_reference: input.externalReference,
        expiration_time: `PT${QR_TTL_MINUTES}M`,
        config: {
          // TODO MP: MP_EXTERNAL_POS_ID es el "external_id" de la caja (POS) creada en Mercado Pago
          // (POST /pos con su sucursal / store). Una caja = un QR a la vez.
          qr: { external_pos_id: this.externalPosId, mode: "dynamic" },
        },
        // La suma de transactions.payments debe ser igual a total_amount
        transactions: { payments: [{ amount: total }] },
        items: input.items.map((i) => ({
          title: i.title.slice(0, 150),
          unit_price: amount(i.unitPrice),
          quantity: i.quantity,
          unit_measure: "unit",
          ...(i.externalCode ? { external_code: i.externalCode } : {}),
        })),
      },
      input.idempotencyKey,
    );

    const qrData = order.type_response?.qr_data;
    if (!order.id || !qrData) {
      throw new PaymentProviderError("Mercado Pago no devolvió qr_data", order);
    }
    return {
      orderId: order.id,
      qrData,
      status: mapStatus(order.status),
      // La respuesta no trae la fecha de vencimiento: la calculamos con el mismo plazo enviado
      expiresAt: new Date(Date.now() + QR_TTL_MINUTES * 60_000).toISOString(),
    };
  }

  async getOrder(orderId: string): Promise<GetOrderResult> {
    const order = await this.request<MpOrder>("GET", `/v1/orders/${encodeURIComponent(orderId)}`);
    return { orderId: order.id, status: mapStatus(order.status), totalAmount: order.total_amount ?? "0.00" };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request("POST", `/v1/orders/${encodeURIComponent(orderId)}/cancel`, undefined, crypto.randomUUID());
  }
}
