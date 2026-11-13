import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD, USERNAME_RE, hashPassword, normalizeUsername } from "@/lib/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Primer uso: si no hay ningún usuario, se permite crear el administrador inicial.
 * En cuanto existe un usuario, este endpoint queda bloqueado.
 */
export async function GET() {
  try {
    const count = await prisma.user.count();
    return NextResponse.json({ needsSetup: count === 0 });
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/auth/setup  { name, username, password }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername(body.username);
    const name = String(body.name ?? "").trim();
    const password = String(body.password ?? "");

    if (!USERNAME_RE.test(username)) {
      return NextResponse.json({ error: "Usuario: 3 a 30 caracteres (letras, números, . _ -)" }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `La clave debe tener al menos ${MIN_PASSWORD} caracteres` }, { status: 400 });
    }

    const user = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) return null;
      return tx.user.create({ data: { username, name, passwordHash: hashPassword(password), role: "ADMIN" } });
    });
    if (!user) {
      return NextResponse.json({ error: "La configuración inicial ya fue realizada" }, { status: 409 });
    }

    await audit(user, "SETUP", "User", user.id);
    const token = await signSession({ uid: user.id, username: user.username, name: user.name, role: user.role });
    const res = NextResponse.json({ id: user.id, username, name, role: user.role }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
