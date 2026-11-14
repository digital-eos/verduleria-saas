"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/SessionProvider";

/**
 * Configuración → Pagos (solo admin): conectar la cuenta de Mercado Pago del comercio (OAuth),
 * cargar la dirección (la pide MP para crear la sucursal) y ver el estado de la caja QR.
 */

type MerchantForm = {
  name: string;
  streetName: string;
  streetNumber: string;
  city: string;
  state: string;
  latitude: string;
  longitude: string;
  reference: string;
};

type Status = {
  provider: "mock" | "mercadopago";
  connected: boolean;
  status: "connected" | "revoked" | null;
  nickname: string | null;
  mpUserId: string | null;
  storeReady: boolean;
  posReady: boolean;
  ready: boolean;
  merchant?: MerchantForm & { hasAddress: boolean };
};

const PROVINCES = [
  "Capital Federal", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos",
  "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta",
  "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const EMPTY: MerchantForm = { name: "", streetName: "", streetNumber: "", city: "", state: "", latitude: "", longitude: "", reference: "" };

export default function PagosClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<MerchantForm>(EMPTY);
  const [message, setMessage] = useState<{ type: "error" | "ok" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editAddress, setEditAddress] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/mercadopago/status");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ type: "error", text: data.error ?? "No pudimos leer el estado de Mercado Pago" });
      return;
    }
    setStatus(data);
    if (data.merchant) {
      const { hasAddress: _h, ...m } = data.merchant;
      setForm(m);
    }
  }, []);

  useEffect(() => {
    // Mensajes que deja el callback de OAuth en la URL
    const q = new URLSearchParams(window.location.search);
    if (q.get("error")) setMessage({ type: "error", text: q.get("error")! });
    else if (q.get("needsAddress")) setMessage({ type: "info", text: "¡Cuenta conectada! Completá la dirección del comercio para crear la caja QR." });
    else if (q.get("connected")) setMessage({ type: "ok", text: "¡Cuenta de Mercado Pago conectada!" });
    if (q.toString()) window.history.replaceState(null, "", window.location.pathname);
    void load();
  }, [load]);

  async function disconnect() {
    if (!window.confirm("¿Desconectar Mercado Pago? No vas a poder cobrar con QR hasta volver a conectar.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/mercadopago/disconnect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No pudimos desconectar");
      setMessage({ type: "ok", text: "Mercado Pago desconectado." });
      await load();
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/mercadopago/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No pudimos guardar");
      setMessage({ type: "ok", text: data.posReady ? "Listo: la caja QR está creada." : "Datos del comercio guardados." });
      setEditAddress(false);
      await load();
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof MerchantForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const hasAddress = !!status?.merchant?.hasAddress;
  const showForm = !!status && (editAddress || (status.connected && !status.posReady && !hasAddress));

  return (
    <>
      <p className="muted" style={{ marginBottom: 4 }}>
        <Link href="/configuracion">← Configuración</Link>
      </p>
      <h1>Pagos · Mercado Pago</h1>

      {message && <div className={`msg ${message.type}`}>{message.text}</div>}

      {!status ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          {status.provider === "mock" && (
            <div className="msg info">
              <b>Modo demo:</b> los cobros con QR son simulados y no hace falta conectar nada. Podés conectar la cuenta
              igual; se usa recién cuando el sistema pase a cobros reales.
            </div>
          )}

          <section className="panel" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Cuenta</h2>
            {status.connected ? (
              <>
                <p>
                  ✅ <b>Conectado</b> como <b>{status.nickname ?? `usuario ${status.mpUserId}`}</b>
                </p>
                <ul className="muted">
                  <li>Sucursal en Mercado Pago: {status.storeReady ? "creada ✓" : "pendiente"}</li>
                  <li>Caja QR: {status.posReady ? "creada ✓ — ya podés cobrar desde la Caja" : "pendiente"}</li>
                </ul>
                <div className="row" style={{ maxWidth: 520 }}>
                  {!status.posReady && hasAddress && (
                    <button className="primary" disabled={busy} onClick={() => setEditAddress(true)}>
                      Crear caja QR
                    </button>
                  )}
                  <button className="danger" disabled={busy} onClick={disconnect}>
                    Desconectar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  {status.status === "revoked" ? (
                    <>⚠️ <b>Desconectado.</b> Reconectá tu cuenta de Mercado Pago para volver a cobrar con QR.</>
                  ) : (
                    <>⚪ <b>Desconectado.</b> Conectá la cuenta de Mercado Pago del comercio: el dinero de los cobros con QR va directo ahí.</>
                  )}
                </p>
                {/* Navegación normal (no fetch): la ruta redirige a Mercado Pago */}
                <a className="btn-link" href="/api/mercadopago/connect" style={{ background: "var(--mp-blue)", color: "#fff" }}>
                  Conectar Mercado Pago
                </a>
              </>
            )}
          </section>

          <section className="panel">
            <h2 style={{ marginTop: 0 }}>Datos del comercio</h2>
            {showForm ? (
              <form onSubmit={saveAddress}>
                <p className="muted" style={{ marginTop: 0 }}>
                  Mercado Pago pide la dirección para crear la sucursal. Latitud y longitud: en Google Maps, clic derecho
                  sobre el local → copiar las coordenadas (ej. -34.6037, -58.3816).
                </p>
                <div className="field">
                  <label htmlFor="m-name">Nombre del comercio</label>
                  <input id="m-name" value={form.name} onChange={set("name")} required maxLength={60} />
                </div>
                <div className="grid-2" style={{ marginBottom: 0 }}>
                  <div className="field">
                    <label htmlFor="m-street">Calle</label>
                    <input id="m-street" value={form.streetName} onChange={set("streetName")} required maxLength={100} />
                  </div>
                  <div className="field">
                    <label htmlFor="m-number">Número</label>
                    <input id="m-number" value={form.streetNumber} onChange={set("streetNumber")} required maxLength={10} />
                  </div>
                  <div className="field">
                    <label htmlFor="m-city">Ciudad / barrio</label>
                    <input id="m-city" value={form.city} onChange={set("city")} required maxLength={60} />
                  </div>
                  <div className="field">
                    <label htmlFor="m-state">Provincia</label>
                    <input id="m-state" list="provinces" value={form.state} onChange={set("state")} required maxLength={60} />
                    <datalist id="provinces">
                      {PROVINCES.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </div>
                  <div className="field">
                    <label htmlFor="m-lat">Latitud</label>
                    <input id="m-lat" inputMode="decimal" value={form.latitude} onChange={set("latitude")} required placeholder="-34.6037" />
                  </div>
                  <div className="field">
                    <label htmlFor="m-lng">Longitud</label>
                    <input id="m-lng" inputMode="decimal" value={form.longitude} onChange={set("longitude")} required placeholder="-58.3816" />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="m-ref">Referencia (opcional)</label>
                  <input id="m-ref" value={form.reference} onChange={set("reference")} maxLength={100} placeholder="Frente a la plaza" />
                </div>
                <div className="row" style={{ maxWidth: 520 }}>
                  {hasAddress && (
                    <button type="button" onClick={() => setEditAddress(false)} disabled={busy}>
                      Cancelar
                    </button>
                  )}
                  <button className="primary" type="submit" disabled={busy}>
                    {busy ? "Guardando…" : status.connected && !status.posReady ? "Guardar y crear caja QR" : "Guardar"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  <b>{form.name || "Sin nombre"}</b>
                  <br />
                  <span className="muted">
                    {hasAddress ? `${form.streetName} ${form.streetNumber}, ${form.city}, ${form.state}` : "Sin dirección cargada"}
                  </span>
                </p>
                <button onClick={() => setEditAddress(true)}>Editar datos</button>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
