import type { Product, Sale, SaleItem } from "@prisma/client";

export type Unit = "KG" | "UNIT";
export type Payment = "CASH" | "DEBIT" | "CREDIT" | "TRANSFER" | "MERCADOPAGO" | "OTHER";

export const PAYMENT_LABELS: Record<Payment, string> = {
  CASH: "Efectivo",
  DEBIT: "Débito",
  CREDIT: "Crédito",
  TRANSFER: "Transferencia",
  MERCADOPAGO: "Mercado Pago",
  OTHER: "Otro",
};
export const PAYMENT_METHODS = Object.keys(PAYMENT_LABELS) as Payment[];
export const isPayment = (v: unknown): v is Payment =>
  typeof v === "string" && (PAYMENT_METHODS as string[]).includes(v);

export type ProductDTO = {
  id: number;
  code: string;
  name: string;
  unit: Unit;
  price: number;
  active: boolean;
};

export type SaleItemDTO = {
  id: number;
  productCode: string;
  productName: string;
  unit: Unit;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type SaleDTO = {
  id: number;
  createdAt: string;
  total: number;
  status: "COMPLETED" | "CANCELLED";
  paymentMethod: Payment | null;
  cashier: string | null;
  items: SaleItemDTO[];
};

export const toProductDTO = (p: Product): ProductDTO => ({
  id: p.id,
  code: p.code,
  name: p.name,
  unit: p.unit,
  price: Number(p.price),
  active: p.active,
});

export const toSaleDTO = (s: Sale & { items: SaleItem[]; user?: { name: string } | null }): SaleDTO => ({
  id: s.id,
  createdAt: s.createdAt.toISOString(),
  total: Number(s.total),
  status: s.status,
  paymentMethod: s.paymentMethod,
  cashier: s.user?.name ?? null,
  items: s.items.map((i) => ({
    id: i.id,
    productCode: i.productCode,
    productName: i.productName,
    unit: i.unit,
    unitPrice: Number(i.unitPrice),
    quantity: Number(i.quantity),
    subtotal: Number(i.subtotal),
  })),
});
