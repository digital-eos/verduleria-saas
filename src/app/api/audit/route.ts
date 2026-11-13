import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, requireUser } from "@/lib/auth";
import { DATE_RE, rangeAR, todayAR, addDays } from "@/lib/dates";

export const dynamic = "force-dynamic";

// GET /api/audit?from=AAAA-MM-DD&to=AAAA-MM-DD&action=SALE_CANCEL  (solo admin)
export async function GET(req: NextRequest) {
  try {
    await requireUser("ADMIN");
    const sp = req.nextUrl.searchParams;
    const to = DATE_RE.test(sp.get("to") ?? "") ? sp.get("to")! : todayAR();
    const from = DATE_RE.test(sp.get("from") ?? "") ? sp.get("from")! : addDays(to, -6);
    const action = sp.get("action") || undefined;
    const { start, end } = rangeAR(from, to);

    const logs = await prisma.auditLog.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(action ? { action } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ from, to, logs });
  } catch (e) {
    return handleError(e);
  }
}
