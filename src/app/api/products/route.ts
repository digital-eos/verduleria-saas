import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toProductDTO } from "@/lib/dto";
import { normalizeCode } from "@/lib/format";
import { handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET /api/products?q=tomate&all=1   (cualquier usuario; "all" solo admin)
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const all = req.nextUrl.searchParams.get("all") === "1" && me.role === "ADMIN";
    const products = await prisma.product.findMany({
      where: {
        ...(all ? {} : { active: true }),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q } }] } : {}),
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json(products.map(toProductDTO));
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/products  { code, name, price, unit: "KG" | "UNIT" }   (solo admin)
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser("ADMIN");
    const body = await req.json().catch(() => null);
    const code = normalizeCode(String(body?.code ?? ""));
    const name = String(body?.name ?? "").trim();
    const price = Number(body?.price);
    const unit = body?.unit === "UNIT" ? "UNIT" : "KG";

    if (!code || !name || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Código, nombre y precio (> 0) son obligatorios" }, { status: 400 });
    }
    if (await prisma.product.findUnique({ where: { code } })) {
      return NextResponse.json({ error: `Ya existe un producto con el código ${code}` }, { status: 409 });
    }
    const product = await prisma.product.create({
      data: { code, name, unit, price: new Prisma.Decimal(price.toFixed(2)) },
    });
    await audit(me, "PRODUCT_CREATE", "Product", product.id, { code, name, unit, price });
    return NextResponse.json(toProductDTO(product), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
