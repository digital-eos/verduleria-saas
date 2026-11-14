import { Prisma, type SaleUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { normalizeCode } from "@/lib/format";

export type SaleLine = {
  productId: number;
  productCode: string;
  productName: string;
  unit: SaleUnit;
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  subtotal: Prisma.Decimal;
};

/** Versión serializable de SaleLine (se guarda como JSON en payment_orders.items) */
export type SaleLineJSON = {
  productId: number;
  productCode: string;
  productName: string;
  unit: SaleUnit;
  unitPrice: string;
  quantity: string;
  subtotal: string;
};

/**
 * Valida el ticket que manda el navegador: `[{ code, quantity }]`.
 * El precio SIEMPRE se toma de la base (no del navegador). Calcula subtotales y total.
 * Tira HttpError(400) con un mensaje claro si algo no cierra.
 */
export async function buildSaleLines(rawItems: unknown): Promise<{ lines: SaleLine[]; total: Prisma.Decimal }> {
  const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
  if (list.length === 0) throw new HttpError(400, "El ticket está vacío");

  const items: { code: string; quantity: number }[] = [];
  for (const it of list as { code?: unknown; quantity?: unknown }[]) {
    const code = normalizeCode(String(it?.code ?? ""));
    const quantity = Number(it?.quantity);
    if (!code || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) {
      throw new HttpError(400, `Línea inválida: ${JSON.stringify(it)}`);
    }
    items.push({ code, quantity });
  }

  const codes = [...new Set(items.map((i) => i.code))];
  const products = await prisma.product.findMany({ where: { code: { in: codes }, active: true } });
  const byCode = new Map(products.map((p) => [p.code, p]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length) throw new HttpError(400, `Productos inexistentes: ${missing.join(", ")}`);

  const badUnits = items.filter((i) => byCode.get(i.code)!.unit === "UNIT" && !Number.isInteger(i.quantity));
  if (badUnits.length) {
    throw new HttpError(
      400,
      `Los productos por unidad llevan cantidad entera: ${badUnits.map((i) => i.code).join(", ")}`,
    );
  }

  const lines = items.map(({ code, quantity }) => {
    const p = byCode.get(code)!;
    const qty = new Prisma.Decimal(quantity.toFixed(3));
    const subtotal = p.price.times(qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return {
      productId: p.id,
      productCode: p.code,
      productName: p.name,
      unit: p.unit,
      unitPrice: p.price,
      quantity: qty,
      subtotal,
    };
  });
  const total = lines.reduce((acc, l) => acc.plus(l.subtotal), new Prisma.Decimal(0));
  return { lines, total };
}

export const linesToJSON = (lines: SaleLine[]): SaleLineJSON[] =>
  lines.map((l) => ({
    ...l,
    unitPrice: l.unitPrice.toFixed(2),
    quantity: l.quantity.toFixed(3),
    subtotal: l.subtotal.toFixed(2),
  }));

export const linesFromJSON = (lines: SaleLineJSON[]): SaleLine[] =>
  lines.map((l) => ({
    ...l,
    unitPrice: new Prisma.Decimal(l.unitPrice),
    quantity: new Prisma.Decimal(l.quantity),
    subtotal: new Prisma.Decimal(l.subtotal),
  }));
