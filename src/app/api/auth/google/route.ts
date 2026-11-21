import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_STATE_COOKIE, googleAuthUrl, googleConfigured } from "@/lib/google";
import { MAX_MERCHANT_NAME, appUrl } from "@/lib/signup";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google?comercio=Verdulería%20Don%20Juan&next=/caja
 * Manda a Google. `comercio` (opcional) = nombre del negocio si la cuenta es nueva.
 */
export async function GET(req: NextRequest) {
  const base = appUrl(req);
  if (!googleConfigured()) return NextResponse.redirect(`${base}/login?error=google-off`);

  const sp = req.nextUrl.searchParams;
  const next = sp.get("next") ?? "";
  const state = randomBytes(16).toString("hex");
  const payload = {
    state,
    merchantName: (sp.get("comercio") ?? "").trim().slice(0, MAX_MERCHANT_NAME),
    next: next.startsWith("/") && !next.startsWith("//") ? next : "",
  };
  const res = NextResponse.redirect(googleAuthUrl(base, state));
  res.cookies.set(GOOGLE_STATE_COOKIE, Buffer.from(JSON.stringify(payload)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
