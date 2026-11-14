import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasStoreAddress, merchantIdFor } from "@/lib/merchant";
import { safeEqual, verifySignedValue } from "@/lib/payments/crypto";
import { OAUTH_STATE_COOKIE, exchangeCode, fetchNickname } from "@/lib/payments/oauth";
import { provisionStoreAndPos, saveConnection } from "@/lib/payments/account";
import type { OAuthStatePayload } from "../connect/route";
import { isMpQrEnabled, mpQrDisabledResponse } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/mercadopago/callback?code=...&state=... — Mercado Pago vuelve acá después de autorizar.
 * (Esta URL es MP_REDIRECT_URI y tiene que estar cargada igual en la app de Mercado Pago.)
 * 1. Verifica el `state` contra la cookie firmada.
 * 2. Cambia el `code` por los tokens (POST /oauth/token) y los guarda cifrados.
 * 3. Crea la sucursal y la caja si el comercio ya tiene dirección; si no, la pide en /configuracion/pagos.
 */
export async function GET(req: NextRequest) {
  if (!isMpQrEnabled()) return mpQrDisabledResponse(); // cobro QR apagado (FEATURE_MP_QR)
  const go = (query: string) => {
    const res = NextResponse.redirect(new URL(`/configuracion/pagos?${query}`, req.url));
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/mercadopago/callback", maxAge: 0 });
    return res;
  };
  const fail = (msg: string) => go(`error=${encodeURIComponent(msg)}`);

  const params = req.nextUrl.searchParams;
  // El comercio tocó "Cancelar" en Mercado Pago
  if (params.get("error")) return fail("Cancelaste la conexión con Mercado Pago");

  const code = params.get("code");
  const state = params.get("state");
  const saved = verifySignedValue<OAuthStatePayload>(req.cookies.get(OAUTH_STATE_COOKIE)?.value);
  if (!code || !state || !saved || saved.exp < Date.now() / 1000 || !safeEqual(saved.state, state)) {
    return fail("La conexión venció o no es válida. Probá de nuevo.");
  }

  try {
    const me = await requireUser("ADMIN");
    const merchantId = await merchantIdFor(me);
    if (saved.uid !== me.id || saved.merchantId !== merchantId) {
      return fail("La conexión se inició con otro usuario. Probá de nuevo.");
    }

    const tokens = await exchangeCode(code);
    const nickname = await fetchNickname(tokens.accessToken);
    const account = await saveConnection(merchantId, tokens, nickname);
    await audit(me, "MP_CONNECT", "MercadoPagoAccount", account.id, { mpUserId: tokens.mpUserId, cuenta: nickname });

    // Sucursal + caja: automático si ya tenemos la dirección
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    if (account.posId) return go("connected=1");
    if (!hasStoreAddress(merchant)) return go("connected=1&needsAddress=1");
    try {
      await provisionStoreAndPos(merchantId);
      await audit(me, "MP_SETUP", "MercadoPagoAccount", account.id);
      return go("connected=1");
    } catch (e) {
      // La cuenta quedó conectada; la caja se puede reintentar desde la página
      return go(`connected=1&error=${encodeURIComponent(e instanceof HttpError ? e.message : "No pudimos crear la caja")}`);
    }
  } catch (e) {
    console.error("[mercadopago callback]", e);
    if (e instanceof HttpError && e.status === 401) {
      return NextResponse.redirect(new URL("/login?next=/configuracion/pagos", req.url));
    }
    if (e instanceof HttpError) return fail(e.message);
    if (e instanceof Error && e.message.startsWith("Falta la variable")) return fail(e.message);
    return fail("No pudimos conectar tu cuenta de Mercado Pago. Probá de nuevo.");
  }
}
