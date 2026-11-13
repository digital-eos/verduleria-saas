import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, requireUser } from "@/lib/auth";
import { DATE_RE, addDays, dateKeyAR, daysBetween, rangeAR, todayAR } from "@/lib/dates";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * GET /api/reports?from=AAAA-MM-DD&to=AAAA-MM-DD   (solo admin, máx. 366 días)
 * Totales, ventas por día, por medio de pago, por cajero, por hora y ranking de productos.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser("ADMIN");
    const sp = req.nextUrl.searchParams;
    const to = DATE_RE.test(sp.get("to") ?? "") ? sp.get("to")! : todayAR();
    const from = DATE_RE.test(sp.get("from") ?? "") ? sp.get("from")! : addDays(to, -6);
    const days = daysBetween(from, to);
    if (days.length === 0 || days.length > 366) {
      return NextResponse.json({ error: "Rango inválido (máximo 366 días)" }, { status: 400 });
    }
    const { start, end } = rangeAR(from, to);

    const sales = await prisma.sale.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { items: true, user: { select: { name: true } } },
    });
    const completed = sales.filter((s) => s.status === "COMPLETED");

    const byDay = new Map(days.map((d) => [d, { date: d, total: 0, count: 0 }]));
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, count: 0 }));
    const byPayment: Record<string, number> = {};
    const byCashier = new Map<string, { name: string; count: number; total: number }>();
    const products = new Map<string, { code: string; name: string; unit: string; quantity: number; total: number }>();
    let total = 0, totalKg = 0, totalUnits = 0;

    for (const s of completed) {
      const t = Number(s.total);
      total += t;

      const day = byDay.get(dateKeyAR(s.createdAt));
      if (day) { day.total += t; day.count++; }

      const hour = Number(s.createdAt.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "numeric", hourCycle: "h23" }));
      byHour[hour].total += t;
      byHour[hour].count++;

      const pm = s.paymentMethod ?? "NONE";
      byPayment[pm] = (byPayment[pm] ?? 0) + t;

      const cashier = s.user?.name ?? "Sin usuario";
      const c = byCashier.get(cashier) ?? { name: cashier, count: 0, total: 0 };
      c.count++; c.total += t;
      byCashier.set(cashier, c);

      for (const i of s.items) {
        const q = Number(i.quantity);
        if (i.unit === "KG") totalKg += q; else totalUnits += q;
        const p = products.get(i.productCode) ?? { code: i.productCode, name: i.productName, unit: i.unit, quantity: 0, total: 0 };
        p.quantity += q;
        p.total += Number(i.subtotal);
        products.set(i.productCode, p);
      }
    }

    return NextResponse.json({
      from,
      to,
      total: r2(total),
      count: completed.length,
      cancelled: sales.length - completed.length,
      avgTicket: completed.length ? r2(total / completed.length) : 0,
      totalKg: r3(totalKg),
      totalUnits: r3(totalUnits),
      byDay: [...byDay.values()].map((d) => ({ ...d, total: r2(d.total) })),
      byHour: byHour.filter((h) => h.count > 0).map((h) => ({ ...h, total: r2(h.total) })),
      byPayment: Object.fromEntries(Object.entries(byPayment).map(([k, v]) => [k, r2(v)])),
      byCashier: [...byCashier.values()].sort((a, b) => b.total - a.total).map((c) => ({ ...c, total: r2(c.total) })),
      topProducts: [...products.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 20)
        .map((p) => ({ ...p, quantity: r3(p.quantity), total: r2(p.total) })),
    });
  } catch (e) {
    return handleError(e);
  }
}
