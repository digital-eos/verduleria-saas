"use client";

import { useEffect, useRef, useState } from "react";
import { PAYMENT_LABELS, PAYMENT_METHODS, type Payment, type ProductDTO, type SaleDTO, type Unit } from "@/lib/dto";
import { formatMoney, formatQty, formatUnitPrice, normalizeCode, parseWeightInput } from "@/lib/format";
import { parseScaleLabel } from "@/lib/barcode";
import { SystelScale, isSerialSupported } from "@/lib/scale";
import { apiFetch } from "@/components/SessionProvider";
import BarcodeScanner from "@/components/BarcodeScanner";

type CartLine = {
  key: string;
  code: string;
  name: string;
  unit: Unit;
  price: number;
  quantity: number;
};

const CART_KEY = "verduleria.cart.v2";
const subtotal = (l: CartLine) => Math.round(l.price * l.quantity * 100) / 100;

async function fetchProduct(code: string): Promise<ProductDTO> {
  const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(code)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Producto no encontrado");
  return data;
}

/** Interpreta lo tipeado en "cantidad" según la unidad del producto */
function parseQuantity(raw: string, unit: Unit): number | null {
  if (unit === "KG") return parseWeightInput(raw);
  const n = Number(raw.trim().replace(",", "."));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function CajaPage() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [results, setResults] = useState<ProductDTO[]>([]);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "ok" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<SaleDTO | null>(null);

  const scaleRef = useRef<SystelScale | null>(null);
  const [scaleOn, setScaleOn] = useState(false);
  const [lastRaw, setLastRaw] = useState("");

  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  // PC (Chrome/Edge con Web Serial): balanza + lector USB. Móvil: cámara.
  const [hasSerial, setHasSerial] = useState<boolean | null>(null);
  const hasSerialRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const scanBuf = useRef({ text: "", last: 0 });
  useEffect(() => {
    const s = isSerialSupported();
    hasSerialRef.current = s;
    setHasSerial(s);
  }, []);
  /** En móvil no enfocamos para no abrir el teclado después de cada escaneo */
  const focusCode = () => { if (hasSerialRef.current) codeRef.current?.focus(); };

  // Persistir ticket ante un refresh accidental
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      if (saved) setCart(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  }, [cart]);

  const total = cart.reduce((acc, l) => acc + subtotal(l), 0);
  const isUnit = product?.unit === "UNIT";

  function addLine(p: ProductDTO, quantity: number) {
    setCart((c) => {
      // Si es por unidad y ya está en el ticket, se suma a la misma línea
      const existing = p.unit === "UNIT" ? c.find((l) => l.code === p.code) : undefined;
      if (existing) {
        return c.map((l) => (l === existing ? { ...l, quantity: l.quantity + quantity } : l));
      }
      return [...c, { key: crypto.randomUUID(), code: p.code, name: p.name, unit: p.unit, price: p.price, quantity }];
    });
    setMessage({ type: "ok", text: `+ ${p.name} · ${formatQty(quantity, p.unit)} · ${formatMoney(p.price * quantity)}` });
    setProduct(null);
    setCodeInput("");
    setQtyInput("");
    focusCode();
  }

  /** Etiqueta EAN-13 impresa por la balanza: PLU + peso (o importe) */
  async function addFromLabel(label: NonNullable<ReturnType<typeof parseScaleLabel>>) {
    const p = await fetchProduct(label.code);
    let qty = label.mode === "CANTIDAD" ? label.value : label.value / p.price;
    qty = p.unit === "UNIT" ? Math.max(1, Math.round(qty)) : Math.round(qty * 1000) / 1000;
    addLine(p, qty);
  }

  /**
   * Código escaneado (cámara o lector USB). Primero se busca el código exacto
   * (productos envasados); si no existe y es una etiqueta de la balanza, se usa esa.
   * Por unidad: suma 1 directo. Por kilo: pide el peso.
   */
  async function addScanned(raw: string) {
    const code = raw.trim();
    if (!code) return;
    setMessage(null);
    setResults([]);
    setProduct(null);
    setCodeInput("");
    setQtyInput("");
    try {
      const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(normalizeCode(code))}`);
      if (res.ok) {
        const p = (await res.json()) as ProductDTO;
        if (p.unit === "UNIT") addLine(p, 1);
        else await selectProduct(p);
        return;
      }
      if (res.status !== 404) throw new Error("No se pudo buscar el producto");
      const label = parseScaleLabel(code);
      if (label) return await addFromLabel(label);
      throw new Error(`Producto no cargado (código ${code}). Cargalo en Productos.`);
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    }
  }

  /** Selecciona un producto y pasa al campo cantidad / lee la balanza */
  async function selectProduct(p: ProductDTO) {
    setResults([]);
    setProduct(p);
    setCodeInput(p.code);
    if (p.unit === "UNIT") {
      setQtyInput("1");
      setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); });
    } else if (scaleRef.current?.connected) {
      await readScale();
    } else {
      setQtyInput("");
      setTimeout(() => qtyRef.current?.focus());
    }
  }

  /** Enter en el campo código: PLU, nombre (búsqueda) o etiqueta EAN-13 escaneada */
  async function handleCode() {
    const raw = codeInput.trim();
    if (!raw) return;
    setMessage(null);
    setResults([]);
    try {
      // Si tiene letras, buscamos por nombre
      if (/[a-záéíóúñ]/i.test(raw)) {
        const res = await apiFetch(`/api/products?q=${encodeURIComponent(raw)}`);
        const found: ProductDTO[] = res.ok ? await res.json() : [];
        if (found.length === 0) throw new Error(`No hay productos que coincidan con "${raw}"`);
        if (found.length === 1) return selectProduct(found[0]);
        setResults(found.slice(0, 8));
        return;
      }
      // Código de barras (8+ dígitos, típicamente del lector USB): se agrega directo
      if (/^\d{8,}$/.test(raw)) return await addScanned(raw);
      await selectProduct(await fetchProduct(normalizeCode(raw)));
    } catch (e) {
      setProduct(null);
      setMessage({ type: "error", text: (e as Error).message });
      codeRef.current?.select();
    }
  }

  function handleQty() {
    if (!product) {
      codeRef.current?.focus();
      return;
    }
    const q = parseQuantity(qtyInput, product.unit);
    if (q === null) {
      setMessage({
        type: "error",
        text: product.unit === "KG" ? "Peso inválido. Ej: 1,250 (kg) o 1250g" : "Cantidad inválida (número entero)",
      });
      return;
    }
    addLine(product, q);
  }

  function changeUnitQty(key: string, delta: number) {
    setCart((c) =>
      c.flatMap((l) => {
        if (l.key !== key) return [l];
        const q = l.quantity + delta;
        return q > 0 ? [{ ...l, quantity: q }] : [];
      }),
    );
  }

  async function toggleScale() {
    try {
      if (scaleRef.current?.connected) {
        await scaleRef.current.disconnect();
        setScaleOn(false);
        return;
      }
      const s = new SystelScale();
      await s.connect(9600);
      scaleRef.current = s;
      setScaleOn(true);
      setMessage({ type: "ok", text: "Balanza conectada" });
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    }
  }

  async function readScale() {
    if (!scaleRef.current?.connected || isUnit) return;
    try {
      const r = await scaleRef.current.readWeight();
      setLastRaw(r.raw);
      setQtyInput(r.kg.toFixed(3).replace(".", ","));
      qtyRef.current?.focus();
      qtyRef.current?.select();
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    }
  }

  async function validateSale() {
    if (cart.length === 0 || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: payment,
          items: cart.map((l) => ({ code: l.code, quantity: l.quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar la venta");
      setReceipt(data);
      setCart([]);
      setMessage(null);
      setPayment(null);
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // Atajos: F2 = cobrar, F4 = leer balanza, Esc = cerrar ticket.
  // Además escucha el lector USB cuando el foco NO está en un campo
  // (el lector "tipea" muy rápido y termina con Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (!inField && !receipt) {
        const now = e.timeStamp;
        const buf = scanBuf.current;
        if (e.key.length === 1) {
          buf.text = now - buf.last < 50 ? buf.text + e.key : e.key;
          buf.last = now;
        } else if (e.key === "Enter") {
          if (buf.text.length >= 6 && now - buf.last < 100) {
            e.preventDefault();
            void addScanned(buf.text);
          }
          buf.text = "";
        }
      }
      if (e.key === "F2") { e.preventDefault(); validateSale(); }
      if (e.key === "F4") { e.preventDefault(); readScale(); }
      if (e.key === "Escape" && receipt) { setReceipt(null); focusCode(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="grid-pos">
        {/* Columna de carga */}
        <section className="panel">
          <h2>Cargar producto</h2>
          {hasSerial === false && (
            <button className="primary big" onClick={() => setScanning(true)} style={{ marginBottom: 14 }}>
              📷 Escanear producto
            </button>
          )}
          {message && <div className={`msg ${message.type}`}>{message.text}</div>}

          <div className="field">
            <label>Código (PLU) o nombre del producto</label>
            <input
              ref={codeRef}
              autoFocus={hasSerial !== false}
              inputMode="numeric"
              value={codeInput}
              onChange={(e) => { setCodeInput(e.target.value); setProduct(null); setResults([]); }}
              onKeyDown={(e) => e.key === "Enter" && handleCode()}
              placeholder="Ej: 1, 0001 o tomate"
            />
          </div>
          {results.length > 0 && (
            <div className="search-results">
              {results.map((p) => (
                <button key={p.id} onClick={() => selectProduct(p)}>
                  <b>{p.code}</b> · {p.name} — {formatUnitPrice(p.price, p.unit)}
                </button>
              ))}
            </div>
          )}
          <div className="product-hint">
            {product ? `${product.name} — ${formatUnitPrice(product.price, product.unit)}` : ""}
          </div>

          <div className="field">
            <label>{isUnit ? "Cantidad (unidades)" : "Peso (kg)"}</label>
            <div className="row">
              <input
                ref={qtyRef}
                inputMode={isUnit ? "numeric" : "decimal"}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQty()}
                placeholder={isUnit ? "Ej: 2" : "Ej: 1,250"}
              />
              {!isUnit && hasSerial && (
                <button style={{ flex: "0 0 auto" }} onClick={readScale} disabled={!scaleOn}>
                  Leer <span className="kbd">F4</span>
                </button>
              )}
            </div>
          </div>

          <button className="primary big" onClick={product ? handleQty : handleCode}>
            Agregar al ticket
          </button>

          {hasSerial && (
            <>
              <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "20px 0" }} />

              <div className="scale-status">
                <span className={`dot ${scaleOn ? "on" : ""}`} />
                <span style={{ flex: 1 }}>Balanza {scaleOn ? "conectada" : "desconectada"}</span>
                <button onClick={toggleScale}>{scaleOn ? "Desconectar" : "Conectar"}</button>
              </div>
              {lastRaw && <p className="muted">Última trama: <code>{JSON.stringify(lastRaw)}</code></p>}
              <p className="muted">
                Enter para avanzar · <span className="kbd">F2</span> cobrar · lector USB: escaneá directo
              </p>
            </>
          )}
        </section>

        {/* Ticket en curso */}
        <section className="panel">
          <h2>Ticket</h2>
          {cart.length === 0 ? (
            <p className="muted">Ticket vacío. Pesá o escaneá un producto para empezar.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Producto</th>
                  <th className="num">Precio</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.key}>
                    <td>{l.code}</td>
                    <td>{l.name}</td>
                    <td className="num">{formatUnitPrice(l.price, l.unit)}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {l.unit === "UNIT" && (
                        <button className="qty-btn" onClick={() => changeUnitQty(l.key, -1)}>−</button>
                      )}
                      {formatQty(l.quantity, l.unit)}
                      {l.unit === "UNIT" && (
                        <button className="qty-btn" onClick={() => changeUnitQty(l.key, 1)}>+</button>
                      )}
                    </td>
                    <td className="num">{formatMoney(subtotal(l))}</td>
                    <td className="num">
                      <button className="danger" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="total-box">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>

          <div className="field">
            <label>Medio de pago (opcional)</label>
            <div className="pay-options">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={payment === m ? "selected" : ""}
                  onClick={() => setPayment(payment === m ? null : m)}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="row">
            <button onClick={() => setCart([])} disabled={cart.length === 0} style={{ flex: "0 0 auto" }}>
              Vaciar
            </button>
            <button className="primary big" onClick={validateSale} disabled={cart.length === 0 || saving}>
              {saving ? "Guardando…" : "Cobrar (F2)"}
            </button>
          </div>
        </section>
      </div>

      {receipt && (
        <div className="modal-bg" onClick={() => setReceipt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Venta #{receipt.id} registrada</h2>
            <p className="muted">
              {new Date(receipt.createdAt).toLocaleString("es-AR")}
              {receipt.paymentMethod && ` · ${PAYMENT_LABELS[receipt.paymentMethod]}`}
              {receipt.cashier && ` · ${receipt.cashier}`}
            </p>
            <table>
              <tbody>
                {receipt.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.productName}</td>
                    <td className="num">{formatQty(i.quantity, i.unit)}</td>
                    <td className="num">{formatMoney(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="total-box">
              <span>Total a cobrar</span>
              <span>{formatMoney(receipt.total)}</span>
            </div>
            <button className="primary big" autoFocus onClick={() => { setReceipt(null); focusCode(); }}>
              Nueva venta
            </button>
          </div>
        </div>
      )}

      {scanning && (
        <BarcodeScanner
          onDetected={(code) => {
            setScanning(false);
            void addScanned(code);
          }}
          onCancel={() => setScanning(false)}
        />
      )}
    </>
  );
}
