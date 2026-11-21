import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, requireUser, setSessionCookie } from "@/lib/auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Usuario logueado (también si falta verificar el email).
 * Si verificó el email en otro dispositivo, actualiza la cookie para que ya pueda usar la app.
 */
export async function GET() {
  try {
    const me = await requireUser(undefined, { allowUnverified: true });
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: me.merchantId }, select: { name: true } });
    const res = NextResponse.json({ ...me, merchantName: merchant.name });
    const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    if (s?.pv && !me.pendingVerification) {
      await setSessionCookie(res, await prisma.user.findUniqueOrThrow({ where: { id: me.id } }));
    }
    return res;
  } catch (e) {
    return handleError(e);
  }
}
