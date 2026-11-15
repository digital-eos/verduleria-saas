"use client";

import { Fragment, useEffect, useState } from "react";
import { PAYMENT_LABELS, PAYMENT_METHODS, type Payment, type SaleDTO } from "@/lib/dto";
import { formatDateTime, formatKg, formatMoney, formatQty, formatUnitPrice } from "@/lib/format";
import { apiFetch, useIsAdmin } from "@/components/SessionProvider";
import SalesReport from "@/components/SalesReport";
import { DATE_RE, type Period, periodRange, shiftPeriod, todayAR, weekdayOf } from "@/lib/dates";

type Summary = {
  from: string;
  to: string;
  count: number;
  total: number;
  totalKg: number;
  totalUnits: number;
  byPayment: Record<string, number>;
  sales: SaleDTO[];
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const PERIODS: { key: Period; label: string; total: string; empty: string; current: string }[] = [
  { key: "dia", label: "Día", total: "Total del día", empty: "No hay ventas este día.", current: "Hoy" },
  { key: "semana", label: "Semana", total: "Total de la semana", empty: "No hay ventas esta semana.", current: "Esta semana" },
  { key: "mes", label: "Mes", total: "Total del mes", empty: "No hay ventas este mes.", current: "Este mes" },
];
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

/** "Lunes 10/11/2026", "10/11 al 16/11/2026", "Noviembre 2026" */
function periodTitle(period: Period, from: string, to: string) {
  if (period === "mes") {
    const m = MONTHS[Number(from.slice(5, 7)) - 1];
    return `${m[0].toUpperCase()}${m.slice(1)} ${from.slice(0, 4)}`;
  }
  if (period === "semana") return `${shortDate(from)} al ${shortDate(to)}/${to.slice(0, 4)}`;
  return `${WEEKDAYS[weekdayOf(from)]} ${shortDate(from)}/${from.slice(0, 4)}`;
}
const paymentLabel = (k: string) => (k === "NONE" ? "Sin especificar" : PAYMENT_LABELS[k as Payment] ?? k);

type View = "dia" | "reporte";

export default function VentasPage() {
  const isAdmin = useIsAdmin();
  const [view, setView] = useState<View>("dia");

  // La pestaña se refleja en la URL (?vista=reporte) para poder volver o compartir el link
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("vista") === "reporte") setView("reporte");
  }, []);

  function changeView(v: View) {
    setView(v);
    const url = new URL(window.location.href);
    if (v === "reporte") url.searchParams.set("vista", "reporte");
    else url.searchParams.delete("vista");
    window.history.replaceState(null, "", url);
  }

  if (!isAdmin) return <DailySales isAdmin={false} />;

  return (
    <>
      <h1 style={{ marginBottom: 8 }}>Ventas</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === "dia"} className={view === "dia" ? "active" : ""} onClick={() => changeView("dia")}>
          Ventas
        </button>
        <button role="tab" aria-selected={view === "reporte"} className={view === "reporte" ? "active" : ""} onClick={() => changeView("reporte")}>
          Reporte
        </button>
      </div>
      {view === "reporte" ? <SalesReport /> : <DailySales isAdmin />}
    </>
  );
}

