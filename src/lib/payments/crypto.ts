import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de los tokens de Mercado Pago en la base (AES-256-GCM).
 * MP_TOKEN_ENCRYPTION_KEY = 32 bytes en hex (64 caracteres) o en base64.
 *   Generala con:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Formato guardado: "v1:<iv b64>:<tag b64>:<cifrado b64>"
 *
 * SOLO SERVIDOR.
 */

function key(): Buffer {
  const raw = process.env.MP_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("Falta la variable MP_TOKEN_ENCRYPTION_KEY (32 bytes en hex o base64)");
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("Falta la variable MP_TOKEN_ENCRYPTION_KEY válida: tiene que medir 32 bytes");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Token cifrado con formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/* ---------- Valores firmados (cookie del `state` de OAuth) ---------- */

function signingSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("Falta la variable AUTH_SECRET (mínimo 16 caracteres)");
  return "dev-secret-solo-para-desarrollo-local";
}

const b64url = (b: Buffer) => b.toString("base64url");

/** JSON firmado con HMAC-SHA256: "<payload b64url>.<firma b64url>" */
export function signValue(data: object): string {
  const body = b64url(Buffer.from(JSON.stringify(data)));
  const sig = b64url(createHmac("sha256", signingSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySignedValue<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante de dos strings */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
