import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { merchantIdFor } from "@/lib/merchant";
import { MIN_PASSWORD, USERNAME_RE, hashPassword, normalizeUsername } from "@/lib/password";

export const dynamic = "force-dynamic";

const publicFields = { id: true, username: true, name: true, role: true, active: true, createdAt: true } as const;

// GET /api/users  (solo admin)
export async function GET() {
  try {
    await requireUser("ADMIN");
    const users = await prisma.user.findMany({ select: publicFields, orderBy: [{ active: "desc" }, { name: "asc" }] });
    return NextResponse.json(users);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/users  { username, name, password, role }
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser("ADMIN");
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername(body.username);
    const name = String(body.name ?? "").trim();
    const password = String(body.password ?? "");
    const role = body.role === "ADMIN" ? "ADMIN" : "CASHIER";

    if (!USERNAME_RE.test(username)) {
      return NextResponse.json({ error: "Usuario: 3 a 30 caracteres (letras, números, . _ -)" }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `La clave debe tener al menos ${MIN_PASSWORD} caracteres` }, { status: 400 });
    }
    if (await prisma.user.findUnique({ where: { username } })) {
      return NextResponse.json({ error: `El usuario "${username}" ya existe` }, { status: 409 });
    }

    const user = await prisma.user.create({
      // Mismo comercio que el admin que lo crea
      data: { username, name, role, passwordHash: hashPassword(password), merchantId: await merchantIdFor(me) },
      select: publicFields,
    });
    await audit(me, "USER_CREATE", "User", user.id, { username, name, role });
    return NextResponse.json(user, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
