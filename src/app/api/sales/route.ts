import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPayment, toSaleDTO } from "@/lib/dto";
import { applyStock, buildSaleLines } from "@/lib/sales";
import { handleError, requireUser } from "@/lib/auth";
import { DATE_RE, daysBetween, rangeAR, todayAR } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales?date=AAAA-MM-DD                 un día (por defecto: hoy, hora Argentina)
 * GET /api/sales?from=AAAA-MM-DD&to=AAAA-MM-DD   un rango (semana, mes…; máx. 62 días)
 * Los cajeros solo pueden ver el día de hoy.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    const today = todayAR();
    const sp = req.nextUrl.searchParams;
    const date = sp.get("date") || today;
    let from = sp.get("from") || date;
    let to = sp.get("to") || sp.get("from") || date;
    if (me.role !== "ADMIN") from = to = today;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: "Fecha inválida (usar AAAA-MM-DD)" }, { status: 400 });
    }
    const days = daysBetween(from, to).length;
    if (days === 0 || days > 62) {
      return NextResponse.json({ error: "Rango inválido (máximo 62 días)" }, { status: 400 });
    }
    const { start, end } = rangeAR(from, to);

    const sales = await prisma.sale.findMany({
      where: { merchantId: me.merchantId, createdAt: { gte: start, lt: end } },
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
      date: from,
      from,
      to,
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

    const { lines, total } = await buildSaleLines(me.merchantId, body?.items);

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: { merchantId: me.merchantId, total, paymentMethod, userId: me.id, items: { create: lines } },
        include: { items: true, user: { select: { name: true } } },
      });
      await applyStock(tx, lines, -1);
      return created;
    });

    return NextResponse.json(toSaleDTO(sale), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
