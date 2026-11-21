"use client";

import { useState } from "react";
import type { ProductDTO } from "@/lib/dto";
import { formatMoney, formatQty } from "@/lib/format";
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
 * El producto todavía no tiene precio: se pide al cobrarlo (el comerciante se los sabe de memoria).
 * - Admin: por defecto queda guardado como precio del producto (se puede destildar).
 * - Cajero: vale solo para esta venta.
 * `onDone` recibe el producto con precio y si se guardó en Stock.
 */
export default function PricePromptModal({
  product,
  quantity,
  isAdmin,
  onDone,
  onCancel,
}: {
  product: ProductDTO;
  quantity: number;
  isAdmin: boolean;
  onDone: (p: ProductDTO & { price: number }, saved: boolean) => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState("");
  const [save, setSave] = useState(isAdmin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perKg = product.unit === "KG";
  const n = parsePrice(price);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (n === null) return setError("Precio inválido. Ej: 1500 o 1500,50");
    if (!save) return onDone({ ...product, price: n }, false);
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: n }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar el precio");
      const updated = data as ProductDTO;
      onDone({ ...updated, price: updated.price ?? n }, true);
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
        <h2>Precio de {product.name}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Este producto todavía no tiene precio. Ponelo y se agrega al ticket.
        </p>
        {error && <div className="msg error">{error}</div>}
        <div className="field">
          <label>Precio por {perKg ? "kilo" : "unidad"} ($)</label>
          <input
            autoFocus
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0"
            style={{ fontSize: 28 }}
          />
        </div>
        {n !== null && (
          <p className="muted">
            {formatQty(quantity, product.unit)} → <b>{formatMoney(Math.round(n * quantity * 100) / 100)}</b>
          </p>
        )}
        {isAdmin ? (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={save} onChange={(e) => setSave(e.target.checked)} />
            Guardarlo como precio del producto
          </label>
        ) : (
          <p className="muted">Vale solo para esta venta. Un administrador lo puede guardar en Stock.</p>
        )}
        <div className="row">
          <button type="button" onClick={onCancel} disabled={saving} style={{ flex: "0 0 auto" }}>
            Cancelar
          </button>
          <button className="primary big" type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Agregar al ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
