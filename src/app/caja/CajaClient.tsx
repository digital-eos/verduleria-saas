"use client";

import { useEffect, useRef, useState } from "react";
import { PAYMENT_LABELS, PAYMENT_METHODS, type Payment, type ProductDTO, type SaleDTO, type Unit } from "@/lib/dto";
import { formatMoney, formatQty, formatUnitPrice, normalizeCode, parseWeightInput } from "@/lib/format";
import { parseScaleLabel } from "@/lib/barcode";
import { SystelScale, isSerialSupported } from "@/lib/scale";
import Link from "next/link";
import { apiFetch, useIsAdmin } from "@/components/SessionProvider";
import BarcodeScanner from "@/components/BarcodeScanner";
import MercadoPagoQrModal from "@/components/MercadoPagoQrModal";
import QuickProductModal from "@/components/QuickProductModal";

type CartLine = {
  key: string;
  code: string;
  name: string;
  unit: Unit;
  price: number;
  quantity: number;
  /** Monto libre del modo Precio ("Producto no registrado") */
  free?: boolean;
};

/** Modo de carga: cambia solo cómo se agrega al ticket (el ticket es uno solo) */
type Mode = "balanza" | "scan" | "precio";
const MODES: { id: Mode; label: string }[] = [
  { id: "balanza", label: "⚖️ Balanza" },
  { id: "scan", label: "📷 Scan" },
  { id: "precio", label: "🧮 Precio" },
];
const MODE_KEY = "libretita.cajaMode.v1";
const FREE_NAME = "Producto no registrado";
const KEYPAD = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", ","];

/** Lo que se manda al servidor por cada línea del ticket */
const toPayload = (l: CartLine) => (l.free ? { amount: l.price } : { code: l.code, quantity: l.quantity });

const CART_KEY = "verduleria.cart.v2";
/** Cobro QR en curso: si se recarga la página, se retoma (no se pierde un pago) */
const QR_ORDER_KEY = "libretita.qrOrder.v1";
const subtotal = (l: CartLine) => Math.round(l.price * l.quantity * 100) / 100;

async function fetchProduct(code: string): Promise<ProductDTO> {
  const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(code)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Producto no encontrado");
  return data;
}

