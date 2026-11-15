// Da de alta equipos Libretita (ESP32 de la balanza) en la base de DATABASE_URL.
//   npm run device:create            → 1 equipo
//   npm run device:create -- 20      → 20 equipos
//   APP_URL=https://... npm run device:create   → URL base para el QR de activación
//
// Imprime un CSV por equipo:  cle,secret,code_activation,url_activation
//   - cle + code_activation (+ QR de url_activation) → etiqueta del equipo
//   - cle + secret                                   → se graban en el firmware (el secreto NO va en la etiqueta)
// En la base solo se guarda el SHA-256 del secreto y del código: si se pierde el CSV, no se recuperan.
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // igual que src/lib/devices.ts
const code = (n) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join("");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const count = Math.max(1, Math.min(500, Number(process.argv[2] ?? 1) || 1));
const appUrl = (process.env.APP_URL ?? "https://verduleria-saas-ten.vercel.app").replace(/\/$/, "");
const prisma = new PrismaClient();

console.log("cle,secret,code_activation,url_activation");
for (let i = 0; i < count; i++) {
  for (let attempt = 0; ; attempt++) {
    const key = code(8);
    const secret = randomBytes(32).toString("hex");
    const claimCode = code(6);
    try {
      await prisma.device.create({ data: { key, secretHash: sha256(secret), claimCodeHash: sha256(claimCode) } });
      const url = `${appUrl}/configuracion/equipos?cle=${key}&code=${claimCode}`;
      console.log([key, secret, claimCode, url].join(","));
      break;
    } catch (e) {
      if (e?.code !== "P2002" || attempt > 5) throw e; // clave repetida (muy raro): se genera otra
    }
  }
}
await prisma.$disconnect();
