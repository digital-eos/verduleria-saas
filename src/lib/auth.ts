import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/session";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type AuthUser = { id: number; username: string; name: string; role: Role };

/** Usuario logueado. Se valida contra la base, así un usuario desactivado pierde acceso al instante. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await verifySession(token);
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.uid } });
  if (!u || !u.active) return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

export async function requireUser(role?: "ADMIN"): Promise<AuthUser> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "Sesión expirada. Volvé a ingresar.");
  if (role === "ADMIN" && u.role !== "ADMIN") {
    throw new HttpError(403, "Solo un administrador puede hacer esto");
  }
  return u;
}

export function handleError(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2025") return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    if (e.code === "P2002") return NextResponse.json({ error: "Ya existe un registro con ese valor" }, { status: 409 });
  }
  console.error(e);
  if (e instanceof Error && e.message.startsWith("Falta la variable")) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}
