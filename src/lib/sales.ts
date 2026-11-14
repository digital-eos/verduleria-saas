import { Prisma, type SaleStatus, type SaleUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, type AuthUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeCode } from "@/lib/format";

/** Línea de monto libre (modo Precio de la caja): no tiene producto asociado */
export const FREE_ITEM_CODE = "S/C";
export const FREE_ITEM_NAME = "Producto no registrado";
const MAX_FREE_AMOUNT = 10_000_000;

export type SaleLine = {
  productId: number | null;
  productCode: string;
  productName: string;
  unit: SaleUnit;
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  subtotal: Prisma.Decimal;
};

/** Versión serializable de SaleLine (se guarda como JSON en payment_orders.items) */
export type SaleLineJSON = {
  productId: number | null;
  productCode: string;
  productName: string;
  unit: SaleUnit;
  unitPrice: string;
  quantity: string;
  subtotal: string;
};

/**
 * Valida el ticket que manda el navegador: `[{ code, quantity } | { amount }]`.
 * - `{ code, quantity }`: el precio SIEMPRE se toma de la base (no del navegador).
 * - `{ amount }`: monto libre del modo Precio ("Producto no registrado"), sin producto.
 * Calcula subtotales y total. Tira HttpError(400) con un mensaje claro si algo no cierra.
 * Las líneas conservan el orden del ticket.
 */
export async function buildSaleLines(rawItems: unknown): Promise<{ lines: SaleLine[]; total: Prisma.Decimal }> {
  const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
  if (list.length === 0) throw new HttpError(400, "El ticket está vacío");

  type Parsed = { kind: "product"; code: string; quantity: number } | { kind: "free"; amount: Prisma.Decimal };
  const parsed: Parsed[] = [];
  const items: { code: string; quantity: number }[] = [];
  for (const it of list as { code?: unknown; quantity?: unknown; amount?: unknown }[]) {
    if (it?.amount != null) {
      const amount = Number(it.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_FREE_AMOUNT) {
        throw new HttpError(400, `Monto inválido: ${JSON.stringify(it.amount)}`);
      }
      parsed.push({ kind: "free", amount: new Prisma.Decimal(amount.toFixed(2)) });
      continue;
    }
    const code = normalizeCode(String(it?.code ?? ""));
    const quantity = Number(it?.quantity);
    if (!code || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) {
      throw new HttpError(400, `Línea inválida: ${JSON.stringify(it)}`);
    }
    items.push({ code, quantity });
    parsed.push({ kind: "product", code, quantity });
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

  const lines = parsed.map((it): SaleLine => {
    if (it.kind === "free") {
      return {
        productId: null,
        productCode: FREE_ITEM_CODE,
        productName: FREE_ITEM_NAME,
        unit: "UNIT",
        unitPrice: it.amount,
        quantity: new Prisma.Decimal(1),
        subtotal: it.amount,
      };
    }
    const { code, quantity } = it;
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

type Tx = Prisma.TransactionClient;

/**
 * Mueve la "Cantidad ingresada" de los productos de una venta:
 * `-1` al vender / restaurar, `+1` al anular (devuelve lo vendido).
 * Solo toca productos que tienen cantidad cargada (quantityIn null = sin control de stock)
 * y los montos libres no tienen producto. El decremento es atómico en la base, así que dos
 * cajas vendiendo a la vez no se pisan. Puede quedar negativo: la venta nunca se bloquea.
 */
export async function applyStock(
  tx: Tx,
  items: { productId: number | null; quantity: Prisma.Decimal | Prisma.Decimal.Value }[],
  sign: 1 | -1,
) {
  const byProduct = new Map<number, Prisma.Decimal>();
  for (const it of items) {
    if (it.productId == null) continue;
    const prev = byProduct.get(it.productId) ?? new Prisma.Decimal(0);
    byProduct.set(it.productId, prev.plus(new Prisma.Decimal(it.quantity)));
  }
  for (const [id, qty] of byProduct) {
    await tx.product.updateMany({
      where: { id, quantityIn: { not: null } },
      data: { quantityIn: sign === 1 ? { increment: qty } : { decrement: qty } },
    });
  }
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

/**
 * Anula (CANCELLED) o restaura (COMPLETED) una venta y lo deja en auditoría.
 * Es la ÚNICA lógica de anulación: la usan el admin (PATCH /api/sales/:id) y el reembolso
 * de Mercado Pago. Anular devuelve la cantidad vendida al stock; restaurar la vuelve a descontar.
 * Idempotente: si la venta ya estaba en ese estado no hace nada (ni toca el stock) y devuelve false.
 */
export async function setSaleStatus(
  saleId: number,
  status: SaleStatus,
  actor: Pick<AuthUser, "id" | "username"> | null,
  opts: { details?: Record<string, Prisma.InputJsonValue>; usernameOverride?: string } = {},
): Promise<boolean> {
  const before = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!before) throw new HttpError(404, "Venta no encontrada");
  const changed = await prisma.$transaction(async (tx) => {
    const res = await tx.sale.updateMany({ where: { id: saleId, status: { not: status } }, data: { status } });
    if (res.count > 0) {
      const items = await tx.saleItem.findMany({ where: { saleId }, select: { productId: true, quantity: true } });
      await applyStock(tx, items, status === "CANCELLED" ? 1 : -1);
    }
    return res.count;
  });
  if (changed === 0) return false;
  await audit(
    actor,
    status === "CANCELLED" ? "SALE_CANCEL" : "SALE_RESTORE",
    "Sale",
    saleId,
    { venta: saleId, total: Number(before.total), ...opts.details },
    opts.usernameOverride,
  );
  return true;
}
