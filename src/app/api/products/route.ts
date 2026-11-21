import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toProductDTO } from "@/lib/dto";
import { QUANTITY_IN_ERROR, normalizeCode, optionalText, parseQuantityIn } from "@/lib/format";
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
        merchantId: me.merchantId,
        ...(all ? {} : { active: true }),
        ...(q ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { brand: { contains: q, mode: "insensitive" } },
                { code: { contains: q } },
              ],
            } : {}),
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json(products.map(toProductDTO));
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/products  { code, name, price? (vacío/null = sin precio), unit: "KG" | "UNIT", quantityIn?, brand?, presentation? }   (solo admin)
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser("ADMIN");
    const body = await req.json().catch(() => null);
    const code = normalizeCode(String(body?.code ?? ""));
    const name = String(body?.name ?? "").trim();
    const noPrice = body?.price === undefined || body?.price === null || String(body.price).trim() === "";
    const price = noPrice ? null : Number(body.price);
    const unit = body?.unit === "UNIT" ? "UNIT" : "KG";
    const quantityIn = parseQuantityIn(body?.quantityIn, unit);
    const brand = optionalText(body?.brand);
    const presentation = optionalText(body?.presentation, 40);

    if (!code || !name) {
      return NextResponse.json({ error: "Código y nombre son obligatorios" }, { status: 400 });
    }
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      return NextResponse.json({ error: "Precio inválido (tiene que ser > 0, o vacío para ponerlo al cobrar)" }, { status: 400 });
    }
    if (quantityIn === undefined) {
      return NextResponse.json({ error: QUANTITY_IN_ERROR }, { status: 400 });
    }
    if (await prisma.product.findUnique({ where: { merchantId_code: { merchantId: me.merchantId, code } } })) {
      return NextResponse.json({ error: `Ya existe un producto con el código ${code}` }, { status: 409 });
    }
    const product = await prisma.product.create({
      data: {
        merchantId: me.merchantId,
        code,
        name,
        brand,
        presentation,
        unit,
        price: price === null ? null : new Prisma.Decimal(price.toFixed(2)),
        quantityIn: quantityIn === null ? null : new Prisma.Decimal(quantityIn),
      },
    });
    await audit(me, "PRODUCT_CREATE", "Product", product.id, { code, name, brand, presentation, unit, price, quantityIn });
    return NextResponse.json(toProductDTO(product), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