function DailySales({ isAdmin }: { isAdmin: boolean }) {
  const today = todayAR();
  const [period, setPeriod] = useState<Period>("dia");
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const { from, to } = periodRange(period, anchor);
  const meta = PERIODS.find((p) => p.key === period)!;
  const isCurrent = from <= today && today <= to;

  // El período elegido se refleja en la URL (?periodo=semana&fecha=2026-11-10)
  useEffect(() => {
    if (!isAdmin) return;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("periodo");
    if (p === "semana" || p === "mes") setPeriod(p);
    const f = sp.get("fecha") ?? "";
    if (DATE_RE.test(f) && f <= today) setAnchor(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function go(p: Period, a: string) {
    const next = a > today ? today : a;
    setPeriod(p);
    setAnchor(next);
    setOpen(null);
    const url = new URL(window.location.href);
    if (p === "dia") url.searchParams.delete("periodo"); else url.searchParams.set("periodo", p);
    if (next === today) url.searchParams.delete("fecha"); else url.searchParams.set("fecha", next);
    window.history.replaceState(null, "", url);
  }

  async function load() {
    setError("");
    const res = await apiFetch(`/api/sales?from=${from}&to=${to}`);
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? "Error"); return; }
    setData(d);
  }
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desglose por día (semana / mes)
  const byDay = new Map<string, { count: number; total: number }>();
  if (period !== "dia")
    for (const s of data?.sales ?? []) {
      if (s.status !== "COMPLETED") continue;
      const k = dayKey(s.createdAt);
      const d = byDay.get(k) ?? { count: 0, total: 0 };
      d.count++;
      d.total += s.total;
      byDay.set(k, d);
    }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const bestDay = Math.max(1, ...days.map(([, d]) => d.total));

  async function patch(s: SaleDTO, body: object) {
    const res = await apiFetch(`/api/sales/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) alert((await res.json()).error ?? "Error");
    load();
  }

  function exportCsv() {
    if (!data) return;
    const rows = [["venta", "fecha", "estado", "cajero", "medio_pago", "codigo", "producto", "unidad", "precio", "cantidad", "subtotal"]];
    for (const s of data.sales)
      for (const i of s.items)
        rows.push([
          String(s.id), s.createdAt, s.status, s.cashier ?? "", s.paymentMethod ?? "", i.productCode, i.productName,
          i.unit, String(i.unitPrice), String(i.quantity), String(i.subtotal),
        ]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: from === to ? `ventas-${from}.csv` : `ventas-${from}_a_${to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const payments = Object.entries(data?.byPayment ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {isAdmin ? (
        <div className="period-bar">
          <div className="seg" role="group" aria-label="Período">
            {PERIODS.map((p) => (
              <button key={p.key} className={period === p.key ? "active" : ""} aria-pressed={period === p.key} onClick={() => go(p.key, anchor)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="period-nav">
            <button aria-label="Período anterior" onClick={() => go(period, shiftPeriod(period, from, -1))}>‹</button>
            <strong>{periodTitle(period, from, to)}</strong>
            <button aria-label="Período siguiente" disabled={to >= today} onClick={() => go(period, shiftPeriod(period, from, 1))}>›</button>
          </div>
          <input type="date" aria-label="Ir a una fecha" value={anchor} max={today} onChange={(e) => e.target.value && go(period, e.target.value)} />
          {!isCurrent && <button onClick={() => go(period, today)}>{meta.current}</button>}
          <button className="push" onClick={exportCsv} disabled={!data?.sales.length}>
            Exportar CSV
          </button>
        </div>
      ) : (
        <div className="row" style={{ marginBottom: 16, maxWidth: 520 }}>
          <h1 style={{ margin: 0 }}>Ventas de hoy</h1>
          <button style={{ flex: "0 0 auto" }} onClick={exportCsv} disabled={!data?.sales.length}>
            Exportar CSV
          </button>
        </div>
      )}
      {error && <div className="msg error">{error}</div>}

      <div className="stats">
        <div className="panel stat"><div className="muted">{meta.total}</div><div className="v">{formatMoney(data?.total ?? 0)}</div></div>
        <div className="panel stat"><div className="muted">Ventas</div><div className="v">{data?.count ?? 0}</div></div>
        <div className="panel stat"><div className="muted">Kilos vendidos</div><div className="v">{formatKg(data?.totalKg ?? 0)}</div></div>
        <div className="panel stat"><div className="muted">Unidades vendidas</div><div className="v">{data?.totalUnits ?? 0}</div></div>
        <div className="panel stat"><div className="muted">Ticket promedio</div><div className="v">{formatMoney(data?.count ? data.total / data.count : 0)}</div></div>
      </div>

      {days.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Por día</h2>
          <table>
            <tbody>
              {days.map(([d, v]) => (
                <tr key={d}>
                  <td style={{ width: "45%" }}>
                    <button className="linklike" title="Ver las ventas de este día" onClick={() => go("dia", d)}>
                      {WEEKDAYS[weekdayOf(d)]} {shortDate(d)}
                    </button>
                    <div className="hbar"><span style={{ width: `${(v.total / bestDay) * 100}%` }} /></div>
                  </td>
                  <td className="num">{v.count} ventas</td>
                  <td className="num">{formatMoney(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {payments.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Por medio de pago</h2>
          <table>
            <tbody>
              {payments.map(([k, v]) => (
                <tr key={k}>
                  <td>{paymentLabel(k)}</td>
                  <td className="num">{formatMoney(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha y hora</th>
              <th>Cajero</th>
              <th>Medio de pago</th>
              <th className="num">Ítems</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.sales.map((s) => (
              <Fragment key={s.id}>
                <tr className={s.status === "CANCELLED" ? "cancelled" : ""}>
                  <td>{s.id}</td>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>{s.cashier ?? "—"}</td>
                  <td>
                    <select
                      value={s.paymentMethod ?? ""}
                      onChange={(e) => patch(s, { paymentMethod: e.target.value || null })}
                      style={{ fontSize: 14, padding: "4px 6px", width: "auto" }}
                    >
                      <option value="">—</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{s.items.length}</td>
                  <td className="num">{formatMoney(s.total)}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    <button onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? "Ocultar" : "Detalle"}
                    </button>{" "}
                    {!isAdmin ? null : s.status === "COMPLETED" ? (
                      <button
                        className="danger"
                        onClick={() => confirm(`¿Anular la venta #${s.id}?`) && patch(s, { status: "CANCELLED" })}
                      >
                        Anular
                      </button>
                    ) : (
                      <button onClick={() => patch(s, { status: "COMPLETED" })}>Restaurar</button>
                    )}
                  </td>
                </tr>
                {open === s.id && (
                  <tr>
                    <td colSpan={7} style={{ background: "#fafaf7" }}>
                      <table>
                        <tbody>
                          {s.items.map((i) => (
                            <tr key={i.id}>
                              <td>{i.productCode}</td>
                              <td>{i.productName}</td>
                              <td className="num">{formatUnitPrice(i.unitPrice, i.unit)}</td>
                              <td className="num">{formatQty(i.quantity, i.unit)}</td>
                              <td className="num">{formatMoney(i.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data && data.sales.length === 0 && <p className="muted">{meta.empty}</p>}
      </section>
    </>
  );
}
