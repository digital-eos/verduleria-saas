"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { apiFetch } from "@/components/SessionProvider";
import { formatMoney } from "@/lib/format";
import type { PaymentOrderDTO } from "@/lib/payments/service";

/**
 * Modal de cobro con QR de Mercado Pago.
 * Solo habla con NUESTRO backend (/api/payments/...): nunca con Mercado Pago directo,
 * así el access token no sale del servidor. Funciona igual en demo y en real.
 */

type Phase = "creating" | "waiting" | "approved" | "expired" | "canceled" | "error";

type Props = {
  /** Ticket a cobrar (el servidor recalcula precios y total) */
  items: ({ code: string; quantity: number } | { amount: number })[];
  /** Total estimado en el navegador, para mostrar mientras se genera el QR */
  estimatedTotal: number;
  /** Retomar un cobro ya creado (ej. si se recargó la página) */
  resumeOrderId?: string | null;
  /** Se creó una orden nueva (para recordarla si se recarga la página) */
  onCreated?: (orderId: string) => void;
  /** La orden llegó a un estado final (pagada, vencida, cancelada) */
  onSettled?: (order: PaymentOrderDTO) => void;
  /** Pago aprobado: la venta ya quedó registrada */
  onPaid: (order: PaymentOrderDTO) => void;
  onClose: () => void;
};

const POLL_MS = 3000;
const MP_BLUE = "#00B1EA";

async function call(url: string, init?: RequestInit): Promise<PaymentOrderDTO> {
  const res = await apiFetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "No pudimos conectar con el servidor, intentá de nuevo");
  return data as PaymentOrderDTO;
}

const pad = (n: number) => String(n).padStart(2, "0");
const formatCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

