import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { merchantIdFor } from "@/lib/merchant";
import {
  DEVICE_KEY_RE,
  checkClaimCode,
  claimDevice,
  isOnline,
  normalizeClaimCode,
  normalizeDeviceKey,
} from "@/lib/devices";

export const dynamic = "force-dynamic";

// GET /api/devices  (admin) — equipos del comercio + últimas ventas recibidas
export async function GET() {
  try {
    const me = await requireUser("ADMIN");
    const merchantId = await merchantIdFor(me);
    const [devices, recent] = await Promise.all([
      prisma.device.findMany({ where: { merchantId }, orderBy: { claimedAt: "asc" } }),
      prisma.deviceSale.findMany({
        where: { merchantId },
        orderBy: { receivedAt: "desc" },
        take: 50,
        include: { device: { select: { key: true, label: true } } },
      }),
    ]);
    const now = Date.now();
    return NextResponse.json({
      devices: devices.map((d) => ({
        id: d.id,
        key: d.key,
        label: d.label,
        claimedAt: d.claimedAt,
        firmware: d.firmware,
        scaleModel: d.scaleModel,
        lastSeenAt: d.lastSeenAt,
        lastHeartbeatAt: d.lastHeartbeatAt,
        lastRssi: d.lastRssi,
        pendingCount: d.pendingCount,
        online: isOnline(d, now),
      })),
      recent: recent.map((s) => ({
        id: s.id,
        device: s.device.label || s.device.key,
        receivedAt: s.receivedAt,
        soldAt: s.soldAt,
        ticketNumber: s.ticketNumber,
        total: s.total,
        decoded: s.decoded,
        saleId: s.saleId,
        rawTicket: s.rawTicket,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/devices  { key, code, label? }  (admin) — vincula un equipo al comercio
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser("ADMIN");
    const merchantId = await merchantIdFor(me);
    const body = await req.json().catch(() => ({}));
    const key = normalizeDeviceKey(body.key);
    const code = normalizeClaimCode(body.code);
    const label = String(body.label ?? "").trim().slice(0, 60) || null;

    const device = DEVICE_KEY_RE.test(key) && code ? await prisma.device.findUnique({ where: { key } }) : null;
    if (!device || !checkClaimCode(device, code)) {
      await audit(me, "DEVICE_CLAIM_FAILED", "Device", null, { key });
      return NextResponse.json({ error: "Clave o código de activación incorrectos" }, { status: 400 });
    }
    if (device.merchantId !== null && device.merchantId !== merchantId) {
      return NextResponse.json(
        { error: "Ese equipo ya está vinculado a otro comercio. Pedile que lo desvincule o escribinos." },
        { status: 409 },
      );
    }
    if (device.merchantId === merchantId) {
      return NextResponse.json({ ok: true, alreadyLinked: true, adopted: 0, salesCreated: 0 });
    }

    const result = await claimDevice(device, merchantId, label);
    await audit(me, "DEVICE_CLAIM", "Device", device.id, { key, label, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
