import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type Device, type DeviceSale, type SaleUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/format";
import { applyStock } from "@/lib/sales";

/**
 * Equipos Libretita: ESP32 + WiFi enchufado a la salida RS-232 de la balanza (Kretz Novel Eco 2…).
 * Al cerrar una venta en la balanza, el equipo manda el resumen a POST /api/devices/sales.
 *
 * Autenticación del equipo (en cada pedido):
 *   X-Clave-Equipo: K7RM2QXA           → clave pública, impresa en la etiqueta
 *   Authorization: Bearer <secreto>     → 64 hex, grabado en el firmware (acá solo su SHA-256)
 * Vinculación al comercio: el admin carga clave + código de activación (impreso en la etiqueta).
 */

export const DEVICE_KEY_HEADER = "x-clave-equipo";
/** Intervalo sugerido al equipo entre dos "estoy vivo" */
export const HEARTBEAT_INTERVAL_S = 300;
/** Sin noticias del equipo por más de esto = "sin conexión" */
export const ONLINE_WINDOW_MS = (2 * HEARTBEAT_INTERVAL_S + 120) * 1000;
/** Tamaño máximo del cuerpo aceptado (ticket_crudo incluido) */
export const MAX_BODY_BYTES = 256 * 1024;

const MAX_TOTAL = 10_000_000;
/** fecha_hora_equipo se usa solo si cae en [recepción − 30 días, recepción + 5 min] */
const DEVICE_TIME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_TIME_MAX_AHEAD_MS = 5 * 60 * 1000;

// Sin 0/O, 1/I/L, U: se lee y se tipea sin errores
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const DEVICE_KEY_RE = /^[0-9A-Z]{4,32}$/;
const EVENT_ID_RE = /^[\x21-\x7e]{1,100}$/;

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function randomCode(len: number) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Genera las credenciales de un equipo nuevo (las usa scripts/create-device.mjs) */
export function newDeviceCredentials() {
  return { key: randomCode(8), secret: randomBytes(32).toString("hex"), claimCode: randomCode(6) };
}

export const normalizeDeviceKey = (raw: unknown) => String(raw ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
export const normalizeClaimCode = normalizeDeviceKey;

function safeEqualHex(a: string, b: string) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Equipo autenticado por sus encabezados, o null (clave desconocida o secreto incorrecto: misma respuesta) */
export async function authenticateDevice(headers: Headers): Promise<Device | null> {
  const key = normalizeDeviceKey(headers.get(DEVICE_KEY_HEADER));
  const auth = headers.get("authorization") ?? "";
  const secret = auth.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!DEVICE_KEY_RE.test(key) || !secret) return null;
  const device = await prisma.device.findUnique({ where: { key } });
  if (!device) return null;
  return safeEqualHex(sha256(secret), device.secretHash) ? device : null;
}

export const checkClaimCode = (device: Device, code: string) =>
  safeEqualHex(sha256(normalizeClaimCode(code)), device.claimCodeHash);

export const isOnline = (d: Pick<Device, "lastSeenAt">, now = Date.now()) =>
  !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS;

// ---------------------------------------------------------------------------------------------
// Lectura del cuerpo enviado por el equipo
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export class BadPayload extends Error {}

/** Lee el cuerpo crudo como JSON. Tira BadPayload (→ 400) si no es un objeto JSON razonable. */
export async function readJsonBody(req: Request): Promise<Obj> {
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new BadPayload(`cuerpo de más de ${MAX_BODY_BYTES} bytes`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadPayload("JSON inválido");
  }
  if (!isObj(body)) throw new BadPayload("el cuerpo tiene que ser un objeto JSON");
  return body;
}

export type IncomingSale = {
  eventId: string;
  rawTicket: string;
  deviceTime: Date | null;
  firmware: string | null;
  scaleModel: string | null;
  payload: Obj;
};

/** Valida lo mínimo para guardar la venta: id_evento y ticket_crudo. El resto puede venir null. */
export function parseIncomingSale(body: Obj): IncomingSale {
  const eventId = typeof body.id_evento === "string" ? body.id_evento.trim() : "";
  if (!EVENT_ID_RE.test(eventId)) throw new BadPayload("id_evento: texto ASCII de 1 a 100 caracteres, obligatorio");
  if (typeof body.ticket_crudo !== "string") throw new BadPayload("ticket_crudo: texto obligatorio");
  if (body.ticket_crudo.length > 64 * 1024) throw new BadPayload("ticket_crudo: máximo 64 KB");

  let deviceTime: Date | null = null;
  if (typeof body.fecha_hora_equipo === "string") {
    const d = new Date(body.fecha_hora_equipo);
    if (!Number.isNaN(d.getTime())) deviceTime = d;
  }
  const equipo = isObj(body.equipo) ? body.equipo : {};
  return {
    eventId,
    rawTicket: body.ticket_crudo,
    deviceTime,
    firmware: str(equipo.firmware, 40),
    scaleModel: str(equipo.modelo_balanza, 80),
    payload: body,
  };
}

