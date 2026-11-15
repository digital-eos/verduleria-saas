"use client";

/**
 * Configuración → Equipos de balanza (solo admin).
 * El equipo Libretita (ESP32 + WiFi) va enchufado a la salida RS-232 de la balanza y manda cada venta
 * cerrada a la app. Acá se vincula (clave + código de activación de la etiqueta, o su QR) y se ve si
 * está en línea y qué ventas mandó.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/SessionProvider";
import { formatDateTime, formatMoney } from "@/lib/format";

type Device = {
  id: number;
  key: string;
  label: string | null;
  claimedAt: string | null;
  firmware: string | null;
  scaleModel: string | null;
  lastSeenAt: string | null;
  lastRssi: number | null;
  pendingCount: number | null;
  online: boolean;
};

type Received = {
  id: number;
  device: string;
  receivedAt: string;
  soldAt: string;
  ticketNumber: string | null;
  total: string | null;
  decoded: boolean;
  saleId: number | null;
  rawTicket: string;
};

const wifiLabel = (rssi: number | null) =>
  rssi === null ? "—" : `${rssi >= -60 ? "Buena" : rssi >= -75 ? "Regular" : "Débil"} (${rssi} dBm)`;

export default function EquiposPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [recent, setRecent] = useState<Received[]>([]);
  const [form, setForm] = useState({ key: "", code: "", label: "" });
  const [msg, setMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/devices");
    if (!res.ok) return;
    const data = await res.json();
    setDevices(data.devices);
    setRecent(data.recent);
  }, []);

  useEffect(() => {
    // El QR de la etiqueta abre /configuracion/equipos?cle=…&code=…
    const q = new URLSearchParams(window.location.search);
    if (q.get("cle") || q.get("code")) {
      setForm((f) => ({ ...f, key: q.get("cle") ?? "", code: q.get("code") ?? "" }));
      window.history.replaceState(null, "", window.location.pathname);
    }
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ type: "error", text: data.error ?? "No se pudo vincular el equipo" });
      setMsg({
        type: "ok",
        text: data.alreadyLinked
          ? "Ese equipo ya estaba vinculado a tu comercio."
          : `¡Equipo vinculado!${data.adopted ? ` Se sumaron ${data.salesCreated} ventas que había mandado antes.` : ""}`,
      });
      setForm({ key: "", code: "", label: "" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function unlink(d: Device) {
    if (!window.confirm(`¿Desvincular el equipo ${d.label || d.key}? Las ventas que mande después no van a aparecer en tu cuenta.`)) return;
    const res = await apiFetch(`/api/devices/${d.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ type: "error", text: data.error ?? "No se pudo desvincular" });
    await load();
  }

  return (
    <>
      <h1>Equipos de balanza</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        El equipo Libretita va enchufado a la balanza y manda cada venta que cerrás (doble TOTAL) a{" "}
        <Link href="/ventas">Ventas</Link> y a los reportes. <Link href="/configuracion">← Configuración</Link>
      </p>

      <div className="grid-pos">
        <section className="panel">
          <h2>Vincular un equipo</h2>
          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
          <form onSubmit={claim}>
            <div className="field">
              <label>Clave del equipo (en la etiqueta)</label>
              <input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
                placeholder="ej: K7RM2QXA"
                autoCapitalize="characters"
                required
              />
            </div>
            <div className="field">
              <label>Código de activación (en la etiqueta)</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="ej: 7KQM2X"
                autoCapitalize="characters"
                required
              />
            </div>
            <div className="field">
              <label>Nombre (opcional)</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="ej: Balanza del mostrador"
                maxLength={60}
              />
            </div>
            <button className="primary big" type="submit" disabled={busy}>
              {busy ? "Vinculando…" : "Vincular equipo"}
            </button>
            <p className="muted">
              También podés escanear el QR de la etiqueta con el celular. Si el equipo ya mandó ventas antes de
              vincularlo, se suman a tu cuenta con su hora original.
            </p>
          </form>
        </section>

        <section className="panel">
          <h2>Tus equipos</h2>
          {devices.length === 0 ? (
            <p className="muted">Todavía no vinculaste ningún equipo.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Estado</th>
                  <th>WiFi</th>
                  <th>Versión</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.label || d.key}
                      <div className="muted">{d.label ? d.key : ""}{d.scaleModel ? ` · ${d.scaleModel}` : ""}</div>
                    </td>
                    <td>
                      {d.online ? "🟢 En línea" : "⚪ Sin conexión"}
                      <div className="muted">
                        {d.lastSeenAt ? `Visto: ${formatDateTime(d.lastSeenAt)}` : "Nunca se conectó"}
                        {d.pendingCount ? ` · ${d.pendingCount} ventas por enviar` : ""}
                      </div>
                    </td>
                    <td className="muted">{wifiLabel(d.lastRssi)}</td>
                    <td className="muted">{d.firmware ?? "—"}</td>
                    <td className="num">
                      <button className="danger" onClick={() => unlink(d)}>Desvincular</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Últimas ventas recibidas</h2>
        {recent.length === 0 ? (
          <p className="muted">Todavía no llegó ninguna venta.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Hora de la venta</th>
                <th>Equipo</th>
                <th>Ticket</th>
                <th className="num">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.soldAt)}</td>
                  <td>{r.device}</td>
                  <td>{r.ticketNumber ?? "—"}</td>
                  <td className="num">{r.total !== null ? formatMoney(r.total) : "—"}</td>
                  <td>
                    {r.saleId ? "✓ En Ventas" : r.decoded ? "Recibida" : "⚠ No se pudo leer"}
                    <details>
                      <summary className="muted">Ticket original</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "6px 0 0" }}>{r.rawTicket}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
