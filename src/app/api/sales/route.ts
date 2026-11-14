import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPayment, toSaleDTO } from "@/lib/dto";
import { buildSaleLines } from "@/lib/sales";
import { handleError, requireUser } from "@/lib/auth";
import { DATE_RE, rangeAR, todayAR } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales?date=AAAA-MM-DD   (por defecto: hoy, hora Argentina)
 * Los cajeros solo pueden ver el día de hoy.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    const today = todayAR();
    const requested = req.nextUrl.searchParams.get("date") || today;
    const date = me.role === "ADMIN" ? requested : today;
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "Fecha inválida (usar AAAA-MM-DD)" }, { status: 400 });
    }
    const { start, end } = rangeAR(date, date);

    const sales = await prisma.sale.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { items: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const completed = sales.filter((s) => s.status === "COMPLETED");
    const zero = new Prisma.Decimal(0);
    const total = completed.reduce((acc, s) => acc.plus(s.total), zero);
    const items = completed.flatMap((s) => s.items);
    const totalKg = items.filter((i) => i.unit === "KG").reduce((acc, i) => acc.plus(i.quantity), zero);
    const totalUnits = items.filter((i) => i.unit === "UNIT" && i.productId !== null).reduce((acc, i) => acc.plus(i.quantity), zero);

    // Total por medio de pago ("NONE" = sin especificar)
    const byPayment: Record<string, number> = {};
    for (const s of completed) {
      const k = s.paymentMethod ?? "NONE";
      byPayment[k] = Math.round(((byPayment[k] ?? 0) + Number(s.total)) * 100) / 100;
    }

    return NextResponse.json({
      date,
      count: completed.length,
      total: Number(total),
      totalKg: Number(totalKg),
      totalUnits: Number(totalUnits),
      byPayment,
      sales: sales.map(toSaleDTO),
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST /api/sales
 *   { items: [{ code: "0001", quantity: 1.25 }, ...], paymentMethod?: "CASH" | ... }
 * `quantity` = kilos para productos por kg, unidades (entero) para productos por unidad.
 * Valida el ticket: el precio SIEMPRE se toma de la base (no del navegador),
 * calcula subtotales y total, y guarda la venta con su fecha y el cajero.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    const body = await req.json().catch(() => null);

    const pm = body?.paymentMethod;
    if (pm != null && pm !== "" && !isPayment(pm)) {
      return NextResponse.json({ error: "Medio de pago inválido" }, { status: 400 });
    }
    const paymentMethod = isPayment(pm) ? pm : null;

    const { lines, total } = await buildSaleLines(body?.items);

    const sale = await prisma.sale.create({
      data: { total, paymentMethod, userId: me.id, items: { create: lines } },
      include: { items: true, user: { select: { name: true } } },
    });

    return NextResponse.json(toSaleDTO(sale), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
