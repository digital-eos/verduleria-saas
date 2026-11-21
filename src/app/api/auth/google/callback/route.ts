import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { GOOGLE_STATE_COOKIE, googleConfigured, googleProfile } from "@/lib/google";
import { appUrl, createMerchantWithOwner } from "@/lib/signup";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback?code=…&state=…
 * - Cuenta con ese Google → entra.
 * - Cuenta con ese email → se le vincula Google (y queda verificada) → entra.
 * - Ninguna → se crea el comercio con su administrador (ya verificado) → entra.
 */
export async function GET(req: NextRequest) {
  const base = appUrl(req);
  const fail = (code: string) => {
    const res = NextResponse.redirect(`${base}/login?error=${code}`);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };
  if (!googleConfigured()) return fail("google-off");

  const sp = req.nextUrl.searchParams;
  let saved: { state?: string; merchantName?: string; next?: string } = {};
  try {
    saved = JSON.parse(Buffer.from(req.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "", "base64url").toString());
  } catch {
    /* cookie ausente o rota */
  }
  const code = sp.get("code");
  if (!code || !saved.state || saved.state !== sp.get("state")) return fail("google");

  try {
    const g = await googleProfile(base, code);
    if (!g.emailVerified) return fail("google-email");

    let user = await prisma.user.findUnique({ where: { googleId: g.sub } });
    let created = false;
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: g.email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: g.sub,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
            // Si nunca se había verificado, la clave la pudo haber puesto otro con este email: se borra
            ...(byEmail.emailVerifiedAt ? {} : { passwordHash: null }),
          },
        });
      } else {
        user = await createMerchantWithOwner({
          merchantName: saved.merchantName || `Negocio de ${g.name.split(" ")[0]}`,
          name: g.name,
          email: g.email,
          passwordHash: null,
          googleId: g.sub,
          verified: true,
        });
        created = true;
        await audit(user, "SIGNUP", "Merchant", user.merchantId, { email: g.email, con: "Google" });
      }
    }
    if (!user.active) return fail("inactivo");

    await audit(user, "LOGIN", "User", user.id, { con: "Google" });
    const dest = created ? "/caja?bienvenida=1" : saved.next || "/caja";
    const res = NextResponse.redirect(`${base}${dest}`);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return setSessionCookie(res, user);
  } catch (e) {
    console.error("[google callback]", e);
    return fail("google");
  }
}
