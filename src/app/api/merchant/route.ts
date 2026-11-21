import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MAX_MERCHANT_NAME } from "@/lib/signup";

export const dynamic = "force-dynamic";

// GET /api/merchant — el negocio del usuario logueado
export async function GET() {
  try {
    const me = await requireUser();
    const m = await prisma.merchant.findUniqueOrThrow({ where: { id: me.merchantId }, select: { id: true, name: true } });
    return NextResponse.json(m);
  } catch (e) {
    return handleError(e);
  }
}

// PUT /api/merchant  { name }  (solo admin)
export async function PUT(req: NextRequest) {
  try {
    const me = await requireUser("ADMIN");
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim().slice(0, MAX_MERCHANT_NAME);
    if (!name) throw new HttpError(400, "Poné el nombre del negocio");
    const before = await prisma.merchant.findUniqueOrThrow({ where: { id: me.merchantId } });
    const m = await prisma.merchant.update({ where: { id: me.merchantId }, data: { name }, select: { id: true, name: true } });
    if (before.name !== name) {
      await audit(me, "MERCHANT_UPDATE", "Merchant", me.merchantId, { name: { antes: before.name, despues: name } });
    }
    return NextResponse.json(m);
  } catch (e) {
    return handleError(e);
  }
}