export default function MercadoPagoQrModal({
  items,
  estimatedTotal,
  resumeOrderId,
  onCreated,
  onSettled,
  onPaid,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>("creating");
  const [order, setOrder] = useState<PaymentOrderDTO | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const inFlight = useRef(false);
  const cbs = useRef({ onCreated, onSettled, onPaid });
  cbs.current = { onCreated, onSettled, onPaid };

  /** Aplica la respuesta del servidor a la pantalla */
  const apply = useCallback((o: PaymentOrderDTO) => {
    setOrder(o);
    setWarning(null);
    switch (o.status) {
      case "created":
        setPhase("waiting");
        return;
      case "processed":
        setPhase("approved");
        cbs.current.onPaid(o);
        break;
      case "expired":
        setPhase("expired");
        break;
      case "canceled":
      case "refunded":
        setPhase("canceled");
        break;
    }
    cbs.current.onSettled?.(o);
  }, []);

  const createOrder = useCallback(async () => {
    setPhase("creating");
    setError(null);
    setQrImg(null);
    setOrder(null);
    try {
      const o = await call("/api/payments/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      cbs.current.onCreated?.(o.orderId);
      apply(o);
    } catch (e) {
      setError((e as Error).message || "No pudimos generar el QR, intentá de nuevo");
      setPhase("error");
    }
  }, [items, apply]);

  const poll = useCallback(async () => {
    if (!order?.orderId || inFlight.current) return;
    inFlight.current = true;
    try {
      apply(await call(`/api/payments/orders/${encodeURIComponent(order.orderId)}`));
    } catch {
      // Un corte momentáneo no frena el cobro: seguimos consultando
      setWarning("Sin conexión con el servidor, reintentando…");
    } finally {
      inFlight.current = false;
    }
  }, [order?.orderId, apply]);

  // Arranque: crear la orden o retomar una existente
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (resumeOrderId) {
      call(`/api/payments/orders/${encodeURIComponent(resumeOrderId)}`)
        .then(apply)
        .catch(() => (items.length ? void createOrder() : onClose()));
    } else {
      void createOrder();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir el modal
  }, []);

  // QR: el texto EMVCo se convierte en imagen acá, en el navegador
  useEffect(() => {
    if (!order?.qrData) return;
    let alive = true;
    QRCode.toDataURL(order.qrData, { width: 600, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => alive && setQrImg(url))
      .catch(() => alive && setError("No pudimos dibujar el QR, intentá de nuevo"));
    return () => { alive = false; };
  }, [order?.qrData]);

  // Polling cada 3 s mientras se espera el pago
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [phase, poll]);

  // Cuenta regresiva
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);
  const remaining = order?.expiresAt ? new Date(order.expiresAt).getTime() - now : 0;
  // Al llegar a 0 consultamos enseguida para confirmar el vencimiento
  const expiredLocally = phase === "waiting" && !!order?.expiresAt && remaining <= 0;
  useEffect(() => {
    if (expiredLocally) void poll();
  }, [expiredLocally, poll]);

  async function action(path: "cancel" | "simulate") {
    if (!order?.orderId || busy) return;
    setBusy(true);
    try {
      apply(await call(`/api/payments/orders/${encodeURIComponent(order.orderId)}/${path}`, { method: "POST" }));
    } catch (e) {
      setWarning((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const amount = order?.totalAmount ?? estimatedTotal;
  const canDismiss = phase !== "waiting" && phase !== "creating";

  return (
    <div className="modal-bg" onClick={() => canDismiss && phase !== "approved" && onClose()}>
      <div className="modal mp-modal" role="dialog" aria-modal="true" aria-label="Cobro con Mercado Pago" onClick={(e) => e.stopPropagation()}>
        {phase === "approved" && order ? (
          <div className="mp-success">
            <div className="mp-success-icon" aria-hidden>✓</div>
            <h2>¡Pago aprobado!</h2>
            <div className="mp-amount">{formatMoney(order.totalAmount)}</div>
            <dl className="mp-meta">
              <dt>Order</dt>
              <dd><code>{order.orderId}</code></dd>
              <dt>Hora</dt>
              <dd>
                {new Date(order.sale?.createdAt ?? order.updatedAt).toLocaleTimeString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </dd>
              {order.sale && (
                <>
                  <dt>Venta</dt>
                  <dd>#{order.sale.id}</dd>
                </>
              )}
            </dl>
            <button className="primary big" autoFocus onClick={onClose}>
              Nueva venta
            </button>
          </div>
        ) : (
          <>
            <div className="mp-head">
              <span className="mp-brand" style={{ color: MP_BLUE }}>Mercado Pago</span>
              {order?.demo && <span className="mp-demo">MODO DEMO</span>}
              {canDismiss && (
                <button className="mp-close" aria-label="Cerrar" onClick={onClose}>✕</button>
              )}
            </div>

            <div className="mp-amount">{formatMoney(amount)}</div>

            {phase === "creating" && (
              <div className="mp-qr-box">
                <span className="spinner" aria-hidden />
                <p className="muted">Generando QR…</p>
              </div>
            )}

            {phase === "error" && (
              <>
                <div className="msg error">{error}</div>
                <div className="row">
                  <button onClick={onClose}>Cerrar</button>
                  <button className="primary" onClick={createOrder}>Reintentar</button>
                </div>
              </>
            )}

            {phase === "waiting" && (
              <>
                <div className="mp-qr-box">
                  {qrImg ? (
                    <img className="mp-qr" src={qrImg} alt="Código QR para pagar con Mercado Pago" />
                  ) : (
                    <span className="spinner" aria-hidden />
                  )}
                </div>
                <p className="mp-hint">Escaneá el código con la app de Mercado Pago o tu billetera virtual</p>
                <p className="mp-countdown">
                  El QR vence en <b>{formatCountdown(remaining)}</b>
                </p>
                <div className="mp-status" aria-live="polite">
                  <span className="spinner" aria-hidden />
                  Esperando pago…
                </div>
                {warning && <div className="msg info">{warning}</div>}
                {order?.demo && (
                  <button className="mp-simulate" onClick={() => action("simulate")} disabled={busy}>
                    Simular pago (demo)
                  </button>
                )}
                <button className="big" onClick={() => action("cancel")} disabled={busy}>
                  Cancelar
                </button>
              </>
            )}

            {phase === "expired" && (
              <>
                <div className="mp-final">
                  <h2>Pago expirado</h2>
                  <p className="muted">El QR venció sin que se registre un pago. El ticket sigue cargado.</p>
                </div>
                <div className="row">
                  <button onClick={onClose}>Cerrar</button>
                  <button className="primary" style={{ background: MP_BLUE }} onClick={createOrder}>
                    Generar nuevo QR
                  </button>
                </div>
              </>
            )}

            {phase === "canceled" && (
              <>
                <div className="mp-final">
                  <h2>{order?.status === "refunded" ? "Pago devuelto" : "Cobro cancelado"}</h2>
                  <p className="muted">No se cobró nada. El ticket sigue cargado.</p>
                </div>
                <button className="big" autoFocus onClick={onClose}>Cerrar</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
