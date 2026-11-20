import { NextRequest, NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";
import { lookupCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

// GET /api/catalog/7790895000997 → { ean, name, brand, presentation, source } o 404
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    await requireUser();
    const code = decodeURIComponent((await params).code);
    const hit = await lookupCatalog(code);
    if (!hit) return NextResponse.json({ error: "No está en el catálogo" }, { status: 404 });
    return NextResponse.json(hit);
  } catch (e) {
    return handleError(e);
  }
}
