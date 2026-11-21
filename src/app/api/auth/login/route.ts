import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, publicUser, setSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeUsername, verifyPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/signup";

// POST /api/auth/login  { username, password }   — `username` puede ser el usuario o el email
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const login = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const byEmail = login.includes("@");
    const key = byEmail ? normalizeEmail(login) : normalizeUsername(login);

    const user = key
      ? await prisma.user.findUnique({ where: byEmail ? { email: key } : { username: key } })
      : null;
    if (user && user.active && !user.passwordHash) {
      return NextResponse.json({ error: "Esta cuenta entra con Google: tocá «Continuar con Google»" }, { status: 401 });
    }
    if (!user || !user.active || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      await audit(null, "LOGIN_FAILED", "User", user?.id ?? null, undefined, key || "-", user?.merchantId ?? null);
      return NextResponse.json({ error: "Usuario o clave incorrectos" }, { status: 401 });
    }

    await audit(user, "LOGIN", "User", user.id);
    return setSessionCookie(NextResponse.json(publicUser(user)), user);
  } catch (e) {
    return handleError(e);
  }
}
