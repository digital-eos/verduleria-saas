import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Hash de contraseña con scrypt (incluido en Node, sin dependencias). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const MIN_PASSWORD = 6;
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const normalizeUsername = (u: unknown) => String(u ?? "").trim().toLowerCase();
