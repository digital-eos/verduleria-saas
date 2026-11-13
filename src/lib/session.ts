/**
 * Sesión en cookie firmada (HMAC-SHA256 con AUTH_SECRET).
 * Usa Web Crypto, así que funciona tanto en el middleware (edge) como en las rutas API (node).
 */

export type Role = "ADMIN" | "CASHIER";
export type Session = { uid: number; username: string; name: string; role: Role; exp: number };

export const SESSION_COOKIE = "vs_session";
export const SESSION_TTL = 60 * 60 * 12; // 12 horas

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Falta la variable AUTH_SECRET (mínimo 16 caracteres)");
  }
  return "dev-secret-solo-para-desarrollo-local";
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str: string): Uint8Array<ArrayBuffer> {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey() {
  return crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(data: Omit<Session, "exp">): Promise<string> {
  const payload: Session = { ...data, exp: Math.floor(Date.now() / 1000) + SESSION_TTL };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token?: string | null): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof s.exp !== "number" || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL,
};
