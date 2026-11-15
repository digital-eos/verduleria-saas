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
 * Pública (sin sesión): se autentica con X-Cle-Boitier + Authorization: Bearer <secreto>.
 * Las respuestas están en francés porque las lee el firmware (contrato acordado con el equipo):
 *   200 { ok, statut: "enregistree" | "doublon", ... }  → el equipo borra la venta
 *   400 { ok: false, erreur: "json_invalide", detail }  → el equipo la borra (no tiene arreglo)
 *   401 { ok: false, erreur: "non_autorise" }           → el equipo la guarda y reintenta
 *   500 { ok: false, erreur: "erreur_serveur" }         → el equipo la guarda y reintenta
 */
export async function POST(req: NextRequest) {
  try {
    const device = await authenticateDevice(req.headers);
    if (!device) return NextResponse.json({ ok: false, erreur: "non_autorise" }, { status: 401 });

    let inc;
    try {
      inc = parseIncomingSale(await readJsonBody(req));
    } catch (e) {
      if (e instanceof BadPayload) {
        console.warn(`device ${device.key}: venta rechazada (400): ${e.message}`);
        return NextResponse.json({ ok: false, erreur: "json_invalide", detail: e.message }, { status: 400 });
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
      return NextResponse.json({ ok: true, statut: "doublon", id_evenement: inc.eventId });
    }
    return NextResponse.json({
      ok: true,
      statut: "enregistree",
      id_evenement: inc.eventId,
      decodee: result.decoded,
      boitier_rattache: device.merchantId !== null,
      ...(result.idConflict ? { avertissement: "id_evenement deja utilise pour un autre ticket" } : {}),
    });
  } catch (e) {
    console.error("POST /api/devices/sales", e);
    return NextResponse.json({ ok: false, erreur: "erreur_serveur" }, { status: 500 });
  }
}
