import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, handleError, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { merchantIdFor } from "@/lib/merchant";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/devices/:id  (admin) — desvincula el equipo del comercio.
 * Las ventas ya recibidas quedan en el comercio; las nuevas quedan sin asignar hasta que alguien lo vincule.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser("ADMIN");
    const id = Number((await params).id);
    const device = Number.isInteger(id) ? await prisma.device.findUnique({ where: { id } }) : null;
    if (!device || device.merchantId !== (await merchantIdFor(me))) throw new HttpError(404, "Equipo no encontrado");
    await prisma.device.update({ where: { id }, data: { merchantId: null, claimedAt: null } });
    await audit(me, "DEVICE_UNLINK", "Device", id, { key: device.key, label: device.label });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
