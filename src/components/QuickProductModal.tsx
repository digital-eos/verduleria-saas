"use client";

import { useState } from "react";
import type { ProductDTO, Unit } from "@/lib/dto";
import { apiFetch } from "@/components/SessionProvider";

/** Acepta "1500", "1500,50" o "1.500,50" */
function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(/\s|\$/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Paréntesis en la caja: se escaneó (o tipeó) un código que no existe.
 * - Admin: lo da de alta ahí mismo y vuelve a la venta con el producto en el ticket.
 * - Cajero: no puede crear productos; puede venderlo como "Producto no registrado".
 */
export default function QuickProductModal({
  code,
  isAdmin,
  freeName,
  onCreated,
  onSellFree,
  onCancel,
}: {
  code: string;
  isAdmin: boolean;
  freeName: string;
  onCreated: (p: ProductDTO) => void;
  onSellFree: (price: number) => void;
  onCancel: () => void;
}) {
  // Código de barras largo = producto envasado (por unidad); PLU corto = por kilo
  const [unit, setUnit] = useState<Unit>(/^\d{8,}$/.test(code) ? "UNIT" : "KG");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantityIn, setQuantityIn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const p = parsePrice(price);
    if (p === null) return setError("Precio inválido. Ej: 1500 o 1500,50");
    if (!isAdmin) return onSellFree(p);
    if (!name.trim()) return setError("Poné un nombre");
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: name.trim(),
          unit,
          price: p,
          quantityIn: quantityIn.trim() === "" ? null : quantityIn.trim().replace(",", "."),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo crear el producto");
      onCreated(data as ProductDTO);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-bg" onClick={() => !saving && onCancel()}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && !saving && onCancel()}
      >
        <h2>{isAdmin ? "Nuevo producto" : "Producto no cargado"}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Código <b>{code}</b> no está en Stock.{" "}
          {isAdmin
            ? "Cargalo ahora y se agrega al ticket."
            : `Solo un administrador puede cargarlo. Podés venderlo como “${freeName}”.`}
        </p>
        {error && <div className="msg error">{error}</div>}

        {isAdmin && (
          <>
            <div className="field">
              <label>Nombre</label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Yerba 1kg" />
            </div>
            <div className="field">
              <label>Se vende por</label>
              <div className="pay-options">
                {(["KG", "UNIT"] as Unit[]).map((u) => (
                  <button key={u} type="button" className={unit === u ? "selected" : ""} onClick={() => setUnit(u)}>
                    {u === "KG" ? "Kilo (balanza)" : "Unidad"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label>{isAdmin ? `Precio por ${unit === "KG" ? "kilo" : "unidad"} ($)` : "Precio ($)"}</label>
          <input
            autoFocus={!isAdmin}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0"
          />
        </div>

        {isAdmin && (
          <div className="field">
            <label>
              Cantidad ingresada ({unit === "KG" ? "kg" : "unidades"}) <span className="muted">— opcional</span>
            </label>
            <input
              inputMode={unit === "KG" ? "decimal" : "numeric"}
              value={quantityIn}
              onChange={(e) => setQuantityIn(e.target.value)}
            />
          </div>
        )}

        <div className="row">
          <button type="button" onClick={onCancel} disabled={saving} style={{ flex: "0 0 auto" }}>
            Cancelar
          </button>
          <button className="primary big" type="submit" disabled={saving}>
            {saving ? "Guardando…" : isAdmin ? "Guardar y agregar al ticket" : "Agregar al ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
