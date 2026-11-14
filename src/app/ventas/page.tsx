"use client";

import { Fragment, useEffect, useState } from "react";
import { PAYMENT_LABELS, PAYMENT_METHODS, type Payment, type SaleDTO } from "@/lib/dto";
import { formatDateTime, formatKg, formatMoney, formatQty, formatUnitPrice } from "@/lib/format";
import { apiFetch, useIsAdmin } from "@/components/SessionProvider";
import SalesReport from "@/components/SalesReport";

type Summary = {
  date: string;
  count: number;
  total: number;
  totalKg: number;
  totalUnits: number;
  byPayment: Record<string, number>;
  sales: SaleDTO[];
};

const todayAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
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
          Del día
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
  const [date, setDate] = useState(todayAR());
  const [data, setData] = useState<Summary | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function load() {
    const res = await apiFetch(`/api/sales?date=${date}`);
    setData(await res.json());
  }
  useEffect(() => { load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const a = Object.assign(document.createElement("a"), { href: url, download: `ventas-${date}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const payments = Object.entries(data?.byPayment ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="row" style={{ marginBottom: 16, maxWidth: 520 }}>
        {isAdmin ? (
          <div>
            <label>Día</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        ) : (
          <h1 style={{ margin: 0 }}>Ventas de hoy</h1>
        )}
        <button style={{ flex: "0 0 auto" }} onClick={exportCsv} disabled={!data?.sales.length}>
          Exportar CSV
        </button>
      </div>

      <div className="stats">
        <div className="panel stat"><div className="muted">Total del día</div><div className="v">{formatMoney(data?.total ?? 0)}</div></div>
        <div className="panel stat"><div className="muted">Ventas</div><div className="v">{data?.count ?? 0}</div></div>
        <div className="panel stat"><div className="muted">Kilos vendidos</div><div className="v">{formatKg(data?.totalKg ?? 0)}</div></div>
        <div className="panel stat"><div className="muted">Unidades vendidas</div><div className="v">{data?.totalUnits ?? 0}</div></div>
        <div className="panel stat"><div className="muted">Ticket promedio</div><div className="v">{formatMoney(data?.count ? data.total / data.count : 0)}</div></div>
      </div>

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
        {data && data.sales.length === 0 && <p className="muted">No hay ventas este día.</p>}
      </section>
    </>
  );
}
