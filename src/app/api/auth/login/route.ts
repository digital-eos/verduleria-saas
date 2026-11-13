import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeUsername, verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

// POST /api/auth/login  { username, password }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername(body.username);
    const password = String(body.password ?? "");

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      await audit(null, "LOGIN_FAILED", "User", user?.id ?? null, undefined, username || "-");
      return NextResponse.json({ error: "Usuario o clave incorrectos" }, { status: 401 });
    }

    const token = await signSession({ uid: user.id, username: user.username, name: user.name, role: user.role });
    await audit(user, "LOGIN", "User", user.id);

    const res = NextResponse.json({ id: user.id, username: user.username, name: user.name, role: user.role });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