/** Acepta "1500", "1500,50" o "1.500,50" */
function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(/\s|\$/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Interpreta lo tipeado en "cantidad" según la unidad del producto */
function parseQuantity(raw: string, unit: Unit): number | null {
  if (unit === "KG") return parseWeightInput(raw);
  const n = Number(raw.trim().replace(",", "."));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function CajaClient({ mpQrEnabled }: { mpQrEnabled: boolean }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [results, setResults] = useState<ProductDTO[]>([]);
  const [message, setMessage] = useState<{ type: "error" | "ok" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<SaleDTO | null>(null);
  // Cobro con QR de Mercado Pago: null = cerrado; resume = orden a retomar
  const [qr, setQr] = useState<{ resume: string | null } | null>(null);
  // Con Mercado Pago real, el comercio tiene que tener su cuenta conectada y la caja QR creada
  const [mpBlocked, setMpBlocked] = useState<string | null>(null);
  useEffect(() => {
    if (!mpQrEnabled) return;
    apiFetch("/api/mercadopago/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { provider: string; ready: boolean; connected: boolean; status: string | null } | null) => {
        if (!s || s.provider !== "mercadopago" || s.ready) return setMpBlocked(null);
        setMpBlocked(
          s.status === "revoked"
            ? "Reconectá tu cuenta de Mercado Pago para cobrar con QR."
            : s.connected
              ? "Falta crear la caja QR de Mercado Pago."
              : "Mercado Pago no está conectado.",
        );
      })
      .catch(() => {});
  }, [mpQrEnabled]);
  // Cobro QR apagado (FEATURE_MP_QR): Mercado Pago no aparece entre los medios de pago
  const payMethods = mpQrEnabled ? PAYMENT_METHODS : PAYMENT_METHODS.filter((m) => m !== "MERCADOPAGO");

  // Precios (ex módulo "Precios"): el admin cambia el precio del producto
  // encontrado sin salir de la caja, o carga uno que no existe.
  const isAdmin = useIsAdmin();
  const [missingCode, setMissingCode] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState<string | null>(null); // null = no editando
  const [savingPrice, setSavingPrice] = useState(false);
  // Código inexistente: paréntesis para darlo de alta (o venderlo sin registrar) y volver a la venta
  const [quickAdd, setQuickAdd] = useState<{ code: string; from: "scan" | "code" } | null>(null);

  const scaleRef = useRef<SystelScale | null>(null);
  const [scaleOn, setScaleOn] = useState(false);
  const [lastRaw, setLastRaw] = useState("");

  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("balanza");
  const [scanInput, setScanInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m && MODES.some((x) => x.id === m)) setMode(m as Mode);
    } catch {}
  }, []);

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
  /**
   * Foco al campo de entrada del modo actual. En móvil no enfocamos el código ni el
   * scan para no abrir el teclado (el modo Precio usa su propio teclado en pantalla).
   */
  const focusCode = (m: Mode = mode) => {
    if (m === "precio") amountRef.current?.focus();
    else if (hasSerialRef.current) (m === "scan" ? scanRef : codeRef).current?.focus();
  };

  function changeMode(m: Mode) {
    setMode(m);
    setMessage(null);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
    setTimeout(() => focusCode(m));
  }

  /** Modo Precio: teclado tipo calculadora ("1500", "1500,50") */
  function pressKey(k: string) {
    setAmountInput((v) => {
      if (k === ",") return v.includes(",") ? v : (v || "0") + ",";
      const dec = v.split(",")[1];
      if (dec !== undefined && dec.length + k.length > 2) return v; // máximo 2 decimales
      if (v.replace(",", "").length >= 9) return v;
      return !v || v === "0" ? k.replace(/^0+/, "") || "0" : v + k;
    });
    amountRef.current?.focus();
  }

  function pushFree(price: number) {
    setCart((c) => [...c, { key: crypto.randomUUID(), code: "S/C", name: FREE_NAME, unit: "UNIT", price, quantity: 1, free: true }]);
    setMessage({ type: "ok", text: `+ ${FREE_NAME} · ${formatMoney(price)}` });
  }

  /** Modo Precio: agrega el monto como "Producto no registrado" */
  function addFree() {
    const price = parsePrice(amountInput);
    if (price === null) {
      if (amountInput.trim()) setMessage({ type: "error", text: "Monto inválido. Ej: 1500 o 1500,50" });
      amountRef.current?.focus();
      return;
    }
    pushFree(price);
    setAmountInput("");
    amountRef.current?.focus();
  }

  /** Cierra el paréntesis de alta y retoma la venta */
  function closeQuickAdd() {
    setQuickAdd(null);
    setTimeout(() => focusCode());
  }

  /** Producto recién creado desde la caja: va directo al ticket (por kilo pide el peso) */
  async function onQuickCreated(p: ProductDTO) {
    const from = quickAdd?.from;
    setQuickAdd(null);
    setMissingCode(null);
    if (p.unit === "UNIT" && from === "scan") return addLine(p, 1);
    if (mode !== "balanza") changeMode("balanza");
    await selectProduct(p);
  }

  // Persistir ticket ante un refresh accidental
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      if (saved) setCart(JSON.parse(saved));
      const pendingQr = localStorage.getItem(QR_ORDER_KEY);
      if (pendingQr && mpQrEnabled) setQr({ resume: pendingQr });
      else if (pendingQr) localStorage.removeItem(QR_ORDER_KEY); // cobro QR apagado: no se retoma
    } catch {}
  }, [mpQrEnabled]);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  }, [cart]);

  // Búsqueda automática mientras se tipea (con un pequeño retardo).
  // PLU encontrado → pasa solo al campo cantidad/peso; texto → lista de coincidencias.
  useEffect(() => {
    const raw = codeInput.trim();
    if (!raw || product?.code === raw) return;
    const hasLetters = /[a-záéíóúñ]/i.test(raw);
    // Códigos de barras largos (lector USB) se resuelven con Enter
    if (!hasLetters && /^\d{8,}$/.test(raw)) return;
    if (hasLetters && raw.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (hasLetters) {
          const res = await apiFetch(`/api/products?q=${encodeURIComponent(raw)}`);
          const found: ProductDTO[] = res.ok ? await res.json() : [];
          if (!cancelled) setResults(found.slice(0, 8));
        } else {
          const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(normalizeCode(raw))}`);
          if (cancelled) return;
          if (res.ok) await selectProduct((await res.json()) as ProductDTO);
        }
      } catch {}
    }, hasLetters ? 250 : 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeInput]);

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
    setMissingCode(null);
    setPriceInput(null);
    setCodeInput("");
    setQtyInput("");
    try {
      const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(normalizeCode(code))}`);
      if (res.ok) {
        const p = (await res.json()) as ProductDTO;
        if (p.unit === "UNIT") return addLine(p, 1);
        // Por kilo hace falta el peso: pasamos al modo Balanza con el producto elegido
        if (mode !== "balanza") changeMode("balanza");
        await selectProduct(p);
        return;
      }
      if (res.status !== 404) throw new Error("No se pudo buscar el producto");
      const label = parseScaleLabel(code);
      if (label) return await addFromLabel(label);
      setMissingCode(code);
      setQuickAdd({ code: normalizeCode(code), from: "scan" });
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    }
  }

  /** Selecciona un producto y pasa al campo cantidad / lee la balanza */
  async function selectProduct(p: ProductDTO) {
    setResults([]);
    setPriceInput(null);
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
    // Ya encontrado por la búsqueda automática: confirmar y pasar a la cantidad
    if (product) return selectProduct(product);
    if (results.length === 1) return selectProduct(results[0]);
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
      const res = await apiFetch(`/api/products/by-code/${encodeURIComponent(normalizeCode(raw))}`);
      if (res.status === 404) {
        setMissingCode(raw);
        setQuickAdd({ code: normalizeCode(raw), from: "code" });
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo buscar el producto");
      await selectProduct(data as ProductDTO);
    } catch (e) {
      setProduct(null);
      setMessage({ type: "error", text: (e as Error).message });
      codeRef.current?.select();
    }
  }

  async function savePrice() {
    if (!product || priceInput === null) return;
    const price = parsePrice(priceInput);
    if (price === null) {
      setMessage({ type: "error", text: "Precio inválido. Usá por ejemplo 1500 o 1500,50" });
      return;
    }
    setSavingPrice(true);
    try {
      const res = await apiFetch(`/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo actualizar el precio");
      const updated = data as ProductDTO;
      setProduct(updated);
      // El ticket en curso se cobra al precio actual: lo reflejamos
      setCart((c) => c.map((l) => (l.code === updated.code ? { ...l, price: updated.price } : l)));
      setPriceInput(null);
      setMessage({ type: "ok", text: `Precio de ${updated.name} actualizado: ${formatUnitPrice(updated.price, updated.unit)}` });
      setTimeout(() => qtyRef.current?.focus());
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    } finally {
      setSavingPrice(false);
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
    // Carga manual: siempre volvemos al código para el próximo producto (también en móvil)
    setTimeout(() => codeRef.current?.focus());
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

  const rememberQr = (orderId: string | null) => {
    try {
      if (orderId) localStorage.setItem(QR_ORDER_KEY, orderId);
      else localStorage.removeItem(QR_ORDER_KEY);
    } catch {}
  };

  /** Cobra el ticket con el medio de pago elegido (un toque = venta registrada) */
  async function validateSale(payment: Payment) {
    if (cart.length === 0 || total <= 0 || saving || qr) return;
    // Mercado Pago → cobro con QR. La venta se registra sola cuando el pago queda aprobado.
    if (payment === "MERCADOPAGO") {
      if (!mpQrEnabled || mpBlocked) return;
      setMessage(null);
      setQr({ resume: null });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: payment,
          items: cart.map(toPayload),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar la venta");
      setReceipt(data);
      setCart([]);
      setMessage(null);
    } catch (e) {
      setMessage({ type: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // Atajos: F2 = cobrar en efectivo, F4 = leer balanza, Esc = cerrar ticket.
  // Además escucha el lector USB cuando el foco NO está en un campo
  // (el lector "tipea" muy rápido y termina con Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (qr || quickAdd) return; // con un modal abierto la caja no escucha atajos ni el lector
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
      if (e.key === "F2") { e.preventDefault(); validateSale("CASH"); }
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
          <div className="mode-switch" role="tablist" aria-label="Modo de carga">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={mode === m.id ? "active" : ""}
                onClick={() => changeMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {message && <div className={`msg ${message.type}`}>{message.text}</div>}

          {mode === "scan" && (
            <>
              {hasSerial === false ? (
                <button className="primary big" onClick={() => setScanning(true)} style={{ marginBottom: 14 }}>
                  📷 Escanear producto
                </button>
              ) : (
                <div className="field">
                  <label>Escaneá con el lector (o tipeá el código y Enter)</label>
                  <input
                    ref={scanRef}
                    autoFocus
                    inputMode="numeric"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = scanInput;
                      setScanInput("");
                      void addScanned(v);
                    }}
                    placeholder="Código de barras"
                  />
                </div>
              )}
              <p className="muted">
                Por unidad se suma directo al ticket. Por kilo pasa a Balanza para cargar el peso.
              </p>
              {missingCode && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setQuickAdd({ code: normalizeCode(missingCode), from: "scan" })}
                  style={{ display: "block", marginBottom: 12 }}
                >
                  ➕ {isAdmin ? "Cargar" : "Vender"} el producto {missingCode}
                </button>
              )}
            </>
          )}

          {mode === "precio" && (
            <>
              <div className="field">
                <label>Monto ($) · se agrega como “{FREE_NAME}”</label>
                <input
                  ref={amountRef}
                  className="amount-input"
                  autoFocus
                  // En móvil se usa el teclado de pantalla de abajo
                  inputMode={hasSerial === false ? "none" : "decimal"}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.,]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "+") { e.preventDefault(); addFree(); }
                    if (e.key === "Escape") setAmountInput("");
                  }}
                  placeholder="0"
                />
              </div>
              <div className="keypad">
                {KEYPAD.map((k) => (
                  <button key={k} type="button" onClick={() => pressKey(k)}>{k}</button>
                ))}
                <button type="button" onClick={() => { setAmountInput(""); amountRef.current?.focus(); }}>C</button>
                <button type="button" onClick={() => { setAmountInput((v) => v.slice(0, -1)); amountRef.current?.focus(); }} aria-label="Borrar">⌫</button>
                <button type="button" className="primary" onClick={addFree}>+ Ticket</button>
              </div>
              <p className="muted">Enter o + agrega el monto al ticket. Después cobrá con el medio de pago{mpQrEnabled ? " (Mercado Pago = QR)" : ""}.</p>
            </>
          )}

          {mode === "balanza" && (<>
          <div className="field">
            <label>Código (PLU) o nombre del producto</label>
            <input
              ref={codeRef}
              autoFocus={hasSerial !== false}
              inputMode="numeric"
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value);
                setProduct(null);
                setResults([]);
                setMissingCode(null);
                setPriceInput(null);
              }}
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
          {missingCode && !product && (
            <button
              type="button"
              className="link-btn"
              onClick={() => setQuickAdd({ code: normalizeCode(missingCode), from: "code" })}
              style={{ display: "block", margin: "-6px 0 12px" }}
            >
              ➕ {isAdmin ? "Cargar" : "Vender"} el producto {missingCode}
            </button>
          )}
          <div className="product-hint">
            {product && (
              <>
                {product.name} — {formatUnitPrice(product.price, product.unit)}
                {isAdmin && priceInput === null && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setPriceInput(String(product.price).replace(".", ","))}
                    style={{ marginLeft: 8, padding: "2px 8px", fontSize: 13 }}
                  >
                    Cambiar precio
                  </button>
                )}
              </>
            )}
          </div>
          {product && priceInput !== null && (
            <div className="field">
              <label>Nuevo precio {product.unit === "KG" ? "por kilo" : "por unidad"} ($)</label>
              <div className="row">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void savePrice();
                    if (e.key === "Escape") setPriceInput(null);
                  }}
                />
                <button className="primary" onClick={savePrice} disabled={savingPrice} style={{ flex: "0 0 auto" }}>
                  {savingPrice ? "Guardando…" : "Guardar"}
                </button>
                <button onClick={() => setPriceInput(null)} disabled={savingPrice} style={{ flex: "0 0 auto" }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

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

          <button className="primary big" onClick={product && qtyInput.trim() ? handleQty : handleCode}>
            Agregar al ticket
          </button>
          </>)}

          {mode === "balanza" && hasSerial && (
            <>
              <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "20px 0" }} />

              <div className="scale-status">
                <span className={`dot ${scaleOn ? "on" : ""}`} />
                <span style={{ flex: 1 }}>Balanza {scaleOn ? "conectada" : "desconectada"}</span>
                <button onClick={toggleScale}>{scaleOn ? "Desconectar" : "Conectar"}</button>
              </div>
              {lastRaw && <p className="muted">Última trama: <code>{JSON.stringify(lastRaw)}</code></p>}
              <p className="muted">
                Enter para avanzar · <span className="kbd">F2</span> cobrar en efectivo · lector USB: escaneá directo
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
                      {l.unit === "UNIT" && !l.free && (
                        <button className="qty-btn" onClick={() => changeUnitQty(l.key, -1)}>−</button>
                      )}
                      {l.free ? "—" : formatQty(l.quantity, l.unit)}
                      {l.unit === "UNIT" && !l.free && (
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
            <label>{saving ? "Guardando…" : "Cobrar con"}</label>
            <div className="pay-grid">
              {payMethods.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`primary${m === "MERCADOPAGO" ? " mp-btn" : ""}`}
                  onClick={() => validateSale(m)}
                  disabled={cart.length === 0 || total <= 0 || saving || (m === "MERCADOPAGO" && !!mpBlocked)}
                  title={m === "MERCADOPAGO" && mpBlocked ? mpBlocked : undefined}
                >
                  {m === "MERCADOPAGO" ? "Mercado Pago (QR)" : PAYMENT_LABELS[m]}
                  {m === "CASH" && hasSerial && <span className="kbd">F2</span>}
                </button>
              ))}
            </div>
            {mpBlocked && (
              <p className="muted" style={{ margin: "8px 0 0" }}>
                {mpBlocked}{" "}
                {isAdmin ? (
                  <Link href="/configuracion/pagos">Conectar en Configuración → Pagos</Link>
                ) : (
                  "Pedile al administrador que lo conecte."
                )}
              </p>
            )}
          </div>

          <button onClick={() => setCart([])} disabled={cart.length === 0}>
            Vaciar ticket
          </button>
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

      {mpQrEnabled && qr && (
        <MercadoPagoQrModal
          items={cart.map(toPayload)}
          estimatedTotal={total}
          resumeOrderId={qr.resume}
          onCreated={(id) => rememberQr(id)}
          onSettled={() => rememberQr(null)}
          onPaid={() => {
            // La venta ya quedó registrada en el servidor: se vacía el ticket
            setCart([]);
          }}
          onClose={() => {
            rememberQr(null);
            setQr(null);
            focusCode();
          }}
        />
      )}

      {quickAdd && (
        <QuickProductModal
          key={quickAdd.code}
          code={quickAdd.code}
          isAdmin={isAdmin}
          freeName={FREE_NAME}
          onCreated={(p) => void onQuickCreated(p)}
          onSellFree={(price) => {
            pushFree(price);
            closeQuickAdd();
          }}
          onCancel={closeQuickAdd}
        />
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
