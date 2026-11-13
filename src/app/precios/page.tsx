"use client";

import { useState } from "react";
import type { ProductDTO } from "@/lib/dto";
import { formatMoney } from "@/lib/format";
import { apiFetch, useIsAdmin } from "@/components/SessionProvider";
import Link from "next/link";
import BarcodeScanner from "@/components/BarcodeScanner";

type Msg = { kind: "info" | "error" | "ok"; text: string } | null;

async function readError(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

/** Acepta "1500", "1500,50" o "1.500,50" */
function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(/\s|\$/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------- Página ---------- */

export default function PreciosPage() {
  const isAdmin = useIsAdmin();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [results, setResults] = useState<ProductDTO[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [scanning, setScanning] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function search(raw: string) {
    const term = raw.trim();
    if (!term) return;
    setQuery(term);
    setLoading(true);
    setMsg(null);
    setMissing(null);
    setProduct(null);
    setResults([]);
    setEditing(false);
    try {
      // 1) por código exacto
      const byCode = await apiFetch(`/api/products/by-code/${encodeURIComponent(term)}`);
      if (byCode.ok) {
        setProduct((await byCode.json()) as ProductDTO);
        return;
      }
      if (byCode.status !== 404) {
        setMsg({ kind: "error", text: await readError(byCode, "No se pudo buscar el producto") });
        return;
      }
      // 2) repliegue: búsqueda por nombre / código parcial
      const res = await apiFetch(`/api/products?q=${encodeURIComponent(term)}`);
      if (!res.ok) {
        setMsg({ kind: "error", text: await readError(res, "No se pudo buscar el producto") });
        return;
      }
      const list = (await res.json()) as ProductDTO[];
      if (list.length === 1) setProduct(list[0]);
      else if (list.length > 1) setResults(list);
      else {
        setMissing(term);
        setMsg({
          kind: "info",
          text: `No se encontró "${term}". Cargalo en Productos (podés poner el código de barras en "Código")`,
        });
      }
    } catch {
      setMsg({ kind: "error", text: "Error de conexión. Probá de nuevo." });
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    if (!product) return;
    setPriceInput(String(product.price).replace(".", ","));
    setEditing(true);
    setMsg(null);
  }

  async function savePrice() {
    if (!product) return;
    const price = parsePrice(priceInput);
    if (price === null) {
      setMsg({ kind: "error", text: "Precio inválido. Usá por ejemplo 1500 o 1500,50" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      if (!res.ok) {
        setMsg({ kind: "error", text: await readError(res, "No se pudo actualizar el precio") });
        return;
      }
      const updated = (await res.json()) as ProductDTO;
      setProduct(updated);
      setResults((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      setEditing(false);
      setMsg({ kind: "ok", text: "Precio actualizado ✓" });
    } catch {
      setMsg({ kind: "error", text: "Error de conexión. Probá de nuevo." });
    } finally {
      setSaving(false);
    }
  }

  function onScanned(code: string) {
    setScanning(false);
    void search(code);
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Precios</h1>

      <button className="primary big" onClick={() => setScanning(true)} style={{ marginBottom: 16 }}>
        📷 Escanear producto
      </button>

      <form
        className="panel"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <label htmlFor="precios-q">Código o nombre</label>
        <div className="row">
          <input
            id="precios-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej: 0001 o tomate"
            autoComplete="off"
          />
          <button type="submit" className="primary" disabled={loading || !query.trim()} style={{ flex: "0 0 auto", padding: "12px 16px" }}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </form>

      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

      {isAdmin && missing && (
        <Link href={`/productos?code=${encodeURIComponent(missing)}`} style={{ display: "block", marginBottom: 16 }}>
          <button className="primary big" type="button">
            ➕ Cargar este producto ahora
          </button>
        </Link>
      )}

      {results.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            {results.length} productos coinciden. Tocá uno:
          </p>
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setProduct(r);
                setResults([]);
                setEditing(false);
                setMsg(null);
              }}
              style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 6, textAlign: "left" }}
            >
              <span>
                {r.name} <small className="muted">· {r.code}</small>
              </span>
              <strong>{formatMoney(r.price)}</strong>
            </button>
          ))}
        </div>
      )}

      {product && (
        <div className="panel" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{product.name}</div>
          <div style={{ fontSize: 52, fontWeight: 800, color: "var(--green-dark)", lineHeight: 1.2, margin: "8px 0" }}>
            {formatMoney(product.price)}
          </div>
          <div style={{ fontSize: 18 }}>{product.unit === "KG" ? "por kilo" : "por unidad"}</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Código {product.code}
          </div>

          {isAdmin && !editing && (
            <button onClick={startEdit} style={{ marginTop: 16 }}>
              Cambiar precio
            </button>
          )}

          {isAdmin && editing && (
            <form
              style={{ marginTop: 16, textAlign: "left" }}
              onSubmit={(e) => {
                e.preventDefault();
                void savePrice();
              }}
            >
              <label htmlFor="precios-nuevo">Nuevo precio {product.unit === "KG" ? "por kilo" : "por unidad"}</label>
              <input
                id="precios-nuevo"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                autoFocus
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={saving}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {scanning && <BarcodeScanner onDetected={onScanned} onCancel={() => setScanning(false)} />}
    </div>
  );
}
