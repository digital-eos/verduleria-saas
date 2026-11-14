import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toProductDTO } from "@/lib/dto";
import { QUANTITY_IN_ERROR, normalizeCode, parseQuantityIn } from "@/lib/format";
import { HttpError, handleError, requireUser } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/products/:id  { code?, name?, price?, unit?, active?, quantityIn? (null o "" = sin valor) }   (solo admin)
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const me = await requireUser("ADMIN");
    const id = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "Producto no encontrado");

    const data: Prisma.ProductUpdateInput = {};
    const plain: Record<string, unknown> = {};

    if (body.code !== undefined) plain.code = data.code = normalizeCode(String(body.code));
    if (body.name !== undefined) plain.name = data.name = String(body.name).trim();
    if (body.active !== undefined) plain.active = data.active = Boolean(body.active);
    if (body.unit !== undefined) plain.unit = data.unit = body.unit === "UNIT" ? "UNIT" : "KG";
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, "Precio inválido");
      data.price = new Prisma.Decimal(price.toFixed(2));
      plain.price = price.toFixed(2);
    }
    if (body.quantityIn !== undefined) {
      const unit = (plain.unit as "KG" | "UNIT" | undefined) ?? before.unit;
      const quantityIn = parseQuantityIn(body.quantityIn, unit);
      if (quantityIn === undefined) throw new HttpError(400, QUANTITY_IN_ERROR);
      data.quantityIn = quantityIn === null ? null : new Prisma.Decimal(quantityIn);
      plain.quantityIn = quantityIn === null ? null : String(quantityIn);
    }
    if (plain.code && plain.code !== before.code && (await prisma.product.findUnique({ where: { code: plain.code as string } }))) {
      throw new HttpError(409, "Ese código ya está en uso");
    }

    const product = await prisma.product.update({ where: { id }, data });
    const changes = diff(
      {
        code: before.code,
        name: before.name,
        unit: before.unit,
        active: before.active,
        price: before.price.toFixed(2),
        quantityIn: before.quantityIn === null ? null : String(Number(before.quantityIn)),
      },
      plain,
    );
    if (Object.keys(changes).length) {
      await audit(me, "PRODUCT_UPDATE", "Product", id, { producto: `${before.code} ${before.name}`, ...changes });
    }
    return NextResponse.json(toProductDTO(product));
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/products/:id  -> si tiene ventas, se desactiva en vez de borrarse   (solo admin)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const me = await requireUser("ADMIN");
    const id = Number((await params).id);
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, "Producto no encontrado");
    const used = await prisma.saleItem.count({ where: { productId: id } });
    if (used > 0) {
      await prisma.product.update({ where: { id }, data: { active: false } });
      await audit(me, "PRODUCT_DEACTIVATE", "Product", id, { producto: `${p.code} ${p.name}` });
      return NextResponse.json({ ok: true, deactivated: true });
    }
    await prisma.product.delete({ where: { id } });
    await audit(me, "PRODUCT_DELETE", "Product", id, { producto: `${p.code} ${p.name}` });
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
