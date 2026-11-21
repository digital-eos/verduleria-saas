import { NextRequest, NextResponse } from "next/server";
import { handleError, publicUser, setSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD, hashPassword } from "@/lib/password";
import {
  EMAIL_RE,
  MAX_MERCHANT_NAME,
  createMerchantWithOwner,
  normalizeEmail,
  releaseUnverifiedEmail,
  sendVerification,
} from "@/lib/signup";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register  { merchantName, name, email, password }
 * Crea el comercio y su administrador, manda el email de verificación y deja la sesión iniciada
 * (pendiente de verificación: solo puede ver /verificar hasta confirmar el email).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const merchantName = String(body.merchantName ?? "").trim().slice(0, MAX_MERCHANT_NAME);
    const name = String(body.name ?? "").trim().slice(0, 80);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");

    if (!merchantName) return NextResponse.json({ error: "Poné el nombre de tu negocio" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Poné tu nombre" }, { status: 400 });
    if (!EMAIL_RE.test(email) || email.length > 120) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `La clave debe tener al menos ${MIN_PASSWORD} caracteres` }, { status: 400 });
    }
    if (!(await releaseUnverifiedEmail(email))) {
      return NextResponse.json(
        { error: "Ya hay una cuenta con ese email. Ingresá con tu email y clave (o con Google)." },
        { status: 409 },
      );
    }

    const user = await createMerchantWithOwner({
      merchantName,
      name,
      email,
      passwordHash: hashPassword(password),
      verified: false,
    });
    await audit(user, "SIGNUP", "Merchant", user.merchantId, { comercio: merchantName, email });

    let mail: { sent: boolean; devLink?: string } = { sent: false };
    try {
      mail = await sendVerification(user, req);
    } catch (e) {
      // La cuenta queda creada: desde /verificar se puede reenviar el email
      console.error("[register] no se pudo mandar el email", e);
    }

    const res = NextResponse.json({ ...publicUser(user), emailSent: mail.sent, devLink: mail.devLink }, { status: 201 });
    return setSessionCookie(res, user);
  } catch (e) {
    return handleError(e);
  }
}
