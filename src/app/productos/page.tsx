"use client";

import { useEffect, useState } from "react";
import type { ProductDTO, Unit } from "@/lib/dto";
import { formatUnitPrice, normalizeCode } from "@/lib/format";
import { apiFetch } from "@/components/SessionProvider";
import BarcodeScanner from "@/components/BarcodeScanner";

type Form = { id?: number; code: string; name: string; unit: Unit; price: string };
const empty: Form = { code: "", name: "", unit: "KG", price: "" };

export default function ProductosPage() {
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);

  /** Código escaneado: si ya existe se abre para editar, si no se prepara el alta (por unidad). */
  async function loadScanned(raw: string) {
    const code = normalizeCode(raw);
    if (!code) return;
    setError("");
    setNotice("");
    const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(code)}`);
    if (res.ok) {
      const p = (await res.json()) as ProductDTO;
      setForm({ id: p.id, code: p.code, name: p.name, unit: p.unit, price: String(p.price) });
      setNotice(`"${p.name}" ya está cargado. Podés cambiarle el precio.`);
    } else if (res.status === 404) {
      setForm({ ...empty, code, unit: "UNIT" });
      setNotice("Producto nuevo: completá nombre y precio.");
    } else {
      setError("No se pudo buscar el código");
    }
  }

  // Viene de /precios?code=... ("Cargar este producto ahora")
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) void loadScanned(code);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(showInactive ? { all: "1" } : {}) });
    const res = await apiFetch(`/api/products?${params}`);
    setProducts(await res.json());
  }
  useEffect(() => { load(); }, [q, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body = {
      code: form.code,
      name: form.name,
      unit: form.unit,
      price: Number(form.price.replace(",", ".")),
    };
    const res = await apiFetch(form.id ? `/api/products/${form.id}` : "/api/products", {
      method: form.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Error al guardar");
    setNotice(`${form.id ? "Guardado" : "Agregado"}: ${form.name} ✓`);
    setForm(empty);
    load();
  }

  async function toggleActive(p: ProductDTO) {
    await apiFetch(`/api/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !p.active }),
    });
    load();
  }

  async function remove(p: ProductDTO) {
    if (!confirm(`¿Eliminar ${p.name}? (si tiene ventas, solo se desactiva)`)) return;
    await apiFetch(`/api/products/${p.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="grid-pos">
      <section className="panel">
        <h2>{form.id ? "Editar producto" : "Nuevo producto"}</h2>
        <button type="button" className="big" onClick={() => setScanning(true)} style={{ marginBottom: 14 }}>
          📷 Escanear código de barras
        </button>
        {error && <div className="msg error">{error}</div>}
        {notice && !error && <div className="msg ok">{notice}</div>}
        <form onSubmit={save}>
          <div className="field">
            <label>Código (PLU de la balanza o código de barras)</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>Se vende por</label>
            <div className="pay-options">
              {(["KG", "UNIT"] as Unit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={form.unit === u ? "selected" : ""}
                  onClick={() => setForm({ ...form, unit: u })}
                >
                  {u === "KG" ? "Kilo (balanza)" : "Unidad"}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Precio por {form.unit === "KG" ? "kilo" : "unidad"} ($)</label>
            <input
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </div>
          <div className="row">
            {form.id && (
              <button type="button" onClick={() => setForm(empty)} style={{ flex: "0 0 auto" }}>
                Cancelar
              </button>
            )}
            <button className="primary big" type="submit">
              {form.id ? "Guardar cambios" : "Agregar"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Buscar por nombre o código…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label style={{ flex: "0 0 auto", display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Ver inactivos
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Venta</th>
              <th className="num">Precio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={p.active ? "" : "cancelled"}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td><span className="badge">{p.unit === "KG" ? "Por kilo" : "Por unidad"}</span></td>
                <td className="num">{formatUnitPrice(p.price, p.unit)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <button
                    onClick={() =>
                      setForm({ id: p.id, code: p.code, name: p.name, unit: p.unit, price: String(p.price) })
                    }
                  >
                    Editar
                  </button>{" "}
                  <button onClick={() => toggleActive(p)}>{p.active ? "Desactivar" : "Activar"}</button>{" "}
                  <button className="danger" onClick={() => remove(p)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && <p className="muted">No hay productos.</p>}
      </section>

      {scanning && (
        <BarcodeScanner
          onDetected={(code) => {
            setScanning(false);
            void loadScanned(code);
          }}
          onCancel={() => setScanning(false)}
        />
      )}
    </div>
  );
}
