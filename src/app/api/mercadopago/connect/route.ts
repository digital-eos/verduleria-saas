import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/auth";
import { merchantIdFor } from "@/lib/merchant";
import { signValue } from "@/lib/payments/crypto";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL, authorizationUrl } from "@/lib/payments/oauth";

export const dynamic = "force-dynamic";

export type OAuthStatePayload = { state: string; merchantId: number; uid: number; exp: number };

/**
 * GET /api/mercadopago/connect — botón "Conectar Mercado Pago" (solo admin).
 * Genera un `state` al azar, lo guarda en una cookie httpOnly firmada (atada al comercio y al usuario)
 * y manda al navegador a autorizar la app en Mercado Pago.
 */
export async function GET(req: NextRequest) {
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/configuracion/pagos?error=${encodeURIComponent(error)}`, req.url));
  try {
    const me = await requireUser("ADMIN");
    const merchantId = await merchantIdFor(me);
    const state = randomBytes(24).toString("base64url");
    const url = authorizationUrl(state);

    const payload: OAuthStatePayload = { state, merchantId, uid: me.id, exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL };
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, signValue(payload), {
      httpOnly: true,
      // "lax": la cookie viaja en la redirección de vuelta desde Mercado Pago (navegación GET)
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/mercadopago/callback",
      maxAge: OAUTH_STATE_TTL,
    });
    return res;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return NextResponse.redirect(new URL("/login?next=/configuracion/pagos", req.url));
    console.error("[mercadopago connect]", e);
    return back(e instanceof HttpError || (e instanceof Error && e.message.startsWith("Falta la variable")) ? e.message : "No pudimos iniciar la conexión con Mercado Pago");
  }
}
