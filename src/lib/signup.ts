import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, verificationEmail } from "@/lib/email";
import { USERNAME_RE } from "@/lib/password";

/**
 * Registro de comercios: el que se registra crea el comercio y queda como su administrador.
 * Con email + clave tiene que confirmar el email (enlace); con Google ya viene verificado.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const MAX_MERCHANT_NAME = 80;

const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** URL pública de la app (para los enlaces de los emails y la vuelta de Google) */
export const appUrl = (req: NextRequest) => (process.env.APP_URL || req.nextUrl.origin).replace(/\/+$/, "");

/** Usuario para ingresar sacado del email ("ana.perez@gmail.com" → "ana.perez", o "ana.perez2" si está tomado) */
export async function uniqueUsername(email: string): Promise<string> {
  let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24);
  if (base.length < 3) base = `${base}usuario`.slice(0, 24);
  if (!USERNAME_RE.test(base)) base = "usuario";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}${randomBytes(3).toString("hex")}`;
}

/**
 * Si el email ya está en una cuenta que NUNCA se verificó, esa cuenta se borra (con su comercio vacío):
 * así nadie puede "reservar" el email de otro registrándose con él.
 * Devuelve true si el email queda libre.
 */
export async function releaseUnverifiedEmail(email: string): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) return true;
  if (existing.emailVerifiedAt) return false;
  const others = await prisma.user.count({ where: { merchantId: existing.merchantId, id: { not: existing.id } } });
  if (others > 0) return false;
  await prisma.merchant.delete({ where: { id: existing.merchantId } });
  return true;
}

export async function createMerchantWithOwner(data: {
  merchantName: string;
  name: string;
  email: string;
  passwordHash: string | null;
  googleId?: string | null;
  verified: boolean;
}): Promise<User> {
  const username = await uniqueUsername(data.email);
  const merchant = await prisma.merchant.create({
    data: {
      name: data.merchantName,
      users: {
        create: {
          username,
          name: data.name,
          email: data.email,
          passwordHash: data.passwordHash,
          googleId: data.googleId ?? null,
          emailVerifiedAt: data.verified ? new Date() : null,
          role: "ADMIN",
        },
      },
    },
    include: { users: true },
  });
  return merchant.users[0];
}

/** Crea el enlace de verificación y manda el email. `sent` = false en desarrollo sin proveedor de email. */
export async function sendVerification(user: User, req: NextRequest): Promise<{ sent: boolean; devLink?: string }> {
  if (!user.email) return { sent: false };
  const token = randomBytes(32).toString("hex");
  await prisma.emailToken.create({
    data: { userId: user.id, tokenHash: sha256(token), purpose: "verify", expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  const link = `${appUrl(req)}/api/auth/verify?token=${token}`;
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: user.merchantId } });
  const sent = await sendEmail(verificationEmail(user.email, user.name, merchant.name, link));
  // En desarrollo sin proveedor, el enlace se devuelve para poder probar
  return sent ? { sent } : { sent, devLink: process.env.NODE_ENV === "production" ? undefined : link };
}

/** ¿Se mandó un enlace hace menos de un minuto? (para no permitir reenviar en loop) */
export async function recentlySent(userId: number) {
  const last = await prisma.emailToken.findFirst({
    where: { userId, purpose: "verify" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return !!last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS;
}

/** Usa el enlace: marca el email como verificado. Devuelve el usuario o null (enlace inválido o vencido). */
export async function consumeVerifyToken(token: string): Promise<User | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.purpose !== "verify" || row.expiresAt < new Date()) return null;
  // Enlace ya usado: si el email está verificado, igual sirve para entrar (doble clic en el email)
  if (row.usedAt) return row.user.emailVerifiedAt ? row.user : null;
  const [, user] = await prisma.$transaction([
    prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() },
    }),
  ]);
  return user;
}
