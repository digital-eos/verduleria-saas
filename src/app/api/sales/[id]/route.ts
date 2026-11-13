import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPayment, toSaleDTO } from "@/lib/dto";
import { HttpError, handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { dateKeyAR, todayAR } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

const include = { items: true, user: { select: { name: true } } } as const;

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const me = await requireUser();
    const id = Number((await params).id);
    const sale = await prisma.sale.findUnique({ where: { id }, include });
    if (!sale) throw new HttpError(404, "Venta no encontrada");
    if (me.role !== "ADMIN" && dateKeyAR(sale.createdAt) !== todayAR()) {
      throw new HttpError(403, "Solo podés ver ventas del día");
    }
    return NextResponse.json(toSaleDTO(sale));
  } catch (e) {
    return handleError(e);
  }
}

/**
 * PATCH /api/sales/:id
 *   { status: "CANCELLED" | "COMPLETED" }  -> anular / restaurar (solo admin; queda en auditoría)
 *   { paymentMethod: "CASH" | ... | null } -> corregir medio de pago (cajero: solo ventas de hoy)
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const me = await requireUser();
    const id = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const before = await prisma.sale.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "Venta no encontrada");

    const data: Prisma.SaleUpdateInput = {};

    if (body.status !== undefined) {
      if (me.role !== "ADMIN") throw new HttpError(403, "Solo un administrador puede anular ventas");
      if (body.status !== "CANCELLED" && body.status !== "COMPLETED") throw new HttpError(400, "Estado inválido");
      data.status = body.status;
    }
    if (body.paymentMethod !== undefined) {
      if (me.role !== "ADMIN" && dateKeyAR(before.createdAt) !== todayAR()) {
        throw new HttpError(403, "Solo podés modificar ventas del día");
      }
      if (body.paymentMethod !== null && body.paymentMethod !== "" && !isPayment(body.paymentMethod)) {
        throw new HttpError(400, "Medio de pago inválido");
      }
      data.paymentMethod = isPayment(body.paymentMethod) ? body.paymentMethod : null;
    }

    const sale = await prisma.sale.update({ where: { id }, data, include });

    const info = { venta: id, total: Number(before.total) };
    if (data.status && data.status !== before.status) {
      await audit(me, data.status === "CANCELLED" ? "SALE_CANCEL" : "SALE_RESTORE", "Sale", id, info);
    }
    if (body.paymentMethod !== undefined && (data.paymentMethod ?? null) !== before.paymentMethod) {
      await audit(me, "SALE_PAYMENT_CHANGE", "Sale", id, {
        ...info,
        paymentMethod: { antes: before.paymentMethod, despues: data.paymentMethod ?? null },
      });
    }
    return NextResponse.json(toSaleDTO(sale));
  } catch (e) {
    return handleError(e);
  }
}
