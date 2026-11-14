"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/components/SessionProvider";
import { formatDateTime } from "@/lib/format";

type Log = {
  id: number;
  createdAt: string;
  username: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
};

// Duplicado de AUDIT_LABELS (lib/audit.ts es solo servidor)
const LABELS: Record<string, string> = {
  SETUP: "Configuración inicial",
  LOGIN: "Ingreso",
  LOGIN_FAILED: "Ingreso fallido",
  PRODUCT_CREATE: "Producto creado",
  PRODUCT_UPDATE: "Producto modificado",
  PRODUCT_DELETE: "Producto eliminado",
  PRODUCT_DEACTIVATE: "Producto desactivado",
  SALE_CANCEL: "Venta anulada",
  SALE_RESTORE: "Venta restaurada",
  SALE_PAYMENT_CHANGE: "Medio de pago cambiado",
  USER_CREATE: "Usuario creado",
  USER_UPDATE: "Usuario modificado",
  USER_PASSWORD_RESET: "Clave cambiada",
  MP_CONNECT: "Mercado Pago conectado",
  MP_DISCONNECT: "Mercado Pago desconectado",
  MP_SETUP: "Caja de Mercado Pago creada",
};
const IMPORTANT = new Set(["SALE_CANCEL", "PRODUCT_UPDATE", "PRODUCT_DELETE", "LOGIN_FAILED", "USER_PASSWORD_RESET"]);

const todayAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

function renderDetails(d: Record<string, unknown> | null) {
  if (!d) return "";
  return Object.entries(d)
    .map(([k, v]) => {
      if (v && typeof v === "object" && "antes" in v && "despues" in v) {
        const c = v as { antes: unknown; despues: unknown };
        return `${k}: ${c.antes ?? "—"} → ${c.despues ?? "—"}`;
      }
      return `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`;
    })
    .join(" · ");
}

export default function AuditoriaPage() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(todayAR());
  const [action, setAction] = useState("");
  const [hideLogins, setHideLogins] = useState(true);
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ from, to, ...(action ? { action } : {}) });
    apiFetch(`/api/audit?${params}`)
      .then((r) => r.json())
      .then((d) => setLogs(d.logs ?? []));
  }, [from, to, action]);

  const shown = hideLogins && !action ? logs.filter((l) => l.action !== "LOGIN") : logs;

  return (
    <>
      <h1>Auditoría</h1>
      <div className="toolbar">
        <div>
          <label>Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label>Acción</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={hideLogins} onChange={(e) => setHideLogins(e.target.checked)} />
          Ocultar ingresos
        </label>
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(l.createdAt)}</td>
                <td>{l.username}</td>
                <td style={{ whiteSpace: "nowrap", color: IMPORTANT.has(l.action) ? "var(--red)" : undefined }}>
                  {LABELS[l.action] ?? l.action}
                </td>
                <td className="details">{renderDetails(l.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">Sin registros en este período.</p>}
        {logs.length >= 500 && <p className="muted">Se muestran los últimos 500 registros. Acotá el rango.</p>}
      </section>
    </>
  );
}
