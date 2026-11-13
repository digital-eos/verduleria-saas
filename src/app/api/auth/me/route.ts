import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await requireUser());
  } catch (e) {
    return handleError(e);
  }
}
