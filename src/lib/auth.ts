import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type Role } from "@/lib/session";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** `merchantId` = comercio del usuario: TODAS las consultas se filtran por él. */
export type AuthUser = {
  id: number;
  username: string;
  name: string;
  role: Role;
  merchantId: number;
  email: string | null;
  /** Tiene email sin verificar: no puede usar la app hasta confirmar */
  pendingVerification: boolean;
};

/** El que se registra con email tiene que confirmarlo; los usuarios creados por un admin no tienen email. */
export const needsVerification = (u: Pick<User, "email" | "emailVerifiedAt">) => !!u.email && !u.emailVerifiedAt;

const toAuthUser = (u: User): AuthUser => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  merchantId: u.merchantId,
  email: u.email,
  pendingVerification: needsVerification(u),
});

/** Usuario logueado. Se valida contra la base, así un usuario desactivado pierde acceso al instante. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await verifySession(token);
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.uid } });
  if (!u || !u.active || u.merchantId !== s.mid) return null;
  return toAuthUser(u);
}

/**
 * Usuario logueado y con el email verificado (o sin email).
 * `allowUnverified` solo para las rutas de verificación (reenviar el email, /me).
 */
export async function requireUser(role?: "ADMIN", opts?: { allowUnverified?: boolean }): Promise<AuthUser> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "Sesión expirada. Volvé a ingresar.");
  if (u.pendingVerification && !opts?.allowUnverified) {
    throw new HttpError(403, "Primero verificá tu email (revisá tu correo)");
  }
  if (role === "ADMIN" && u.role !== "ADMIN") {
    throw new HttpError(403, "Solo un administrador puede hacer esto");
  }
  return u;
}

/** Firma la sesión del usuario y la deja en la cookie de la respuesta. */
export async function setSessionCookie(res: NextResponse, u: User) {
  const token = await signSession({
    uid: u.id,
    mid: u.merchantId,
    username: u.username,
    name: u.name,
    role: u.role,
    ...(needsVerification(u) ? { pv: true } : {}),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  email: u.email,
  pendingVerification: needsVerification(u),
});

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
