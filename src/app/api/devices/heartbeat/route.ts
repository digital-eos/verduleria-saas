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
 * POST /api/devices/heartbeat — "estoy vivo" del equipo (cada `intervalle_s` segundos).
 * Cuerpo (todo opcional): { version, boitier: { cle, firmware, modele_balance }, rssi, ip_locale,
 *   ventes_en_attente, uptime_s }.
 * Respuesta 200: { ok, heure_serveur, intervalle_s, boitier_rattache }. Más adelante puede traer
 * "reglages" / "mise_a_jour": el firmware tiene que ignorar los campos que no conoce.
 */
export async function POST(req: NextRequest) {
  try {
    const device = await authenticateDevice(req.headers);
    if (!device) return NextResponse.json({ ok: false, erreur: "non_autorise" }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      if (e instanceof BadPayload) {
        return NextResponse.json({ ok: false, erreur: "json_invalide", detail: e.message }, { status: 400 });
      }
      throw e;
    }
    const boitier = typeof body.boitier === "object" && body.boitier !== null ? (body.boitier as Record<string, unknown>) : {};
    const firmware = text(boitier.firmware, 40);
    const scaleModel = text(boitier.modele_balance, 80);
    const localIp = text(body.ip_locale, 64);

    await touchDevice(device, {
      lastHeartbeatAt: new Date(),
      lastRssi: int(body.rssi, -127, 0),
      pendingCount: int(body.ventes_en_attente, 0, 1_000_000),
      lastIp: localIp ? `${localIp} (pública ${clientIp(req.headers) ?? "?"})` : clientIp(req.headers),
      ...(firmware ? { firmware } : {}),
      ...(scaleModel ? { scaleModel } : {}),
    });

    return NextResponse.json({
      ok: true,
      heure_serveur: new Date().toISOString(),
      intervalle_s: HEARTBEAT_INTERVAL_S,
      boitier_rattache: device.merchantId !== null,
    });
  } catch (e) {
    console.error("POST /api/devices/heartbeat", e);
    return NextResponse.json({ ok: false, erreur: "erreur_serveur" }, { status: 500 });
  }
}
