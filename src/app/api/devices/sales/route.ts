import { NextRequest, NextResponse } from "next/server";
import {
  BadPayload,
  authenticateDevice,
  clientIp,
  ingestDeviceSale,
  parseIncomingSale,
  readJsonBody,
  touchDevice,
} from "@/lib/devices";

export const dynamic = "force-dynamic";

/**
 * POST /api/devices/sales — venta cerrada en la balanza, enviada por el equipo Libretita.
 * Pública (sin sesión): se autentica con X-Clave-Equipo + Authorization: Bearer <secreto>.
 * Respuestas (las lee el firmware):
 *   200 { ok, estado: "registrada" | "duplicada", ... }  → el equipo borra la venta
 *   400 { ok: false, error: "json_invalido", detalle }   → el equipo la borra (no tiene arreglo)
 *   401 { ok: false, error: "no_autorizado" }            → el equipo la guarda y reintenta
 *   500 { ok: false, error: "error_servidor" }           → el equipo la guarda y reintenta
 */
export async function POST(req: NextRequest) {
  try {
    const device = await authenticateDevice(req.headers);
    if (!device) return NextResponse.json({ ok: false, error: "no_autorizado" }, { status: 401 });

    let inc;
    try {
      inc = parseIncomingSale(await readJsonBody(req));
    } catch (e) {
      if (e instanceof BadPayload) {
        console.warn(`device ${device.key}: venta rechazada (400): ${e.message}`);
        return NextResponse.json({ ok: false, error: "json_invalido", detalle: e.message }, { status: 400 });
      }
      throw e;
    }

    const result = await ingestDeviceSale(device, inc);
    await touchDevice(device, {
      lastIp: clientIp(req.headers),
      ...(inc.firmware ? { firmware: inc.firmware } : {}),
      ...(inc.scaleModel ? { scaleModel: inc.scaleModel } : {}),
    });

    if (result.status === "duplicate") {
      return NextResponse.json({ ok: true, estado: "duplicada", id_evento: inc.eventId });
    }
    return NextResponse.json({
      ok: true,
      estado: "registrada",
      id_evento: inc.eventId,
      decodificada: result.decoded,
      equipo_vinculado: device.merchantId !== null,
      ...(result.idConflict ? { advertencia: "id_evento ya usado para otro ticket" } : {}),
    });
  } catch (e) {
    console.error("POST /api/devices/sales", e);
    return NextResponse.json({ ok: false, error: "error_servidor" }, { status: 500 });
  }
}
