"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/components/SessionProvider";
import { PAYMENT_LABELS, type Payment } from "@/lib/dto";
import { formatKg, formatMoney, formatQty } from "@/lib/format";

type Report = {
  from: string;
  to: string;
  total: number;
  count: number;
  cancelled: number;
  avgTicket: number;
  totalKg: number;
  totalUnits: number;
  byDay: { date: string; total: number; count: number }[];
  byHour: { hour: number; total: number; count: number }[];
  byPayment: Record<string, number>;
  byCashier: { name: string; count: number; total: number }[];
  topProducts: { code: string; name: string; unit: "KG" | "UNIT"; quantity: number; total: number }[];
};

const TZ = "America/Argentina/Buenos_Aires";
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: TZ });
const monthStart = () => day().slice(0, 8) + "01";
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const paymentLabel = (k: string) => (k === "NONE" ? "Sin especificar" : PAYMENT_LABELS[k as Payment] ?? k);

const PRESETS = [
  { label: "Hoy", range: () => [day(), day()] },
  { label: "Ayer", range: () => [day(-1), day(-1)] },
  { label: "7 días", range: () => [day(-6), day()] },
  { label: "30 días", range: () => [day(-29), day()] },
  { label: "Este mes", range: () => [monthStart(), day()] },
];

function Bars({ data, label }: { data: { key: string; value: number; title: string }[]; label: (k: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const every = Math.ceil(data.length / 15); // no saturar etiquetas
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div className="bar-col" key={d.key} title={d.title}>
          <div className="bar" style={{ height: `${(d.value / max) * 100}%` }} />
          <span className="lbl">{i % every === 0 ? label(d.key) : " "}</span>
        </div>
      ))}
    </div>
  );
}

export default function SalesReport() {
  const [from, setFrom] = useState(day(-6));
  const [to, setTo] = useState(day());
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    apiFetch(`/api/reports?from=${from}&to=${to}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        setR(d);
      })
      .catch((e) => setError(e.message));
  }, [from, to]);

  const payments = Object.entries(r?.byPayment ?? {}).sort((a, b) => b[1] - a[1]);
  const maxProduct = Math.max(1, ...(r?.topProducts.map((p) => p.total) ?? [1]));

  return (
    <>
      <div className="toolbar">
        <div>
          <label>Desde</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>Hasta</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => { const [a, b] = p.range(); setFrom(a); setTo(b); }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="msg error">{error}</div>}

      {r && (
        <>
          <div className="stats">
            <div className="panel stat"><div className="muted">Facturación</div><div className="v">{formatMoney(r.total)}</div></div>
            <div className="panel stat"><div className="muted">Ventas</div><div className="v">{r.count}</div></div>
            <div className="panel stat"><div className="muted">Ticket promedio</div><div className="v">{formatMoney(r.avgTicket)}</div></div>
            <div className="panel stat"><div className="muted">Kilos</div><div className="v">{formatKg(r.totalKg)}</div></div>
            <div className="panel stat"><div className="muted">Unidades</div><div className="v">{r.totalUnits}</div></div>
            <div className="panel stat"><div className="muted">Anuladas</div><div className="v">{r.cancelled}</div></div>
          </div>

          {r.byDay.length > 1 && (
            <section className="panel" style={{ marginBottom: 16 }}>
              <h2>Facturación por día</h2>
              <Bars
                data={r.byDay.map((d) => ({ key: d.date, value: d.total, title: `${shortDate(d.date)}: ${formatMoney(d.total)} · ${d.count} ventas` }))}
                label={shortDate}
              />
            </section>
          )}

          <div className="grid-2">
            <section className="panel">
              <h2>Productos más vendidos</h2>
              <table>
                <tbody>
                  {r.topProducts.map((p) => (
                    <tr key={p.code}>
                      <td style={{ width: "45%" }}>
                        {p.name}
                        <div className="hbar"><span style={{ width: `${(p.total / maxProduct) * 100}%` }} /></div>
                      </td>
                      <td className="num">{formatQty(p.quantity, p.unit)}</td>
                      <td className="num">{formatMoney(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.topProducts.length === 0 && <p className="muted">Sin ventas en el período.</p>}
            </section>

            <div>
              <section className="panel" style={{ marginBottom: 16 }}>
                <h2>Por medio de pago</h2>
                <table>
                  <tbody>
                    {payments.map(([k, v]) => (
                      <tr key={k}>
                        <td>{paymentLabel(k)}</td>
                        <td className="num">{r.total ? Math.round((v / r.total) * 100) : 0}%</td>
                        <td className="num">{formatMoney(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="panel">
                <h2>Por cajero</h2>
                <table>
                  <tbody>
                    {r.byCashier.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="num">{c.count} ventas</td>
                        <td className="num">{formatMoney(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>

          {r.byHour.length > 0 && (
            <section className="panel">
              <h2>Ventas por hora</h2>
              <Bars
                data={r.byHour.map((h) => ({ key: String(h.hour), value: h.total, title: `${h.hour}h: ${formatMoney(h.total)} · ${h.count} ventas` }))}
                label={(k) => `${k}h`}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
