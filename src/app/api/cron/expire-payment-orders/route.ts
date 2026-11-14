import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncPaymentOrder } from "@/lib/payments/service";
import { isMpQrEnabled, mpQrDisabledResponse } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cobros por corrida (cada consulta a MP puede tardar hasta 10 s) */
const BATCH = 50;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * GET /api/cron/expire-payment-orders — con "Authorization: Bearer <CRON_SECRET>".
 * Sincroniza los cobros "created" ya vencidos:
 * se pagaron → se registra la venta; si no → "expired" (ver syncPaymentOrder).
 *
 * DESACTIVADO POR AHORA (se vende solo el producto Balanza, sin cobro con QR).
 * Para activarlo, crear vercel.json en la raíz con (requiere plan Pro de Vercel):
 *
 *   {
 *     "crons": [
 *       { "path": "/api/cron/expire-payment-orders", "schedule": "*\/10 * * * *" }
 *     ]
 *   }
 *
 * y cargar CRON_SECRET en las variables de entorno de Vercel.
 */
export async function GET(req: NextRequest) {
  if (!isMpQrEnabled()) return mpQrDisabledResponse(); // cobro QR apagado (FEATURE_MP_QR)
  // Sin CRON_SECRET (vacío o ausente) nunca queda abierta: authorized() da false → 401
  if (!process.env.CRON_SECRET?.trim()) console.error("[cron expire-payment-orders] falta CRON_SECRET");
  if (!authorized(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const rows = await prisma.paymentOrder.findMany({
    where: { status: "created", mpOrderId: { not: null }, expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: "asc" },
    take: BATCH,
  });

  const byStatus: Record<string, number> = {};
  let errors = 0;
  for (const row of rows) {
    try {
      const order = await syncPaymentOrder(row);
      byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
    } catch (e) {
      errors++;
      console.error(`[cron expire-payment-orders] ${row.mpOrderId}`, e);
    }
  }
  console.log("[cron expire-payment-orders]", { checked: rows.length, byStatus, errors });
  return NextResponse.json({ checked: rows.length, byStatus, errors });
}
