import { NextRequest, NextResponse } from "next/server";
import {
  BadPayload,
  HEARTBEAT_INTERVAL_S,
  authenticateDevice,
  clientIp,
  readJsonBody,
  touchDevice,
} from "@/lib/devices";

export const dynamic = "force-dynamic";

const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * POST /api/devices/heartbeat — "estoy vivo" del equipo (cada `intervalo_s` segundos).
 * Cuerpo (todo opcional): { version, equipo: { clave, firmware, modelo_balanza }, rssi, ip_local,
 *   ventas_pendientes, segundos_encendido }.
 * Respuesta 200: { ok, hora_servidor, intervalo_s, equipo_vinculado }. Más adelante puede traer
 * "ajustes" / "actualizacion": el firmware tiene que ignorar los campos que no conoce.
 */
export async function POST(req: NextRequest) {
  try {
    const device = await authenticateDevice(req.headers);
    if (!device) return NextResponse.json({ ok: false, error: "no_autorizado" }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      if (e instanceof BadPayload) {
        return NextResponse.json({ ok: false, error: "json_invalido", detalle: e.message }, { status: 400 });
      }
      throw e;
    }
    const equipo = typeof body.equipo === "object" && body.equipo !== null ? (body.equipo as Record<string, unknown>) : {};
    const firmware = text(equipo.firmware, 40);
    const scaleModel = text(equipo.modelo_balanza, 80);
    const localIp = text(body.ip_local, 64);

    await touchDevice(device, {
      lastHeartbeatAt: new Date(),
      lastRssi: int(body.rssi, -127, 0),
      pendingCount: int(body.ventas_pendientes, 0, 1_000_000),
      lastIp: localIp ? `${localIp} (pública ${clientIp(req.headers) ?? "?"})` : clientIp(req.headers),
      ...(firmware ? { firmware } : {}),
      ...(scaleModel ? { scaleModel } : {}),
    });

    return NextResponse.json({
      ok: true,
      hora_servidor: new Date().toISOString(),
      intervalo_s: HEARTBEAT_INTERVAL_S,
      equipo_vinculado: device.merchantId !== null,
    });
  } catch (e) {
    console.error("POST /api/devices/heartbeat", e);
    return NextResponse.json({ ok: false, error: "error_servidor" }, { status: 500 });
  }
}
