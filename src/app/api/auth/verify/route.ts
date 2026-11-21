import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { appUrl, consumeVerifyToken } from "@/lib/signup";

export const dynamic = "force-dynamic";

/** GET /api/auth/verify?token=…  — el enlace del email. Verifica, inicia sesión y manda a la Caja. */
export async function GET(req: NextRequest) {
  const base = appUrl(req);
  try {
    const user = await consumeVerifyToken(req.nextUrl.searchParams.get("token") ?? "");
    if (!user || !user.active) {
      return NextResponse.redirect(`${base}/verificar?error=enlace`);
    }
    await audit(user, "EMAIL_VERIFIED", "User", user.id, { email: user.email });
    return setSessionCookie(NextResponse.redirect(`${base}/caja?bienvenida=1`), user);
  } catch (e) {
    console.error("[verify]", e);
    return NextResponse.redirect(`${base}/verificar?error=enlace`);
  }
}