/** Hora de la venta: la del equipo si es plausible (reloj sincronizado), si no la de recepción */
export function pickSoldAt(deviceTime: Date | null, receivedAt: Date): Date {
  if (!deviceTime) return receivedAt;
  const delta = receivedAt.getTime() - deviceTime.getTime();
  return delta <= DEVICE_TIME_MAX_AGE_MS && delta >= -DEVICE_TIME_MAX_AHEAD_MS ? deviceTime : receivedAt;
}

type Line = {
  /** PLU que mandó la balanza (si lo manda): se busca en el catálogo al crear la venta */
  plu?: string | null;
  productCode: string;
  productName: string;
  unit: SaleUnit;
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  subtotal: Prisma.Decimal;
};

const priceLabel = (n: number) =>
  `$${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Lo decodificado de "venta". Si no hay total válido (> 0) → null: la venta queda guardada
 * (ticket_crudo) pero no se suma a Ventas/Reportes.
 * Cada línea pesada lleva el código "BAL-<precio>" para que el ranking de productos del reporte
 * muestre las ventas por precio por kilo.
 */
export function decodeSale(payload: unknown): {
  total: Prisma.Decimal;
  lines: Line[];
  ticketNumber: string | null;
  scaleDate: string | null;
  itemCount: number | null;
} | null {
  const venta = isObj(payload) && isObj(payload.venta) ? payload.venta : null;
  if (!venta) return null;
  const total = num(venta.total);
  const ticketNumber = str(venta.numero_ticket, 40);
  const scaleDate = str(venta.fecha_balanza, 40);
  const nb = num(venta.cantidad_articulos);
  const itemCount = nb !== null && Number.isInteger(nb) && nb >= 0 && nb < 100_000 ? nb : null;
  if (total === null || total <= 0 || total > MAX_TOTAL) return null;

  const lines: Line[] = [];
  const articulos = Array.isArray(venta.articulos) ? venta.articulos : [];
  let ok = articulos.length > 0;
  for (const a of articulos) {
    if (!isObj(a)) { ok = false; break; }
    const q = num(a.cantidad);
    const p = num(a.precio_unitario);
    const st = num(a.subtotal);
    if (q === null || p === null || st === null || q <= 0 || q > 100_000 || p < 0 || p > MAX_TOTAL || Math.abs(st) > MAX_TOTAL) {
      ok = false;
      break;
    }
    const unit: SaleUnit = String(a.unidad ?? "kg").trim().toLowerCase().startsWith("k") ? "KG" : "UNIT";
    const price = Math.round(p * 100) / 100;
    const plu = str(a.plu, 20);
    lines.push({
      plu: plu ? normalizeCode(plu) : null,
      productCode: unit === "KG" ? `BAL-${price}` : `BAL-U-${price}`,
      productName: `Balanza · ${priceLabel(price)}/${unit === "KG" ? "kg" : "u."}`,
      unit,
      unitPrice: new Prisma.Decimal(price.toFixed(2)),
      quantity: new Prisma.Decimal(q.toFixed(3)),
      subtotal: new Prisma.Decimal(st.toFixed(2)),
    });
  }
  // El detalle tiene que cerrar con el total (tolerancia por redondeo de la balanza: 1 % o $10)
  const sum = lines.reduce((acc, l) => acc + Number(l.subtotal), 0);
  if (ok && Math.abs(sum - total) > Math.max(10, total * 0.01)) ok = false;
  if (!ok) {
    // Hay total pero no detalle confiable: una sola línea por el total
    lines.length = 0;
    lines.push({
      productCode: "BAL",
      productName: "Venta en balanza (sin detalle)",
      unit: "UNIT",
      unitPrice: new Prisma.Decimal(total.toFixed(2)),
      quantity: new Prisma.Decimal(1),
      subtotal: new Prisma.Decimal(total.toFixed(2)),
    });
  }
  return { total: new Prisma.Decimal(total.toFixed(2)), lines, ticketNumber, scaleDate, itemCount };
}

/** Crea la Sale (Ventas/Reportes) de una venta de equipo ya guardada, si se puede. */
async function materializeSale(tx: Prisma.TransactionClient, ds: Pick<DeviceSale, "id" | "payload" | "soldAt">) {
  const decoded = decodeSale(ds.payload);
  if (!decoded) return null;

  // Si la balanza mandó el PLU y existe en el catálogo, la línea queda ligada al producto
  // (nombre real, ranking por producto y descuento de la "Cantidad ingresada").
  const plus = [...new Set(decoded.lines.map((l) => l.plu).filter((p): p is string => !!p))];
  const products = plus.length
    ? new Map((await tx.product.findMany({ where: { code: { in: plus } } })).map((p) => [p.code, p]))
    : new Map();
  const items = decoded.lines.map(({ plu, ...l }) => {
    const p = plu ? products.get(plu) : undefined;
    return p ? { ...l, productId: p.id, productCode: p.code, productName: p.name, unit: p.unit } : { ...l, productId: null };
  });

  const sale = await tx.sale.create({
    data: { createdAt: ds.soldAt, total: decoded.total, items: { create: items } },
  });
  await applyStock(tx, items, -1);
  await tx.deviceSale.update({ where: { id: ds.id }, data: { saleId: sale.id } });
  return sale;
}

export type IngestResult =
  | { status: "saved"; deviceSaleId: number; saleId: number | null; decoded: boolean; idConflict: boolean }
  | { status: "duplicate"; deviceSaleId: number };

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Guarda una venta recibida. Idempotente: si (equipo, id_evento) ya existe con el mismo ticket → "duplicate".
 * Si el id ya existe con OTRO ticket (contador del equipo reiniciado), se guarda igual con el id
 * "<id>~<hash>" para no perder la venta (y sigue siendo idempotente si la reenvía).
 */
export async function ingestDeviceSale(device: Device, inc: IncomingSale, receivedAt = new Date()): Promise<IngestResult> {
  let eventId = inc.eventId;
  let idConflict = false;
  const existing = await prisma.deviceSale.findUnique({
    where: { deviceId_eventId: { deviceId: device.id, eventId } },
    select: { id: true, rawTicket: true },
  });
  if (existing) {
    if (existing.rawTicket === inc.rawTicket) return { status: "duplicate", deviceSaleId: existing.id };
    eventId = `${inc.eventId}~${sha256(inc.rawTicket).slice(0, 8)}`;
    idConflict = true;
    const again = await prisma.deviceSale.findUnique({
      where: { deviceId_eventId: { deviceId: device.id, eventId } },
      select: { id: true },
    });
    if (again) return { status: "duplicate", deviceSaleId: again.id };
  }

  const decoded = decodeSale(inc.payload);
  const soldAt = pickSoldAt(inc.deviceTime, receivedAt);
  try {
    return await prisma.$transaction(async (tx) => {
      const ds = await tx.deviceSale.create({
        data: {
          eventId,
          deviceId: device.id,
          merchantId: device.merchantId,
          receivedAt,
          soldAt,
          deviceTime: inc.deviceTime,
          scaleDate: decoded?.scaleDate ?? null,
          ticketNumber: decoded?.ticketNumber ?? null,
          itemCount: decoded?.itemCount ?? null,
          total: decoded?.total ?? null,
          decoded: !!decoded,
          rawTicket: inc.rawTicket,
          payload: inc.payload as Prisma.InputJsonObject,
        },
      });
      const sale = device.merchantId ? await materializeSale(tx, ds) : null;
      return { status: "saved" as const, deviceSaleId: ds.id, saleId: sale?.id ?? null, decoded: !!decoded, idConflict };
    });
  } catch (e) {
    // Dos reenvíos simultáneos de la misma venta: el segundo choca con el índice único
    if (isUniqueViolation(e)) {
      const ds = await prisma.deviceSale.findUnique({ where: { deviceId_eventId: { deviceId: device.id, eventId } } });
      if (ds) return { status: "duplicate", deviceSaleId: ds.id };
    }
    throw e;
  }
}

/**
 * Vincula el equipo al comercio y le asigna las ventas que llegaron antes de vincularlo
 * (las crea en Ventas/Reportes con su hora original).
 */
export async function claimDevice(device: Device, merchantId: number, label: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.device.update({
      where: { id: device.id },
      data: { merchantId, claimedAt: new Date(), ...(label !== null ? { label } : {}) },
    });
    const pending = await tx.deviceSale.findMany({
      where: { deviceId: device.id, merchantId: null },
      select: { id: true, payload: true, soldAt: true },
      orderBy: { id: "asc" },
    });
    let created = 0;
    for (const ds of pending) {
      await tx.deviceSale.update({ where: { id: ds.id }, data: { merchantId } });
      if (await materializeSale(tx, ds)) created++;
    }
    return { adopted: pending.length, salesCreated: created };
  }, { timeout: 30_000 });
}

/** Actualiza "visto por última vez" y datos informativos del equipo (nunca rompe la recepción) */
export async function touchDevice(device: Device, data: Prisma.DeviceUpdateInput) {
  try {
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...data } });
  } catch (e) {
    console.error("touchDevice", e);
  }
}

export const clientIp = (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || null;
