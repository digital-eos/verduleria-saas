"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/components/SessionProvider";

/** Nombre del negocio (se ve en los emails y en la sucursal de Mercado Pago). */
export default function MerchantNameForm() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);

  useEffect(() => {
    apiFetch("/api/merchant")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && (setName(m.name), setSaved(m.name)));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await apiFetch("/api/merchant", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg({ type: "error", text: data.error ?? "No se pudo guardar" });
    setSaved(data.name);
    setMsg({ type: "ok", text: "Guardado" });
  }

  return (
    <form className="panel" onSubmit={save} style={{ marginBottom: 12 }}>
      <h2 style={{ margin: "0 0 6px" }}>🏪 Mi negocio</h2>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required style={{ flex: "1 1 220px" }} />
        <button className="primary" disabled={!name.trim() || name.trim() === saved}>Guardar</button>
      </div>
    </form>
  );
}
