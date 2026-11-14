import {
  QR_TTL_MINUTES,
  RECONNECT_MESSAGE,
  PaymentProviderError,
  type CreateQrOrderInput,
  type CreateQrOrderResult,
  type GetOrderResult,
  type OrderStatus,
  type PaymentProvider,
} from "./types";

const API = "https://api.mercadopago.com";
/** Tiempo máximo de espera de cada llamada a la API */
const MP_TIMEOUT_MS = 10_000;

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

/** El token del comercio ya no sirve (revocado / vencido): hay que volver a conectar la cuenta */
export class MercadoPagoReconnectError extends PaymentProviderError {
  constructor(details?: unknown) {
    super(RECONNECT_MESSAGE, details);
    this.name = "MercadoPagoReconnectError";
  }
}

export type MpRequestOptions = {
  body?: unknown;
  idempotencyKey?: string;
  /** Se llama ante un 401 (token revocado), antes de tirar MercadoPagoReconnectError */
  onUnauthorized?: () => Promise<void>;
};

/** Llamada a la API de Mercado Pago con el token de UN comercio */
export async function mpRequest<T>(
  accessToken: string,
  method: "GET" | "POST",
  path: string,
  opts: MpRequestOptions = {},
): Promise<T> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "X-Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      console.error(`[mercadopago] ${method} ${path} -> timeout (${MP_TIMEOUT_MS} ms)`);
      throw new PaymentProviderError("Mercado Pago no respondió a tiempo", { method, path });
    }
    throw e;
  }
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    console.error(`[mercadopago] ${method} ${path} -> ${res.status}`, data);
    if (res.status === 401) {
      await opts.onUnauthorized?.().catch((e) => console.error("[mercadopago] onUnauthorized", e));
      throw new MercadoPagoReconnectError(data);
    }
    throw new PaymentProviderError(`Mercado Pago respondió ${res.status}`, data, res.status);
  }
  return data as T;
}

/**
 * Mercado Pago REAL (API de Orders, QR dinámico), con el token y la caja de UN comercio.
 * Lo arma getMerchantMpClient(merchantId) (ver account.ts): nunca hay un token global.
 * Docs: https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/qr-code/orders/create-order/post
 */
export class MercadoPagoOrdersProvider implements PaymentProvider {
  readonly name = "mercadopago" as const;

  constructor(
    private readonly accessToken: string,
    private readonly externalPosId: string,
    private readonly onUnauthorized?: () => Promise<void>,
  ) {}

  private request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
    return mpRequest<T>(this.accessToken, method, path, { body, idempotencyKey, onUnauthorized: this.onUnauthorized });
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
          // external_id de la caja del comercio (creada al conectar la cuenta). Una caja = un QR a la vez.
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
