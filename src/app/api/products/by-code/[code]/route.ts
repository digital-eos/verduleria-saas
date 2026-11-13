import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toProductDTO } from "@/lib/dto";
import { normalizeCode } from "@/lib/format";
import { handleError, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/products/by-code/0001
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    await requireUser();
    const code = normalizeCode(decodeURIComponent((await params).code));
    const product = await prisma.product.findUnique({ where: { code } });
    if (!product || !product.active) {
      return NextResponse.json({ error: `No existe el producto ${code}` }, { status: 404 });
    }
    return NextResponse.json(toProductDTO(product));
  } catch (e) {
    return handleError(e);
  }
}
