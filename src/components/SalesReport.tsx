"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/components/SessionProvider";
import { PAYMENT_LABELS, type Payment } from "@/lib/dto";
import { formatKg, formatMoney, formatQty } from "@/lib/format";
import { addDays, addMonths, monthEnd, weekStart } from "@/lib/dates";

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
  scale: ScaleInsights;
};

type ScaleRow = {
  price: number;
  kg: number;
  total: number;
  lines: number;
  matchedLines: number;
  share: number;
  peakHour: number | null;
  kgByHour: number[];
  candidates: { id: number; name: string; lines: number }[];
  match: "identificado" | "ambiguo" | "sin_producto";
};
type ScaleInsights = { kg: number; total: number; lines: number; kgByHour: number[]; peakHour: number | null; byPrice: ScaleRow[] };

const TZ = "America/Argentina/Buenos_Aires";
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: TZ });
const monthStart = () => day().slice(0, 8) + "01";
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const paymentLabel = (k: string) => (k === "NONE" ? "Sin especificar" : PAYMENT_LABELS[k as Payment] ?? k);

const PRESETS = [
  { label: "Hoy", range: () => [day(), day()] },
  { label: "Ayer", range: () => [day(-1), day(-1)] },
  { label: "Esta semana", range: () => [weekStart(day()), day()] },
  { label: "Semana pasada", range: () => [addDays(weekStart(day()), -7), addDays(weekStart(day()), -1)] },
  { label: "7 días", range: () => [day(-6), day()] },
  { label: "Este mes", range: () => [monthStart(), day()] },
  { label: "Mes pasado", range: () => { const m = addMonths(day(), -1); return [m, monthEnd(m)]; } },
  { label: "30 días", range: () => [day(-29), day()] },
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

const pricePerKg = (p: number) => `${formatMoney(p)}/kg`;
const hourRange = (h: number) => `${h}h a ${h + 1}h`;

/** "Tomate", "Papa o Cebolla", "Sin producto con ese precio" */
function guessName(r: ScaleRow) {
  if (r.match === "identificado") return r.candidates[0].name;
  if (r.match === "ambiguo") {
    const names = r.candidates.slice(0, 3).map((c) => c.name);
    return names.join(" o ") + (r.candidates.length > 3 ? "…" : "");
  }
  return null;
}

function ScaleName({ r }: { r: ScaleRow }) {
  const name = guessName(r);
  return (
    <>
      <strong>{pricePerKg(r.price)}</strong>
      {" · "}
      {name ? (
        <span title={r.match === "ambiguo" ? "Varios productos tenían este precio por kilo" : "Único producto por kilo con este precio"}>
          {r.match === "ambiguo" ? `¿${name}?` : name}
          {r.matchedLines < r.lines && <span className="muted"> (en {r.matchedLines} de {r.lines} ventas)</span>}
        </span>
      ) : (
        <span className="muted">sin producto con ese precio</span>
      )}
    </>
  );
}

/** Ventas de balanza sin producto: ranking por precio por kilo + mapa de calor por hora */
function ScaleSection({ s }: { s: ScaleInsights }) {
  const [showAll, setShowAll] = useState(false);
  if (s.lines === 0) return null;
  const top = s.byPrice[0];
  const least = s.byPrice.length > 1 ? s.byPrice[s.byPrice.length - 1] : null;
  const identified = s.byPrice.filter((r) => r.match === "identificado").reduce((a, r) => a + r.kg, 0);
  const rows = showAll ? s.byPrice : s.byPrice.slice(0, 12);

  // Columnas del mapa de calor: de la primera a la última hora con ventas
  const used = s.kgByHour.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
  const hours = used.length ? Array.from({ length: used[used.length - 1] - used[0] + 1 }, (_, i) => used[0] + i) : [];

  return (
    <section className="panel scale-section" style={{ marginBottom: 16 }}>
      <h2>Balanza: qué se vende y a qué hora</h2>
      <p className="muted small">
        Las balanzas mandan el precio por kilo, no el producto. Lo deducimos comparando ese precio con el que tenía cada producto
        por kilo en el momento de la venta. Con un solo producto a ese precio queda identificado; con varios, se muestran todos.
        {s.kg > 0 && <> Identificado: {Math.round((identified / s.kg) * 100)}% de los kilos.</>}
      </p>

      <div className="stats">
        <div className="panel stat">
          <div className="muted">Más vendido</div>
          <div className="v">{formatKg(top.kg)}</div>
          <div className="small"><ScaleName r={top} /></div>
        </div>
        {least && (
          <div className="panel stat">
            <div className="muted">Menos vendido</div>
            <div className="v">{formatKg(least.kg)}</div>
            <div className="small"><ScaleName r={least} /></div>
          </div>
        )}
        <div className="panel stat">
          <div className="muted">Hora pico en balanza</div>
          <div className="v">{s.peakHour === null ? "—" : hourRange(s.peakHour)}</div>
          <div className="small muted">{formatKg(s.kg)} pesados · {formatMoney(s.total)}</div>
        </div>
      </div>

      <div className="heat-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th>Precio por kilo · producto</th>
              <th className="num">Kilos</th>
              <th className="num">$</th>
              <th className="num">Pico</th>
              {hours.map((h) => (
                <th key={h} className="heat-h">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const max = Math.max(...r.kgByHour);
              return (
                <tr key={r.price}>
                  <td className="heat-name">
                    <ScaleName r={r} />
                    <div className="hbar"><span style={{ width: `${(r.kg / top.kg) * 100}%` }} /></div>
                  </td>
                  <td className="num">{formatKg(r.kg)}</td>
                  <td className="num">{formatMoney(r.total)}</td>
                  <td className="num">{r.peakHour === null ? "—" : `${r.peakHour}h`}</td>
                  {hours.map((h) => {
                    const v = r.kgByHour[h];
                    const level = v > 0 ? 0.15 + 0.85 * (v / max) : 0;
                    return (
                      <td
                        key={h}
                        className={v > 0 ? "heat-cell" : "heat-cell empty"}
                        title={`${pricePerKg(r.price)} · ${hourRange(h)}: ${formatKg(v)}`}
                        style={{ ["--lvl" as string]: level }}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Cada fila se colorea según su propia hora pico (más oscuro = más kilos en esa hora).</p>
      {s.byPrice.length > 12 && (
        <button className="linklike" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Ver menos" : `Ver los ${s.byPrice.length} precios`}
        </button>
      )}
    </section>
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

          {r.scale && <ScaleSection s={r.scale} />}

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
