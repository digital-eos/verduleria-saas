import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, requireUser } from "@/lib/auth";
import { recentlySent, sendVerification } from "@/lib/signup";

export const dynamic = "force-dynamic";

/** POST /api/auth/resend — reenvía el email de verificación al usuario logueado (máx. uno por minuto) */
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser(undefined, { allowUnverified: true });
    if (!me.pendingVerification) return NextResponse.json({ ok: true, alreadyVerified: true });
    if (await recentlySent(me.id)) {
      return NextResponse.json({ error: "Ya te mandamos uno hace un momento. Esperá un minuto y probá de nuevo." }, { status: 429 });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    const mail = await sendVerification(user, req);
    return NextResponse.json({ ok: true, emailSent: mail.sent, devLink: mail.devLink });
  } catch (e) {
    return handleError(e);
  }
}
