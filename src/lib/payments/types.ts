/**
 * Contrato común para cobrar con QR. La interfaz de la caja y las rutas API
 * solo conocen esta interfaz: pasar de demo a Mercado Pago real es cambiar
 * PAYMENT_PROVIDER, sin tocar la UI.
 *
 * SOLO SERVIDOR: las implementaciones usan secretos (access token de cada comercio) y la base.
 */

/** Mismos valores que devuelve la API de Orders de Mercado Pago. "processed" = pagado. */
export type OrderStatus = "created" | "processed" | "expired" | "canceled" | "refunded";

export const FINAL_STATUSES: readonly OrderStatus[] = ["processed", "expired", "canceled", "refunded"];
export const isFinalStatus = (s: string) => (FINAL_STATUSES as readonly string[]).includes(s);

export type ProviderName = "mock" | "mercadopago";

export type CreateQrOrderInput = {
  /** Total en pesos. Debe ser igual a la suma de los items. */
  totalAmount: number;
  /** Máx. 150 caracteres (lo exige MP) */
  description: string;
  /** Id del cobro en Libretita, para conciliar */
  externalReference: string;
  items: { title: string; unitPrice: number; quantity: number; externalCode?: string }[];
  /** UUID v4 único por intento de cobro (header X-Idempotency-Key) */
  idempotencyKey: string;
};

export type CreateQrOrderResult = {
  orderId: string;
  /** Texto EMVCo: el navegador lo convierte en imagen QR */
  qrData: string;
  status: OrderStatus;
  /** ISO 8601 */
  expiresAt: string;
};

export type GetOrderResult = {
  orderId: string;
  status: OrderStatus;
  /** Decimal en string, ej. "1500.00" */
  totalAmount: string;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  createQrOrder(input: CreateQrOrderInput): Promise<CreateQrOrderResult>;
  getOrder(orderId: string): Promise<GetOrderResult>;
  cancelOrder(orderId: string): Promise<void>;
}

/** Validez del QR: 16 minutos (expiration_time "PT16M" en MP) */
export const QR_TTL_MINUTES = 16;

/** Mensaje que ve el comercio cuando su cuenta de Mercado Pago quedó desconectada */
export const RECONNECT_MESSAGE = "Reconectá tu cuenta de Mercado Pago";

/** Error de comunicación con el proveedor de pagos (se muestra un mensaje genérico al usuario) */
export class PaymentProviderError extends Error {
  constructor(message: string, public details?: unknown, public httpStatus?: number) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
